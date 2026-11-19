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
import { within } from "./llm";
import { key, send, explorer } from "./chain";

export type DeskLeg = {
  symbol: string; label: string; ask: number | null; bid: number | null; mid: number | null; limit: number | null;
  qty: number; cost: number; fillable: boolean; depth: number;
  top: number | null;      // highest ask level needed to fill qty (≤ limit)
  maxSpend: number | null; // qty × limit: worst case for this IOC leg
};
export type DeskQuote = {
  event_ticker: string; event_title: string; expiry?: string; symbols: string[]; payout_usd: number;
  legs: DeskLeg[]; premium: number | null; fair: number | null; spread: number | null; p_bad: number | null;
  expected_payout: number | null; fillable: boolean; max_spend: number | null;
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

/** Contract trading rules from the Gemini event JSON (strings like "0.01"). */
export type LegMeta = { quantityIncrement?: string | number; quantityMinimum?: string | number; priceIncrement?: string | number };
const pos = (x: unknown, d: number) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : d; };
const decimals = (step: number) => Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - 1e-9)));
/** Largest multiple of `step` ≤ x (float-safe). */
export const floorStep = (x: number, step: number) => Number((Math.floor(x / step + 1e-9) * step).toFixed(decimals(step)));
/** Limit price: ask + slippage on the price tick, never below the ask, never above 1 − tick (0.99 on a 1¢ tick). */
export function tickLimit(ask: number, slippage: number, tick = 0.01): number {
  const cap = Number((1 - tick).toFixed(decimals(tick)));
  let l = floorStep(ask + slippage, tick);
  if (l < ask - 1e-9) l = Number((Math.ceil(ask / tick - 1e-9) * tick).toFixed(decimals(tick)));
  return Math.min(l, cap);
}

/** Walk asks up to `limit` for `qty` contracts. */
function walkTo(b: Book, qty: number, limit: number) {
  const asks = [...(b.asks || [])].map((l) => ({ p: Number(l.price), q: Number(l.amount) })).filter((l) => l.p <= limit + 1e-9 && l.q > 0).sort((a, b) => a.p - b.p);
  let left = qty, top: number | null = null;
  for (const l of asks) { if (left <= 1e-9) break; left -= Math.min(left, l.q); top = l.p; }
  return { filled: qty - Math.max(0, left), top };
}

/** Pure sizing from books (unit-tested). Each contract pays $1, so `payout` contracts per scenario bin, rounded DOWN to the
 *  contract's quantity increment; a leg below the contract's minimum is not fillable. */
export function sizeTicket(legs: { symbol: string; label: string; book: Book; meta?: LegMeta }[], payout: number, slippage = 0.02) {
  const out: DeskLeg[] = legs.map((l) => {
    const inc = pos(l.meta?.quantityIncrement, 1), min = pos(l.meta?.quantityMinimum, inc), tick = pos(l.meta?.priceIncrement, 0.01);
    let qty = floorStep(Math.max(0, payout), inc);
    if (qty < min - 1e-9) qty = 0;
    const q = quoteBin(l.symbol, l.book, slippage);
    const limit = q.ask == null ? null : tickLimit(q.ask, slippage, tick);
    const depth = limit == null ? 0 : (l.book.asks || []).filter((x) => Number(x.price) <= limit + 1e-9).reduce((a, x) => a + Number(x.amount), 0);
    const w = walkBook(l.book, qty);
    const lim = limit == null ? null : walkTo(l.book, qty, limit);
    const fillable = !!lim && qty > 0 && lim.filled >= qty - 1e-9;
    return {
      symbol: l.symbol, label: l.label, ask: q.ask, bid: q.bid, mid: q.mid, limit, qty, cost: w.cost, fillable, depth: Math.floor(depth),
      top: fillable ? lim!.top : null, maxSpend: limit == null ? null : r2(qty * limit),
    };
  });
  const qty = out.length ? Math.min(...out.map((l) => l.qty)) : 0;
  const premium = out.some((l) => l.ask == null) ? null : r2(out.reduce((a, l) => a + l.cost, 0));
  const fair = out.some((l) => l.mid == null) ? null : r2(out.reduce((a, l) => a + (l.mid as number) * l.qty, 0));
  const p_bad = out.some((l) => l.mid == null) ? null : r4(Math.min(1, out.reduce((a, l) => a + (l.mid as number), 0)));
  return {
    legs: out, premium, fair, spread: premium != null && fair != null ? r2(premium - fair) : null, p_bad,
    expected_payout: p_bad != null ? r2(p_bad * qty) : null, fillable: out.length > 0 && out.every((l) => l.fillable),
    max_spend: out.some((l) => l.maxSpend == null) ? null : r2(out.reduce((a, l) => a + (l.maxSpend as number), 0)),
  };
}

