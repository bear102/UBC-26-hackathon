// Hedge agent (§5.2), attestor (§5.3), relayer (§5.4), cranker (§5.7) and promise creation.
// HEDGE_MODE=live uses real Gemini orders (keys A/B). HEDGE_MODE=paper simulates fills against the live public book
// and is labelled "PAPER" everywhere (used only until the user's Gemini keys exist; never presented as real).
import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { env } from "./env";
import { book, eventByTicker, richText } from "./gemini";
import * as G from "./geminiPrivate";
import { quoteBin, guardReason, needPerBin, toCenti, trancheTarget } from "./pricing";
import { canonicalResolution, sha256Hex, hexToBytes, isBinaryResolved, termsHash as termsHashOf, RISK_NOTE, type Terms } from "./canon";
import * as P from "./program";
import { conn, key, send, readPromise, receiptsOf, explorer } from "./chain";
import { load, mutate, log, budgetToday, type PromiseRec, type OrderRec, type Card } from "./store";
import { quoteCard } from "./catalog";

export const hedgeMode = (): "live" | "paper" => (process.env.HEDGE_MODE === "live" || (process.env.HEDGE_MODE !== "paper" && G.hasKeys("A") && G.hasKeys("B")) ? "live" : "paper");

const nowS = () => Math.floor(Date.now() / 1000);

// ------------------------------------------------------------------ create

export type CreateInput = { card: Card; cap: number; refundUsd: number; topupThreshold: number; tranche?: number; merchantName?: string; salesCloseTs?: number; testLabel?: string; adopt?: Record<string, number> };

export async function createPromise(inp: CreateInput): Promise<PromiseRec> {
  const q = await quoteCard(inp.card, inp.refundUsd);
  if (!q.quote.hedgeable && !inp.adopt) throw new Error(q.quote.reason || "not hedgeable");
  const merchant = key("merchant");
  const id = Date.now();
  const refundUnits = Math.round(inp.refundUsd * 1_000_000);
  const salesClose = inp.salesCloseTs ?? q.salesClose;
  const ev = await eventByTicker(inp.card.event_ticker, 15_000);
  const first = ev.contracts.find((c) => c.instrumentSymbol === inp.card.strip[0]);
  const terms: Terms = {
    sentence: inp.card.sentence, applies_to: inp.card.applies_to, event_ticker: inp.card.event_ticker, strip: inp.card.strip,
    rules_doc: first?.description ?? null, refund_usd: inp.refundUsd, sales_close_iso: new Date(salesClose * 1000).toISOString(),
    merchant_name: inp.merchantName || process.env.MERCHANT_NAME || "Guadalupe Watch Party (demo merchant: our team)", risk_note: RISK_NOTE,
  };
  const th = await termsHashOf(terms);
  const ix = await P.ixCreatePromise(merchant.publicKey, {
    promiseId: id, eventTicker: inp.card.event_ticker, strip: inp.card.strip, refundUnits, cap: inp.cap,
    salesCloseTs: salesClose, expectedResolveTs: Math.max(q.expectedResolve, salesClose + 60), termsHash: hexToBytes(th),
  });
  const r = await send([ix], [merchant]);
  if (!r.ok) throw new Error(`create_promise failed: ${r.name ?? ""} ${r.message}`);
  const pda = P.promisePda(merchant.publicKey, id);
  const rec: PromiseRec = {
    id: String(id), pda: pda.toBase58(), vault: P.vaultPda(pda).toBase58(), merchantName: terms.merchant_name, card: { ...inp.card, event_title: ev.title, rules_text: richText(first?.description) },
    terms, termsHash: th, refundUnits, cap: inp.cap, salesCloseTs: salesClose, expectedResolveTs: Math.max(q.expectedResolve, salesClose + 60),
    topupThreshold: inp.topupThreshold, tranche: inp.tranche ?? 10, createdAt: Date.now(), createSig: r.sig, status: "HEDGING", alloc: {}, premium: 0,
    testLabel: inp.testLabel,
  };
  mutate((s) => { s.promises[rec.id] = rec; });
  log("info", "create", `promise ${rec.id} created ${explorer(r.sig)}`, { pda: rec.pda });
  if (inp.adopt) {
    // Test promises (D20) adopt an existing position (e.g. the H0 gate fill) instead of buying. The attestor still
    // attests min(adopted, real position - other promises' allocations), so nothing is claimed that Gemini doesn't show.
    mutate((s) => { s.promises[rec.id].alloc = { ...inp.adopt }; s.promises[rec.id].agentNote = `adopted existing position ${JSON.stringify(inp.adopt)}`; });
    attest(rec.id, 0).catch((e) => log("error", "attest", String(e)));
  } else hedge(rec.id, "create").catch((e) => log("error", "agent", String(e)));
  return rec;
}

