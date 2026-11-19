// Deterministic sizing + budget allocation (DESIGN §4 step 4). No LLM here.
import type { HedgeLeg, MarketContract, QuoteLine, Risk } from "../types";
import { getBook, type BookLevels } from "./book";

export const MAX_INSURANCE_ASK = 0.85;
/** Don't walk the book more than this above the top ask (keeps the avg fill near the quoted price). */
export const MAX_SLIPPAGE = 0.1;

type Level = { price: number; size: number };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export const actionFor = (c: MarketContract): QuoteLine["action"] =>
  c.venue === "kalshi" && c.tradable ? "buy-onchain" : c.venue === "gemini" ? "open-on-gemini" : "read-only";

/** Ask ladder for one side: real book if given, else a single level at the top ask (sized by depth if known, else unlimited). */
export function ladderFor(c: MarketContract, side: "yes" | "no", book?: BookLevels | null): Level[] {
  const ask = side === "yes" ? c.yesAsk : c.noAsk;
  const fromBook = book?.[side]?.filter((l) => l.price > 0 && l.price < 1 && l.size > 0).sort((a, b) => a.price - b.price);
  if (fromBook && fromBook.length) return fromBook;
  if (ask === null) return [];
  const depth = side === "yes" ? c.depthYes : c.depthNo;
  return [{ price: ask, size: depth !== undefined && depth > 0 ? depth : Number.POSITIVE_INFINITY }];
}

/** Walk the ladder for `want` contracts, never paying above `cap`. */
export function walk(levels: Level[], want: number, cap = MAX_INSURANCE_ASK): { filled: number; cost: number; available: number } {
  let filled = 0, cost = 0, available = 0;
  for (const l of levels) {
    if (l.price > cap + 1e-9) break;
    available += l.size;
    const take = Math.min(l.size, want - filled);
    if (take > 0) { filled += take; cost += take * l.price; }
  }
  return { filled, cost, available };
}

/** Largest integer n <= max whose walked cost fits in `budget`. */
function maxAffordable(levels: Level[], max: number, budget: number): { n: number; cost: number } {
  let n = 0, cost = 0;
  for (const l of levels) {
    if (l.price > MAX_INSURANCE_ASK + 1e-9) break;
    const room = Math.min(l.size, max - n);
    if (room <= 0) break;
    const k = Math.min(room, Math.floor((budget - cost) / l.price + 1e-9));
    n += k; cost += k * l.price;
    if (k < room) break;
  }
  return { n: Math.floor(n), cost };
}

export interface SizeArgs {
  legs: HedgeLeg[];
  risks: Risk[];
  contracts: Map<string, MarketContract>;
  coveragePct: number;
  budgetUsd: number;
  /** Optional pre-fetched ask ladders by contract id (tests / callers that already hold books). */
  books?: Map<string, BookLevels | null>;
  /** Fetch live books for legs without one in `books` (default true). */
  fetchBooks?: boolean;
  /** Max price above the top ask to walk the book (default MAX_SLIPPAGE). */
  maxSlippage?: number;
}
export interface SizeResult { lines: QuoteLine[]; uncovered: { riskId: string; reason: string }[]; totalPremiumUsd: number; totalPayoutUsd: number }