/** Pure: per-leg limit prices that keep the worst-case IOC spend within the buyer's max (unit-tested).
 *  Prefer ask+slippage; if that worst case could exceed max, cap each leg at the deepest level it needs right now. */
export function limitsWithin(legs: Pick<DeskLeg, "qty" | "limit" | "top">[], maxUsd: number): { prices: number[] } | { error: string } {
  if (legs.some((l) => l.limit == null)) return { error: "No Gemini book: can't buy" };
  const worst = legs.reduce((a, l) => a + l.qty * (l.limit as number), 0);
  if (worst <= maxUsd + 1e-9) return { prices: legs.map((l) => l.limit as number) };
  if (legs.some((l) => l.top == null)) return { error: "Not enough depth at the current price" };
  const tight = legs.reduce((a, l) => a + l.qty * (l.top as number), 0);
  if (tight <= maxUsd + 1e-9) return { prices: legs.map((l) => l.top as number) };
  return { error: `This could cost up to $${tight.toFixed(2)}, over your max of $${maxUsd.toFixed(2)}. Raise the max or lower the payout.` };
}

const REASONS: [RegExp, string][] = [
  [/insufficient ?funds|InsufficientFunds|not enough (funds|balance)/i, "Not enough USD in the Gemini sandbox account. Fund it (sandbox test money) and try again."],
  [/terms/i, "Accept the Gemini prediction-markets terms for this API key first."],
  [/invalid ?signature|InvalidSignature|api ?key|InvalidApiKey|MissingApikey|401|403|Forbidden|Unauthori[sz]ed/i, "Gemini rejected the API key. Check the sandbox trading key/secret and its Trader role."],
  [/InvalidNonce|nonce/i, "Gemini rejected the request nonce (clock or concurrent use). Try again."],
  [/rate ?limit|RateLimit|429|too many/i, "Gemini is rate-limiting. Wait a few seconds and try again."],
  [/InvalidQuantity|quantity/i, "Gemini rejected the quantity (below the contract minimum or off its increment)."],
  [/InvalidPrice|price/i, "Gemini rejected the price (off the 1¢ tick or outside 0.01-0.99)."],
  [/closed|halt|not (open|active)|expired|MarketNotOpen|InvalidSymbol|symbol/i, "This market is not open for trading on Gemini right now."],
  [/self.?trade|SelfCross/i, "Gemini blocked a self-trade against your own resting order."],
];

/** Human-readable reason for a Gemini order rejection (error object, HTTP body text or batch item) (unit-tested). */
export function humanOrderError(x: unknown): string {
  let raw = "";
  if (x instanceof Error) raw = (x as Error & { body?: string }).body || x.message;
  else if (typeof x === "string") raw = x;
  else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    raw = [o.reason, o.error, o.message].filter((v) => typeof v === "string" && v).join(": ") || JSON.stringify(o).slice(0, 300);
  }
  try { const j = JSON.parse(raw); if (j && typeof j === "object") raw = [j.reason, j.message].filter(Boolean).join(": ") || raw; } catch { /* not JSON */ }
  if (x instanceof Error && (x.name === "TimeoutError" || x.name === "AbortError" || /timeout|aborted/i.test(raw)))
    return "Gemini didn't answer in time. Check the Gemini order history before trying again.";
  for (const [re, msg] of REASONS) if (re.test(raw)) return `${msg} (${raw.slice(0, 120)})`;
  return raw.slice(0, 200) || "Gemini rejected the order";
}

