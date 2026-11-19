// M3 Hedge Desk (SPEC §14.4): direct cover for the business itself. No customer, no vault, no program instruction.
// Sizing is pure code: each contract pays $1, so `payout_usd` contracts of each scenario bin. Buys are allowed ONLY on the
// sandbox trade venue (user decision 2026-11-19), behind merchant login, with a typed max amount. Each fill is committed
// onchain as one SPL Memo from the merchant key ("commitment, not attestation").
import crypto from "node:crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { book, eventByTicker, type Book } from "./gemini";
import { quoteBin, walkBook } from "./pricing";
import { env } from "./env";
import { venueFor, bookBase, isSandbox, hostOf, type Venue } from "./venue";
import * as G from "./geminiPrivate";
import { mutate, load, log } from "./store";
import { key, send, explorer } from "./chain";

export type DeskLeg = { symbol: string; label: string; ask: number | null; bid: number | null; mid: number | null; limit: number | null; qty: number; cost: number; fillable: boolean; depth: number };
export type DeskQuote = {
  event_ticker: string; event_title: string; expiry?: string; symbols: string[]; payout_usd: number;
  legs: DeskLeg[]; premium: number | null; fair: number | null; spread: number | null; p_bad: number | null;
  expected_payout: number | null; fillable: boolean;
  venue: { mode: "live" | "paper"; host: string; sandbox: boolean; why?: string };
  tradeable: boolean; reason?: string; plain: string; quotedAt: number;
};
export type DeskFill = { symbol: string; orderId: string; qty: number; filled: number; avgPx?: number; price: number; status: string };
export type DeskTicket = {
  id: string; createdAt: number; quote: DeskQuote; maxUsd: number;
  status: "FILLED" | "PARTIAL" | "REJECTED";
  fills: DeskFill[]; spent: number; covered: number;
  memo?: { text: string; sig?: string; url?: string; error?: string };
  note?: string;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export const deskMax = () => Number(process.env.DESK_MAX_USD || 100);

/** Pure sizing from books (unit-tested). */
export function sizeTicket(legs: { symbol: string; label: string; book: Book }[], payout: number, slippage = 0.02) {
  const qty = Math.max(0, Math.floor(payout));
  const out: DeskLeg[] = legs.map((l) => {
    const q = quoteBin(l.symbol, l.book, slippage);
    const w = walkBook(l.book, qty);
    return { symbol: l.symbol, label: l.label, ask: q.ask, bid: q.bid, mid: q.mid, limit: q.limit, qty, cost: w.cost, fillable: w.fillable && qty > 0, depth: Math.floor(q.depth) };
  });
  const premium = out.some((l) => l.ask == null) ? null : r2(out.reduce((a, l) => a + l.cost, 0));
  const fair = out.some((l) => l.mid == null) ? null : r2(out.reduce((a, l) => a + (l.mid as number) * qty, 0));
  const p_bad = out.some((l) => l.mid == null) ? null : r4(Math.min(1, out.reduce((a, l) => a + (l.mid as number), 0)));
  return {
    legs: out, premium, fair, spread: premium != null && fair != null ? r2(premium - fair) : null, p_bad,
    expected_payout: p_bad != null ? r2(p_bad * qty) : null, fillable: out.length > 0 && out.every((l) => l.fillable),
  };
}

export async function quoteDesk(input: { event_ticker: string; symbols: string[]; payout_usd: number }): Promise<DeskQuote> {
  const payout = Math.max(1, Math.min(10_000, Math.floor(Number(input.payout_usd) || 0)));
  const venue: Venue = await venueFor(input.event_ticker, input.symbols);
  const base = bookBase(venue);
  const e = await eventByTicker(input.event_ticker, 15_000, base);
  const syms = [...new Set(input.symbols)].filter((s) => e.contracts.some((c) => c.instrumentSymbol === s)).slice(0, 8);
  if (!syms.length) throw new Error("none of those contracts are on this event");
  const legs = await Promise.all(syms.map(async (s) => ({ symbol: s, label: e.contracts.find((c) => c.instrumentSymbol === s)!.label, book: await book(s, 3_000, base).catch(() => ({ bids: [], asks: [] }) as Book) })));
  const z = sizeTicket(legs, payout, env.limitSlippage());
  const sandbox = venue.mode === "live" && isSandbox(venue.trade);
  let reason: string | undefined;
  if (!sandbox) reason = venue.mode === "live" ? "Buying is enabled on the Gemini sandbox only" : `Quote only: ${venue.why ?? "not listed on the trade venue"}`;
  else if (z.premium == null) reason = "No Gemini book: can't buy";
  else if (!z.fillable) reason = `Not enough depth for ${payout} contracts`;
  else if (z.premium > deskMax()) reason = `Over the desk limit ($${deskMax()})`;
  const scen = syms.map((s) => e.contracts.find((c) => c.instrumentSymbol === s)!.label).join(" or ");
  const plain = z.premium == null ? "No live price for this cover right now." :
    `You pay $${z.premium.toFixed(2)} now. If "${scen}" happens, Gemini pays you $${payout.toFixed(2)}. Otherwise you lose the $${z.premium.toFixed(2)}.`;
  return {
    event_ticker: e.ticker, event_title: e.title, expiry: e.expiryDate, symbols: syms, payout_usd: payout, ...z,
    venue: { mode: venue.mode, host: hostOf(venue.mode === "live" ? venue.trade : venue.data), sandbox, why: venue.why },
    tradeable: !reason, reason, plain, quotedAt: Date.now(),
  };
}

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export async function buyDesk(input: { event_ticker: string; symbols: string[]; payout_usd: number; max_usd: number }): Promise<DeskTicket> {
  if (!isSandbox(env.geminiTrade())) throw new Error("Hedge Desk buys are enabled on the Gemini sandbox only");
  const maxUsd = Number(input.max_usd);
  if (!(maxUsd > 0)) throw new Error("type the most you'll pay");
  const q = await quoteDesk(input); // fresh re-price right before sending
  if (!q.tradeable) throw new Error(q.reason ?? "not tradeable");
  if ((q.premium as number) > maxUsd + 1e-9) throw new Error(`price moved: $${q.premium} > your max $${maxUsd}`);
  const reqs = q.legs.map((l) => ({ symbol: l.symbol, side: "buy" as const, outcome: "yes" as const, price: l.limit as number, quantity: l.qty }));
  const id = `desk-${Date.now()}`;
  let fills: DeskFill[] = [];
  let note: string | undefined;
  try {
    const res = await G.batchOrder(reqs, "A");
    fills = (res.results || []).map((r, i) => ({
      symbol: reqs[i].symbol, orderId: String(r.order?.orderId ?? `rejected-${i}`), qty: reqs[i].quantity, price: reqs[i].price,
      filled: Number(r.order?.filledQuantity ?? 0), avgPx: r.order?.avgExecutionPrice ? Number(r.order.avgExecutionPrice) : undefined,
      status: r.order?.status ?? `error: ${r.error ?? ""} ${r.message ?? ""}`.trim(),
    }));
  } catch (e) {
    note = String((e as Error).message ?? e).slice(0, 300);
    log("error", "desk", `order failed: ${note}`);
  }
  const spent = r4(fills.reduce((a, f) => a + f.filled * (f.avgPx ?? f.price), 0));
  const covered = fills.length ? Math.min(...q.legs.map((l) => fills.find((f) => f.symbol === l.symbol)?.filled ?? 0)) : 0;
  const status: DeskTicket["status"] = !fills.length || fills.every((f) => f.filled <= 0) ? "REJECTED" : covered >= q.payout_usd - 1e-9 ? "FILLED" : "PARTIAL";
  const ticket: DeskTicket = { id, createdAt: Date.now(), quote: q, maxUsd, status, fills, spent, covered, note };

  if (status !== "REJECTED") {
    const commit = { v: 1, id, venue: q.venue.host, event: q.event_ticker, fills: fills.map((f) => ({ s: f.symbol, o: f.orderId, q: f.filled, p: f.avgPx ?? f.price })), spent, covered };
    const text = `hh:desk:v1:${crypto.createHash("sha256").update(JSON.stringify(commit)).digest("hex")}`;
    ticket.memo = { text };
    try {
      const m = key("merchant");
      const r = await send([new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: m.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(text, "utf8") })], [m]);
      if (r.ok) { ticket.memo.sig = r.sig; ticket.memo.url = explorer(r.sig); } else ticket.memo.error = r.message;
    } catch (e) { ticket.memo.error = String((e as Error).message ?? e).slice(0, 200); }
  }
  mutate((s) => { (s.desk ??= []).push(ticket); });
  log("info", "desk", `${status} ${q.event_ticker} ${fills.map((f) => `${f.filled}/${f.qty} ${f.symbol.split("-").pop()}`).join(", ")} spent $${spent}${ticket.memo?.sig ? ` memo ${ticket.memo.sig}` : ""}`);
  return ticket;
}

export const deskTickets = () => [...(load().desk ?? [])].reverse();