// ------------------------------------------------------------------ agent

const inflight = new Map<string, Promise<unknown>>();

/** Buy the next tranche if guards pass, then attest OPEN. reason: create | revert | timer */
export async function hedge(promiseId: string, reason: "create" | "revert" | "timer"): Promise<{ ok: boolean; note: string }> {
  if (inflight.has(promiseId)) { await inflight.get(promiseId); return { ok: true, note: "joined in-flight hedge" }; }
  const p = (async () => hedgeInner(promiseId, reason))();
  inflight.set(promiseId, p);
  try { return await p; } finally { inflight.delete(promiseId); }
}

async function hedgeInner(promiseId: string, reason: "create" | "revert" | "timer"): Promise<{ ok: boolean; note: string }> {
  const t0 = Date.now();
  const s = load();
  const rec = s.promises[promiseId];
  if (!rec) throw new Error("unknown promise");
  const onchain = await readPromise(rec.pda);
  if (!onchain) throw new Error("promise not onchain");
  const k = rec.refundUnits / 1_000_000;
  const target = reason === "create"
    ? Math.min(rec.tranche, rec.cap)
    : trancheTarget({ hedgedCapacity: onchain.hedgedCapacity, sold: onchain.sold, cap: rec.cap, threshold: rec.topupThreshold, revertSeen: reason === "revert", tranche: rec.tranche });
  if (target == null) return { ok: false, note: "no top-up needed" };
  const held = rec.card.strip.map((sym) => rec.alloc[sym] ?? 0);
  const need = needPerBin(target, k, held);
  const bins = await Promise.all(rec.card.strip.map(async (sym) => quoteBin(sym, await book(sym, 3000).catch(() => ({ bids: [], asks: [] })), env.limitSlippage())));
  const budget = budgetToday(s);
  const why = guardReason({ bins, needContracts: need, k, targetReceipts: target, cap: rec.cap, premiumToday: budget.spent, dailyBudget: env.dailyBudget(), priceCeiling: env.priceCeiling(), now: nowS(), salesCloseTs: rec.salesCloseTs, halted: s.agent.halted });
  if (why) {
    mutate((st) => { st.promises[promiseId].agentNote = `Agent declined: ${why}`; if (reason === "create" && why !== "nothing to buy") st.promises[promiseId].status = "HEDGE_FAILED"; });
    log("warn", "agent", `promise ${promiseId}: guard: ${why}`);
    if (why === "nothing to buy") { await attest(promiseId, 0); return { ok: true, note: why }; }
    return { ok: false, note: why };
  }
  const reqs = rec.card.strip.map((sym, i) => ({ symbol: sym, side: "buy" as const, outcome: "yes" as const, price: bins[i].limit as number, quantity: need[i] })).filter((o) => o.quantity > 0);
  const mode = hedgeMode();
  let orders: OrderRec[] = [];
  try {
    if (mode === "live") {
      const res = await G.batchOrder(reqs, "A");
      orders = (res.results || []).map((r, i) => ({
        promiseId, orderId: String(r.order?.orderId ?? `rejected-${i}`), symbol: reqs[i].symbol, side: "buy", qty: reqs[i].quantity, price: reqs[i].price,
        filled: Number(r.order?.filledQuantity ?? 0), avgPx: r.order?.avgExecutionPrice ? Number(r.order.avgExecutionPrice) : undefined,
        status: r.order?.status ?? `error: ${r.error ?? ""} ${r.message ?? ""}`, ts: Date.now(), raw: r,
      }));
    } else {
      orders = reqs.map((o, i) => {
        const fill = Math.min(o.quantity, bins[i].depth);
        return { promiseId, orderId: `PAPER-${crypto.randomBytes(5).toString("hex")}`, symbol: o.symbol, side: "buy", qty: o.quantity, price: o.price, filled: fill, avgPx: bins[i].ask ?? o.price, status: fill >= o.quantity ? "filled" : "partial", ts: Date.now() };
      });
    }
  } catch (e) {
    const fatal = e instanceof G.GeminiError && e.fatal;
    mutate((st) => {
      st.promises[promiseId].agentNote = `Gemini error: ${String(e).slice(0, 200)}`;
      if (fatal) { st.agent.halted = true; st.agent.haltReason = String(e).slice(0, 200); }
      if (reason === "create") st.promises[promiseId].status = "HEDGE_FAILED";
    });
    log("error", "agent", `order failed for ${promiseId}: ${String(e)}`);
    return { ok: false, note: String(e) };
  }
  const spent = orders.reduce((a, o) => a + o.filled * (o.avgPx ?? o.price), 0);
  mutate((st) => {
    st.orders.push(...orders);
    const r = st.promises[promiseId];
    for (const o of orders) r.alloc[o.symbol] = Math.round(((r.alloc[o.symbol] ?? 0) + o.filled) * 100) / 100;
    r.premium = Math.round((r.premium + spent) * 10000) / 10000;
    budgetToday(st).spent = Math.round((budgetToday(st).spent + (mode === "live" ? spent : 0)) * 10000) / 10000;
    r.agentNote = `${mode === "paper" ? "PAPER " : ""}bought ${orders.map((o) => `${o.filled}/${o.qty} ${o.symbol.split("-").pop()} @${(o.avgPx ?? o.price).toFixed(2)}`).join(", ")} (${reason})`;
  });
  log("info", "agent", `${mode} batch for ${promiseId} in ${Date.now() - t0} ms: ${load().promises[promiseId].agentNote}`);
  const a = await attest(promiseId, 0, orders.map((o) => o.orderId));
  return { ok: a.ok, note: load().promises[promiseId].agentNote ?? "" };
}