type BatchItem = { order?: G.PMOrder; error?: string; message?: string; reason?: string; result?: string; [k: string]: unknown };
/** Pure: map a batch response to fills, one per request, in order (unit-tested). */
export function parseBatch(res: unknown, reqs: { symbol: string; quantity: number; price: number }[]): DeskFill[] {
  const r = res as { results?: BatchItem[]; orders?: BatchItem[] } | BatchItem[] | null;
  const items: BatchItem[] = Array.isArray(r) ? r : r?.results ?? r?.orders ?? [];
  return reqs.map((q, i) => {
    let it = items[i] ?? {};
    if (!it.order && (it as G.PMOrder).orderId != null) it = { order: it as unknown as G.PMOrder }; // bare order objects
    const o = it.order;
    const failed = !o || it.result === "error" || !!it.error;
    return {
      symbol: q.symbol, orderId: o?.orderId != null ? String(o.orderId) : `rejected-${i}`, qty: q.quantity, price: q.price,
      filled: Number(o?.filledQuantity ?? 0) || 0, avgPx: o?.avgExecutionPrice ? Number(o.avgExecutionPrice) : undefined,
      status: failed && !(Number(o?.filledQuantity ?? 0) > 0) ? `rejected: ${humanOrderError(it)}` : String(o?.status ?? "unknown"),
    };
  });
}

const EMPTY: Book = { bids: [], asks: [] };
const paperVenue = (why: string): Venue => ({ data: env.geminiPublic(), trade: env.geminiTrade(), mode: "paper", resolve: env.geminiPublic(), why });

