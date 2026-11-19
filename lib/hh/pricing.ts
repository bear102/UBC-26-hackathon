// Strip pricing, depth caps, tranche sizing and agent guards (SPEC §5.2). Pure functions, unit-tested.
import type { Book } from "./gemini";

export type BinQuote = { symbol: string; ask: number | null; bid: number | null; mid: number | null; limit: number | null; depth: number };
export type StripQuote = {
  bins: BinQuote[];
  costPerReceipt: number | null; // Σ ask × k
  fair: number | null;           // Σ mid × k
  spread: number | null;
  maxReceipts: number;           // floor(min depth / k)
  hedgeable: boolean;
  reason?: string;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export function quoteBin(symbol: string, b: Book, slippage = 0.02): BinQuote {
  const asks = [...(b.asks || [])].map((l) => ({ p: Number(l.price), q: Number(l.amount) })).sort((a, b) => a.p - b.p);
  const bids = [...(b.bids || [])].map((l) => ({ p: Number(l.price), q: Number(l.amount) })).sort((a, b) => b.p - a.p);
  const ask = asks.length ? asks[0].p : null;
  const bid = bids.length ? bids[0].p : null;
  const mid = ask != null && bid != null ? (ask + bid) / 2 : ask != null ? ask / 2 : null;
  const limit = ask != null ? Math.min(r2(ask + slippage), 0.99) : null;
  const depth = limit == null ? 0 : asks.filter((l) => l.p <= limit + 1e-9).reduce((s, l) => s + l.q, 0);
  return { symbol, ask, bid, mid, limit, depth };
}

/** k = contracts per receipt = refund in USD (contracts pay $1). */
export function quoteStrip(bins: BinQuote[], k = 1): StripQuote {
  if (!bins.length) return { bins, costPerReceipt: null, fair: null, spread: null, maxReceipts: 0, hedgeable: false, reason: "empty strip" };
  const missing = bins.find((b) => b.ask == null);
  if (missing) return { bins, costPerReceipt: null, fair: null, spread: null, maxReceipts: 0, hedgeable: false, reason: `No Gemini book: can't hedge (${missing.symbol})` };
  const cost = r4(bins.reduce((s, b) => s + (b.ask as number), 0) * k);
  const fair = r4(bins.reduce((s, b) => s + (b.mid as number), 0) * k);
  const maxReceipts = Math.floor(Math.min(...bins.map((b) => b.depth)) / k + 1e-9);
  return { bins, costPerReceipt: cost, fair, spread: r4(cost - fair), maxReceipts, hedgeable: maxReceipts > 0 };
}

/** Walk the ask side for `qty` contracts. Returns cost and whether it is fillable. */
export function walkBook(b: Book, qty: number): { cost: number; filled: number; fillable: boolean } {
  const asks = [...(b.asks || [])].map((l) => ({ p: Number(l.price), q: Number(l.amount) })).sort((a, b) => a.p - b.p);
  let left = qty, cost = 0;
  for (const l of asks) {
    if (left <= 0) break;
    const take = Math.min(left, l.q);
    cost += take * l.p;
    left -= take;
  }
  return { cost: r2(cost), filled: qty - left, fillable: left <= 1e-9 };
}

export type GuardInput = {
  bins: BinQuote[];
  needContracts: number[];      // per bin, contracts to buy
  k: number;
  targetReceipts: number;
  cap: number;
  premiumToday: number;
  dailyBudget: number;
  priceCeiling: number;
  now: number;                  // unix s
  salesCloseTs: number;
  halted: boolean;
};

/** All guards must pass before an order is sent. Returns null if ok, else the reason. */
export function guardReason(g: GuardInput): string | null {
  if (g.halted) return "agent halted";
  if (g.bins.some((b) => b.ask == null || b.limit == null)) return "book empty";
  const sumAsk = g.bins.reduce((s, b) => s + (b.ask as number), 0);
  if (sumAsk > g.priceCeiling * g.k + 1e-9) return `price ceiling: Σask ${sumAsk.toFixed(2)} > ${(g.priceCeiling * g.k).toFixed(2)}`;
  const spend = g.bins.reduce((s, b, i) => s + (b.limit as number) * g.needContracts[i], 0);
  if (g.premiumToday + spend > g.dailyBudget + 1e-9) return `daily budget: ${(g.premiumToday + spend).toFixed(2)} > ${g.dailyBudget}`;
  if (g.targetReceipts > g.cap) return "target exceeds liability cap";
  if (g.now >= g.salesCloseTs - 60) return "too close to sales close";
  if (g.needContracts.every((q) => q <= 0)) return "nothing to buy";
  return null;
}

/** Tranche target (§5.2). threshold -1 = revert-only. */
export function trancheTarget(o: { hedgedCapacity: number; sold: number; cap: number; threshold: number; revertSeen: boolean; tranche?: number }): number | null {
  const t = o.tranche ?? 10;
  if (o.hedgedCapacity >= o.cap) return null;
  const byThreshold = o.threshold >= 0 && o.cap - o.sold > 0 && o.hedgedCapacity - o.sold <= o.threshold;
  if (!byThreshold && !o.revertSeen) return null;
  return Math.min(o.hedgedCapacity + t, o.cap);
}

/** Contracts per bin needed so that `target` receipts are covered, given what is already held/allocated. */
export function needPerBin(target: number, k: number, held: number[]): number[] {
  return held.map((h) => Math.max(0, r2(target * k - h)));
}

/** qty in contracts → centi-contracts (onchain unit). */
export const toCenti = (q: number) => Math.round(q * 100);
/** receipts covered by qty contracts at refund_usd per receipt */
export const capacityOf = (qtyCenti: number[], refundUnits: number) =>
  qtyCenti.length ? Math.min(...qtyCenti.map((q) => Math.floor((q * 10_000) / refundUnits))) : 0;