// ------------------------------------------------------------------ attestor

/** Per-bin quantity (contracts) this promise may claim: min(alloc, position - Σ other open allocs). */
async function attestableQty(rec: PromiseRec, freshOrderIds: string[] = []): Promise<number[]> {
  const s = load();
  const others = Object.values(s.promises).filter((p) => p.id !== rec.id && !["CLOSED", "SETTLED_NO", "HEDGE_FAILED"].includes(p.status));
  if (hedgeMode() === "paper") return rec.card.strip.map((sym) => rec.alloc[sym] ?? 0);
  let pos = await G.positions("B");
  const posQty = (sym: string) => pos.filter((x) => x.symbol === sym && (x.outcome ?? "yes") === "yes").reduce((a, x) => a + Number(x.totalQuantity), 0);
  // fast path: if positions lag a fresh fill, use order history read with key B (never more than B itself observed)
  if (freshOrderIds.length) {
    const t0 = Date.now();
    while (Date.now() - t0 < 3000 && rec.card.strip.some((sym) => posQty(sym) + 1e-9 < (rec.alloc[sym] ?? 0) + others.reduce((a, o) => a + (o.alloc[sym] ?? 0), 0))) {
      await new Promise((r) => setTimeout(r, 500));
      pos = await G.positions("B");
    }
  }
  return rec.card.strip.map((sym) => {
    const otherAlloc = others.reduce((a, o) => a + (o.alloc[sym] ?? 0), 0);
    return Math.max(0, Math.min(rec.alloc[sym] ?? 0, posQty(sym) - otherAlloc));
  });
}

export async function attest(promiseId: string, phase: 0 | 1 | 2, freshOrderIds: string[] = []): Promise<{ ok: boolean; sig?: string; error?: string }> {
  const t0 = Date.now();
  const rec = load().promises[promiseId];
  let qty: number[];
  try { qty = await attestableQty(rec, freshOrderIds); }
  catch (e) { log("error", "attest", `positions read failed for ${promiseId}: ${e}`); return { ok: false, error: String(e) }; }
  const observedAt = nowS();
  const qtyCenti = qty.map(toCenti);
  const ids = load().orders.filter((o) => o.promiseId === promiseId && o.filled > 0).map((o) => o.orderId).sort();
  const ordersHash = crypto.createHash("sha256").update(ids.join(",")).digest();
  const premiumMicros = Math.round(rec.premium * 1e6);
  const attestor = key("attestor");
  const ix = await P.ixAttestHedge(attestor.publicKey, new PublicKey(rec.pda), phase, qtyCenti, premiumMicros, ordersHash, observedAt);
  const r = await send([ix], [attestor]);
  const capacity = qtyCenti.length ? Math.min(...qtyCenti.map((q) => Math.floor((q * 10_000) / rec.refundUnits))) : 0;
  mutate((s) => {
    s.attestations.push({ promiseId, phase, sig: r.sig, capacity: Math.min(capacity, rec.cap), qtyCenti, observedAt, ts: Date.now(), error: r.ok ? undefined : `${r.name ?? ""} ${r.message}`, latencyMs: Date.now() - t0 });
    const p = s.promises[promiseId];
    if (r.ok && phase === 0 && (p.status === "HEDGING" || p.status === "HEDGE_FAILED") && capacity > 0) p.status = "SELLING";
  });
  if (!r.ok) log("error", "attest", `attest phase ${phase} failed for ${promiseId}: ${r.name ?? ""} ${r.message}`);
  else log("info", "attest", `phase ${phase} capacity ${capacity} for ${promiseId} in ${Date.now() - t0} ms`);
  return r.ok ? { ok: true, sig: r.sig } : { ok: false, sig: r.sig, error: r.name ?? r.message };
}