export async function quoteDesk(input: { event_ticker: string; symbols: string[]; payout_usd: number }): Promise<DeskQuote> {
  const payout = Math.max(1, Math.min(10_000, Math.floor(Number(input.payout_usd) || 0)));
  let venue: Venue = await within(venueFor(input.event_ticker, input.symbols), 5_000, paperVenue("venue check timed out"));
  const load = async (base: string) => {
    const e = await within(eventByTicker(input.event_ticker, 15_000, base), 6_000, null);
    if (!e) throw Object.assign(new Error(`Gemini (${hostOf(base)}) didn't return this market in time; try again`), { status: 504 });
    const syms = [...new Set(input.symbols)].filter((s) => e.contracts.some((c) => c.instrumentSymbol === s)).slice(0, 8);
    const legs = await Promise.all(syms.map(async (s) => {
      const c = e.contracts.find((x) => x.instrumentSymbol === s)!;
      return { symbol: s, label: c.label, meta: c as LegMeta, book: await within(book(s, 3_000, base), 4_000, EMPTY) };
    }));
    return { e, syms, legs };
  };
  let q = await load(bookBase(venue));
  if (!q.syms.length) throw Object.assign(new Error("none of those contracts are on this event"), { status: 400 });
  // Listed on the trade venue but with no book there: show the production quote (paper) instead of an empty one.
  if (venue.mode === "live" && q.legs.some((l) => !l.book.asks?.length) && venue.data !== venue.trade) {
    const alt = await load(venue.data).catch(() => null);
    if (alt && alt.syms.length === q.syms.length && alt.legs.every((l) => l.book.asks?.length)) { venue = paperVenue(`no book on ${hostOf(venue.trade)} right now`); q = alt; }
  }
  const { e, syms, legs } = q;
  const z = sizeTicket(legs, payout, env.limitSlippage());
  const sandbox = venue.mode === "live" && isSandbox(venue.trade);
  let reason: string | undefined;
  if (!sandbox) reason = venue.mode === "live" ? "Buying is enabled on the Gemini sandbox only" : `Quote only: ${venue.why ?? "not listed on the trade venue"}`;
  else if (z.premium == null) reason = "No Gemini book: can't buy";
  else if (z.legs.some((l) => l.qty <= 0)) reason = "Payout is below the contract's minimum size";
  else if (!z.fillable) reason = `Not enough depth for ${payout} contracts within ${Math.round(env.limitSlippage() * 100)}¢ of the ask`;
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

function saveTicket(t: DeskTicket) {
  try {
    mutate((s) => {
      const list = (s.desk ??= []);
      const i = list.findIndex((x) => x.id === t.id);
      if (i >= 0) list[i] = t; else list.push(t);
    });
  } catch (e) { log("error", "desk", `ticket ${t.id} not saved: ${String((e as Error).message ?? e).slice(0, 200)}`); }
}

export async function buyDesk(input: { event_ticker: string; symbols: string[]; payout_usd: number; max_usd: number }): Promise<DeskTicket> {
  if (!isSandbox(env.geminiTrade())) throw new Error("Hedge Desk buys are enabled on the Gemini sandbox only");
  const maxUsd = Number(input.max_usd);
  if (!(maxUsd > 0)) throw new Error("type the most you'll pay");
  const q = await quoteDesk(input); // fresh re-price right before sending
  if (!q.tradeable) throw new Error(q.reason ?? "not tradeable");
  if ((q.premium as number) > maxUsd + 1e-9) throw new Error(`Price moved: cover now costs $${(q.premium as number).toFixed(2)}, over your max of $${maxUsd.toFixed(2)}`);
  const lim = limitsWithin(q.legs, maxUsd);
  if ("error" in lim) throw new Error(lim.error);
  const reqs = q.legs.map((l, i) => ({ symbol: l.symbol, side: "buy" as const, outcome: "yes" as const, price: lim.prices[i], quantity: l.qty }));
  const id = `desk-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  let fills: DeskFill[] = [];
  let note: string | undefined;
  try {
    fills = parseBatch(await G.batchOrder(reqs, "A"), reqs);
    const rej = fills.find((f) => f.status.startsWith("rejected"));
    if (rej) note = rej.status.replace(/^rejected: /, "");
  } catch (e) {
    note = humanOrderError(e);
    log("error", "desk", `order failed: ${String((e as Error).message ?? e).slice(0, 300)}`);
  }
  const spent = r4(fills.reduce((a, f) => a + f.filled * (f.avgPx ?? f.price), 0));
  const covered = fills.length ? Math.min(...q.legs.map((l) => fills.find((f) => f.symbol === l.symbol)?.filled ?? 0)) : 0;
  const status: DeskTicket["status"] = !fills.length || fills.every((f) => f.filled <= 0) ? "REJECTED" : covered >= Math.min(...q.legs.map((l) => l.qty)) - 1e-9 ? "FILLED" : "PARTIAL";
  if (status === "REJECTED" && !note) note = "Nothing filled: the book moved away before the order arrived (IOC). Re-quote and try again.";
  const ticket: DeskTicket = { id, createdAt: Date.now(), quote: q, maxUsd, status, fills, spent, covered, note };
  saveTicket(ticket); // persist the fills BEFORE the memo, so a memo failure can never lose the ticket

  if (status !== "REJECTED") {
    const commit = { v: 1, id, venue: q.venue.host, event: q.event_ticker, fills: fills.map((f) => ({ s: f.symbol, o: f.orderId, q: f.filled, p: f.avgPx ?? f.price })), spent, covered };
    const text = `hh:desk:v1:${crypto.createHash("sha256").update(JSON.stringify(commit)).digest("hex")}`;
    ticket.memo = { text };
    try {
      const m = key("merchant");
      const ix = new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: m.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(text, "utf8") });
      const r = await within(send([ix], [m]), 30_000, { ok: false as const, message: "memo not confirmed within 30 s (it may still land)", ms: 30_000 });
      if (r.ok) { ticket.memo.sig = r.sig; ticket.memo.url = explorer(r.sig); } else ticket.memo.error = r.message;
    } catch (e) { ticket.memo.error = String((e as Error).message ?? e).slice(0, 200); }
    saveTicket(ticket);
  }
  log("info", "desk", `${status} ${q.event_ticker} ${fills.map((f) => `${f.filled}/${f.qty} ${f.symbol.split("-").pop()}`).join(", ")} spent $${spent}${ticket.memo?.sig ? ` memo ${ticket.memo.sig}` : ""}`);
  return ticket;
}

export const deskTickets = () => { try { return [...(load().desk ?? [])].reverse(); } catch { return []; } };