export async function sizeQuote(args: SizeArgs): Promise<SizeResult> {
  const { legs, risks, contracts, coveragePct, budgetUsd } = args;
  const books = new Map(args.books ?? []);
  const uncovered: SizeResult["uncovered"] = [];
  const riskById = new Map(risks.map((r) => [r.id, r]));

  if (args.fetchBooks !== false) {
    await Promise.all(legs.map(async (l) => {
      const c = contracts.get(l.contractId);
      if (c && !books.has(c.id) && c.status === "open") books.set(c.id, await getBook(c));
    }));
  }

  type Cand = { line: QuoteLine; ladder: Level[]; want: number };
  const cands: Cand[] = [];
  for (const leg of legs) {
    const risk = riskById.get(leg.riskId);
    const c = contracts.get(leg.contractId);
    if (!risk) { uncovered.push({ riskId: leg.riskId, reason: `unknown risk ${leg.riskId}` }); continue; }
    if (!c) { uncovered.push({ riskId: leg.riskId, reason: `contract ${leg.contractId} not found` }); continue; }
    if (c.status !== "open") { uncovered.push({ riskId: leg.riskId, reason: `${c.label} market is ${c.status}` }); continue; }
    const topAsk = leg.side === "yes" ? c.yesAsk : c.noAsk;
    if (topAsk === null) { uncovered.push({ riskId: leg.riskId, reason: `no ${leg.side.toUpperCase()} offers on "${c.label}" (no ask)` }); continue; }
    if (topAsk > MAX_INSURANCE_ASK) {
      uncovered.push({ riskId: leg.riskId, reason: `too expensive to be insurance: ${leg.side.toUpperCase()} ask $${topAsk.toFixed(2)} > $${MAX_INSURANCE_ASK} (event is already likely)` });
      continue;
    }
    const want = Math.ceil((coveragePct / 100) * risk.lossUsd - 1e-9);
    if (want <= 0) { uncovered.push({ riskId: leg.riskId, reason: "nothing to cover (loss or coverage is 0)" }); continue; }
    const cap = Math.min(MAX_INSURANCE_ASK, topAsk + (args.maxSlippage ?? MAX_SLIPPAGE));
    const ladder = ladderFor(c, leg.side, books.get(c.id)).filter((l) => l.price <= cap + 1e-9);
    const w = walk(ladder, want);
    const filled = Math.floor(w.filled);
    if (filled <= 0) { uncovered.push({ riskId: leg.riskId, reason: `no ${leg.side.toUpperCase()} liquidity at or below $${cap.toFixed(2)}` }); continue; }
    const cost = walk(ladder, filled).cost;
    const line: QuoteLine = {
      ...leg, contract: c, coveragePct, contracts: filled,
      pricePerContract: r4(cost / filled), premiumUsd: r2(cost), payoutUsd: filled,
      impliedProb: topAsk, action: actionFor(c),
    };
    if (filled < want) line.maxCoverable = Math.floor(w.available);
    cands.push({ line, ladder, want: filled });
  }

  // Budget: keep the best payout-per-premium lines first; scale the marginal one; drop the rest.
  let total = cands.reduce((s, c) => s + c.line.premiumUsd, 0);
  let lines: QuoteLine[];
  if (total <= budgetUsd + 1e-9) {
    lines = cands.map((c) => c.line);
  } else {
    const order = [...cands].sort((a, b) => b.line.payoutUsd / b.line.premiumUsd - a.line.payoutUsd / a.line.premiumUsd);
    let left = budgetUsd;
    const kept = new Set<Cand>();
    for (const c of order) {
      if (c.line.premiumUsd <= left + 1e-9) { kept.add(c); left -= c.line.premiumUsd; continue; }
      const { n, cost } = maxAffordable(c.ladder, c.want, left);
      if (n >= 1) {
        c.line = { ...c.line, contracts: n, payoutUsd: n, premiumUsd: r2(cost), pricePerContract: r4(cost / n) };
        kept.add(c); left -= cost;
        uncovered.push({ riskId: c.line.riskId, reason: `budget: scaled ${c.line.contract.label} to ${n} of ${c.want} contracts` });
      } else {
        uncovered.push({ riskId: c.line.riskId, reason: `over budget: ${c.line.contract.label} needs $${c.line.premiumUsd.toFixed(2)}, $${Math.max(0, left).toFixed(2)} left of $${budgetUsd}` });
      }
    }
    lines = cands.filter((c) => kept.has(c)).map((c) => c.line);
  }
  total = r2(lines.reduce((s, l) => s + l.premiumUsd, 0));
  return { lines, uncovered, totalPremiumUsd: total, totalPayoutUsd: lines.reduce((s, l) => s + l.payoutUsd, 0) };
}