// ------------------------------------------------------------------ relayer

export async function relay(promiseId: string): Promise<string> {
  const rec = load().promises[promiseId];
  const ev = await eventByTicker(rec.card.event_ticker);
  if (ev.status !== "settled") return `event ${ev.status}`;
  if (!isBinaryResolved(ev)) { log("warn", "relayer", `${rec.card.event_ticker} settled but not binary; waiting`); return "not binary"; }
  const winning = rec.card.strip.find((sym) => ev.contracts.find((c) => c.instrumentSymbol === sym)?.resolutionSide === "yes") ?? "";
  const hash = await sha256Hex(canonicalResolution(ev));
  const resolvedAt = Math.floor(Date.parse(ev.resolvedAt!) / 1000);
  const relayer = key("relayer");
  const ix = await P.ixAttestOutcome(relayer.publicKey, new PublicKey(rec.pda), key("merchant").publicKey, winning, hexToBytes(hash), resolvedAt);
  const r = await send([ix], [relayer]);
  mutate((s) => {
    const p = s.promises[promiseId];
    p.eventSnapshot = ev; p.eventSnapshotAt = Date.now();
    if (r.ok || r.name === "AlreadySettled") {
      p.outcome = { winning, hash, resolvedAt: ev.resolvedAt!, sig: r.ok ? r.sig : p.outcome?.sig, yes: !!winning };
      p.status = winning ? "SETTLED_YES" : "SETTLED_NO";
    }
  });
  log(r.ok ? "info" : "error", "relayer", `outcome ${winning || "NO"} for ${promiseId}: ${r.ok ? explorer(r.sig) : r.name + " " + r.message}`);
  return r.ok ? "posted" : `failed ${r.name ?? r.message}`;
}

// ------------------------------------------------------------------ cranker / release / close

export async function crank(promiseId: string): Promise<string[]> {
  const rec = load().promises[promiseId];
  const pda = new PublicKey(rec.pda);
  const merchant = key("merchant").publicKey;
  const cr = key("crank");
  const rs = (await receiptsOf(pda)).filter((r) => !r.refunded);
  const sigs: string[] = [];
  for (let i = 0; i < rs.length; i += 5) {
    const chunk = rs.slice(i, i + 5);
    const ixs = await P.crankInstructions(cr.publicKey, pda, merchant, chunk.map((r) => ({ receipt: r.pubkey, holder: r.holder })));
    const r = await send(ixs, [cr]);
    if (r.ok) {
      sigs.push(r.sig);
      mutate((s) => { for (const c of chunk) { const x = s.receipts.find((y) => y.promiseId === promiseId && y.index === c.index); if (x) { x.refunded = true; x.refundSig = r.sig; } } });
    } else log("error", "crank", `crank failed ${promiseId}: ${r.name ?? ""} ${r.message}`);
  }
  if (sigs.length) log("info", "crank", `${rs.length} refunds for ${promiseId} in ${sigs.length} tx`);
  return sigs;
}

export async function release(promiseId: string, signerName: "merchant" | "attacker" = "merchant") {
  const rec = load().promises[promiseId];
  const m = key("merchant");
  const ix = await P.ixRelease(m.publicKey, new PublicKey(rec.pda));
  const r = await send([ix], [m], { skipPreflight: true });
  if (r.ok) mutate((s) => { s.promises[promiseId].status = "CLOSED"; });
  void signerName;
  return r;
}

export async function closeReceipts(promiseId: string) {
  const rec = load().promises[promiseId];
  const pda = new PublicKey(rec.pda);
  const m = key("merchant");
  const rs = await receiptsOf(pda);
  const p = await readPromise(pda);
  const closable = rs.filter((r) => r.refunded || (p && (p.status === 2 || p.status === 3)));
  const sigs: string[] = [];
  for (let i = 0; i < closable.length; i += 20) {
    const r = await send([await P.ixCloseReceipts(m.publicKey, pda, closable.slice(i, i + 20).map((x) => x.pubkey))], [m]);
    if (r.ok) sigs.push(r.sig);
  }
  return sigs;
}

// ------------------------------------------------------------------ worker tick

const lastRun = new Map<string, number>();
const every = (k: string, ms: number) => { const t = lastRun.get(k) ?? 0; if (Date.now() - t < ms) return false; lastRun.set(k, Date.now()); return true; };

export async function tick() {
  const s = load();
  const now = nowS();
  for (const rec of Object.values(s.promises)) {
    if (rec.status === "CLOSED") continue;
    try {
      const id = rec.id;
      if (now < rec.salesCloseTs) {
        if (rec.status === "SELLING" && hedgeMode() === "live" && every(`open:${id}`, 5 * 60_000)) await attest(id, 0);
        if (rec.status === "SELLING" && rec.topupThreshold >= 0 && every(`topup:${id}`, 30_000)) {
          const p = await readPromise(rec.pda);
          if (p && trancheTarget({ hedgedCapacity: p.hedgedCapacity, sold: p.sold, cap: rec.cap, threshold: rec.topupThreshold, revertSeen: false, tranche: rec.tranche }) != null) await hedge(id, "timer");
        }
        if (rec.status === "HEDGE_FAILED" && every(`retry:${id}`, 120_000) && !s.agent.halted) await hedge(id, "create");
        continue;
      }
      // after sales close
      if (rec.status === "SELLING" || rec.status === "HEDGING" || rec.status === "HEDGE_FAILED") mutate((st) => { st.promises[id].status = "CLOSED_FOR_SALES"; });
      const atts = load().attestations.filter((a) => a.promiseId === id && a.phase >= 1 && !a.error);
      if (rec.status === "CLOSED_FOR_SALES") {
        if (!atts.length && now >= rec.salesCloseTs + 30 && every(`cutoff:${id}`, 60_000)) await attest(id, 1);
        else if (atts.length && every(`sweep:${id}`, 15 * 60_000)) {
          if (hedgeMode() === "live") {
            const q = (await attestableQty(rec)).map(toCenti);
            const last = atts[atts.length - 1];
            if (q.some((x, i) => x < last.qtyCenti[i])) await attest(id, 1);
          }
        }
        if (atts.length && now >= rec.expectedResolveTs - 1800 && !atts.some((a) => a.phase === 2) && every(`presettle:${id}`, 60_000)) await attest(id, 2);
        const kind = /^WXHIGH/.test(rec.card.event_ticker) ? "weather" : /^(NBA|NCAA)/.test(rec.card.event_ticker) ? "game" : "crypto";
        const pollFrom = kind === "game" ? rec.salesCloseTs + 2.5 * 3600 : kind === "weather" ? Math.floor(Date.parse(rec.card.expiry ?? rec.terms.sales_close_iso) / 1000) + 5 * 3600 : rec.salesCloseTs;
        const env2 = process.env.HH_POLL_ALWAYS === "1";
        if ((now >= pollFrom || env2) && every(`relay:${id}`, 60_000)) await relay(id);
      }
      const cur = load().promises[id];
      if (cur.status === "SETTLED_YES" && every(`crank:${id}`, 30_000)) {
        const p = await readPromise(cur.pda);
        if (p && p.refunded < p.sold) await crank(id);
        const p2 = await readPromise(cur.pda);
        if (p2 && p2.refunded === p2.sold) { await release(id); await closeReceipts(id); }
      }
      if (cur.status === "SETTLED_NO" && every(`release:${id}`, 60_000)) {
        const r = await release(id);
        if (r.ok) await closeReceipts(id);
      }
    } catch (e) {
      log("error", "worker", `tick ${rec.id}: ${String(e).slice(0, 300)}`);
    }
  }
}

let started = false;
export function startWorker() {
  if (started || process.env.HH_WORKER === "0") return;
  started = true;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } catch (e) { console.error("worker", e); } finally { busy = false; }
  }, 15_000);
  // keep a fresh blockhash warm
  setInterval(() => { conn().getLatestBlockhash("confirmed").catch(() => {}); }, 20_000);
  log("info", "worker", `worker started (hedge mode ${hedgeMode()})`);
}
