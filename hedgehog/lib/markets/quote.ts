// Deterministic sizing + budget allocation (DESIGN §4 step 4). No LLM here.
import type { HedgeLeg, MarketContract, QuoteLine, Risk, VenueId } from "../types";
import { getBook, type BookLevels } from "./book";
import { contractMeta, type Bounds } from "./normalize";
import { slotKey } from "./index";
import { findEquivalent } from "./compare";
import { monthsOfCover } from "../ai/horizon";

/** Integer-°F/whole-unit aware: "Above 77" (lo 77 exclusive) == "78°F or above" (lo 78 inclusive) for temperatures. */
function boundsKey(b: Bounds | undefined): string | null {
  if (!b) return null;
  const temp = b.unit === "°F" || b.unit === "°C";
  const lo = b.lo === undefined ? "" : String(temp && !b.loInclusive ? b.lo + 1 : b.lo);
  const hi = b.hi === undefined ? "" : String(temp && !b.hiInclusive ? b.hi - 1 : b.hi);
  return `${temp ? "T" : b.unit ?? ""}|${lo}|${hi}|${temp ? "" : `${b.loInclusive}${b.hiInclusive}`}`;
}

/** Same insured outcome on two venues: same slot (peril/day/place or game) and same YES definition. */
export function sameContract(a: MarketContract, b: MarketContract): boolean {
  if (a.peril !== b.peril || slotKey(a) !== slotKey(b)) return false;
  if (a.peril === "game") return a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
  const lowSeries = (c: MarketContract) => /lowest|minimum|\blow\b/i.test(c.eventTitle);
  if ((a.peril === "heat" || a.peril === "cold") && lowSeries(a) !== lowSeries(b)) return false; // daily high ≠ daily low
  const ka = boundsKey(contractMeta(a.id)?.bounds), kb = boundsKey(contractMeta(b.id)?.bounds);
  // outcome-named ladders (Fed: "Hike 25bps" / "Fed maintains rate") match on the label
  if (ka === null && kb === null && a.peril === "fed") return a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
  return ka !== null && ka === kb;
}

export const MAX_INSURANCE_ASK = 0.85;
/** A budget-scaled line paying less than this (in $) is dropped instead of shown as a dust line. */
export const MIN_PAYOUT_USD = 25;
/** First pass of the budget split: one line takes at most this share while other lines are still unfunded. */
export const MAX_LINE_SHARE = 0.6;
/** Don't walk the book more than this above the top ask (keeps the avg fill near the quoted price). */
export const MAX_SLIPPAGE = 0.1;

type Level = { price: number; size: number };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Demo: cover can be priced from ANY of the 3 venues (whichever is cheapest for the same contract). The policy is sold
 *  on Solana; the desk's backing order on that venue is recorded but only ever placed on Gemini (and only when live). */
export const isCoverable = (c: MarketContract): boolean => c.status === "open" && (c.tradable || c.venue === "polymarket") && fitsOnchain(c.id);
/** The Cover program stores marketRef in <= 64 bytes; longer ids (some Polymarket slugs) could be quoted but never bought. */
export const fitsOnchain = (id: string): boolean => new TextEncoder().encode(id).length <= 64;
export const actionFor = (c: MarketContract): QuoteLine["action"] =>
  isCoverable(c) ? "buy-onchain" : c.venue === "gemini" ? "open-on-gemini" : "read-only";

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
  /** Attach a Polymarket cross-check to each line (default: same as fetchBooks; network, capped at ~4s). */
  crossCheck?: boolean;
  /** Best-execution routing: move a Kalshi leg to the identical Gemini contract when it is no dearer (default true). */
  route?: boolean;
  /** Clock for months-of-cover (season / month-total contracts are charged premium / months against the monthly budget). */
  now?: Date;
}

/**
 * Months a contract's cover runs from `now` (1..6): only contracts that OBSERVE a long window (season futures, month /
 * season totals). A single event far away (a Fed meeting in March) is one event, not months of cover.
 */
export function coverMonths(c: MarketContract, now = new Date()): number {
  const m = contractMeta(c.id);
  if (!m?.eventEnd) return 1;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(now);
  const from = m.eventDate && m.eventDate > today ? m.eventDate : today;
  const span = (Date.parse(`${m.eventEnd}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000;
  return m.futureKind || span >= 20 ? monthsOfCover(m.eventEnd, now) : 1;
}

/** Gemini may cost at most this much more than Kalshi for the same contract and still win the route. */
export const ROUTE_TOLERANCE = 0.01;
/** Max price gap between "the same contract" on two venues before the match is treated as a different event. */
export const MAX_ROUTE_GAP = 0.25;

/**
 * Deterministic venue router ("priced & hedged on Gemini"): for each Kalshi leg, if `contracts` holds the SAME
 * contract on Gemini (same game + same YES team, or same day/place + same bounds) whose ask on that side is an
 * insurance price and not dearer than Kalshi's (+1¢ tolerance), the leg is re-pointed at Gemini. Kalshi keeps
 * the leg when it is clearly cheaper or Gemini has no usable ask.
 */
/**
 * Best-price router (demo): for each leg, look for the SAME contract on the other venues (cross-venue matcher, which
 * also handles flipped wording like "Spurs win NO" = "Clippers win YES") and re-point the leg at the cheapest ask for
 * the side that pays. Ties (within half a cent) go to Gemini, then Kalshi, then Polymarket.
 */
export function routeToBest(legs: HedgeLeg[], contracts: Map<string, MarketContract>): HedgeLeg[] {
  const pool = [...contracts.values()].filter(isCoverable);
  // hedgehog (parametric) is never a route target: it only exists where no venue lists the peril
  const pref: Record<VenueId, number> = { gemini: 0, kalshi: 0.002, polymarket: 0.004, hedgehog: 0.01 };
  const taken = new Set(legs.map((l) => l.contractId));
  return legs.map((leg) => {
    const c = contracts.get(leg.contractId);
    if (!c) return leg;
    const askOf = (k: MarketContract, s: "yes" | "no") => (s === "yes" ? k.yesAsk : k.noAsk);
    const opts: { c: MarketContract; side: "yes" | "no"; ask: number }[] = [];
    const own = askOf(c, leg.side);
    if (own !== null && own <= MAX_INSURANCE_ASK && isCoverable(c)) opts.push({ c, side: leg.side, ask: own });
    for (const v of ["gemini", "kalshi", "polymarket"] as const) {
      if (v === c.venue) continue;
      const eq = findEquivalent(c, leg.side, pool.filter((p) => p.venue === v && !taken.has(p.id)));
      if (!eq || eq.match !== "same") continue;
      const a = askOf(eq.contract, eq.side);
      // the same question can't be priced 25+ points apart on two venues: that "match" is a different event (QA cycle 1:
      // a 10c Nov 20 daily rain market replaced a 76c Nov 21-22 weekend market)
      if (own !== null && a !== null && Math.abs(a - own) > MAX_ROUTE_GAP) continue;
      if (a !== null && a <= MAX_INSURANCE_ASK) opts.push({ c: eq.contract, side: eq.side, ask: a });
    }
    if (!opts.length) return leg;
    opts.sort((x, y) => x.ask + pref[x.c.venue] - (y.ask + pref[y.c.venue]));
    const best = opts[0];
    if (best.c.id === c.id) return leg;
    taken.add(best.c.id);
    const others = opts.filter((o) => o !== best).map((o) => `${o.c.venue} ${Math.round(o.ask * 100)}¢`).join(", ");
    return { ...leg, contractId: best.c.id, side: best.side, rationale: `${leg.rationale}${leg.rationale ? " " : ""}(Best price: ${best.c.venue} ${Math.round(best.ask * 100)}¢${others ? ` vs ${others}` : ""}.)` };
  });
}

/** @deprecated kept for tests/back-compat; the quote now uses routeToBest. */
export function routeToGemini(legs: HedgeLeg[], contracts: Map<string, MarketContract>): HedgeLeg[] {
  const gem = [...contracts.values()].filter((c) => c.venue === "gemini" && c.status === "open" && c.tradable);
  if (!gem.length) return legs;
  const taken = new Set(legs.map((l) => l.contractId));
  return legs.map((leg) => {
    const k = contracts.get(leg.contractId);
    if (!k || k.venue !== "kalshi") return leg;
    const kAsk = leg.side === "yes" ? k.yesAsk : k.noAsk;
    const best = gem
      .filter((g) => !taken.has(g.id) && sameContract(k, g))
      .map((g) => ({ g, ask: leg.side === "yes" ? g.yesAsk : g.noAsk }))
      .filter((x): x is { g: MarketContract; ask: number } => x.ask !== null && x.ask <= MAX_INSURANCE_ASK && (kAsk === null || x.ask <= kAsk + ROUTE_TOLERANCE + 1e-9))
      .sort((a, b) => a.ask - b.ask)[0];
    if (!best) return leg;
    taken.add(best.g.id);
    return { ...leg, contractId: best.g.id, rationale: `${leg.rationale}${leg.rationale ? " " : ""}(Routed to the identical Gemini contract at ${Math.round(best.ask * 100)}¢${kAsk !== null ? ` vs Kalshi ${Math.round(kAsk * 100)}¢` : ""}.)` };
  });
}
export interface SizeResult { lines: QuoteLine[]; uncovered: { riskId: string; reason: string }[]; totalPremiumUsd: number; totalPayoutUsd: number }

export async function sizeQuote(args: SizeArgs): Promise<SizeResult> {
  const { risks, contracts, coveragePct, budgetUsd } = args;
  const legs = args.route === false ? args.legs : routeToBest(args.legs, contracts);
  const books = new Map(args.books ?? []);
  const uncovered: SizeResult["uncovered"] = [];
  const riskById = new Map(risks.map((r) => [r.id, r]));

  if (args.fetchBooks !== false) {
    await Promise.all(legs.map(async (l) => {
      const c = contracts.get(l.contractId);
      if (c && !books.has(c.id) && c.status === "open") books.set(c.id, await getBook(c));
    }));
  }

  type Cand = { line: QuoteLine; ladder: Level[]; want: number; months: number };
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
    // slippage relative to the quoted ask too (QA cycle 3: a 4c top-of-book walked to a 9c average, doubling the price quoted)
    const cap = Math.min(MAX_INSURANCE_ASK, topAsk + Math.min(args.maxSlippage ?? MAX_SLIPPAGE, Math.max(0.02, topAsk * 0.5)));
    const ladder = ladderFor(c, leg.side, books.get(c.id)).filter((l) => l.price <= cap + 1e-9);
    const w = walk(ladder, want);
    const filled = Math.floor(w.filled);
    if (filled <= 0) { uncovered.push({ riskId: leg.riskId, reason: `no ${leg.side.toUpperCase()} liquidity at or below $${cap.toFixed(2)}` }); continue; }
    // a depth-capped line paying crumbs against the loss is noise, not cover (QA cycle 3: $19 of payout on a $3,600 loss kept in
    // the plan because MIN_PAYOUT_USD only applied to budget-scaled lines)
    if (filled < want && filled < Math.min(want, Math.max(MIN_PAYOUT_USD, 0.01 * risk.lossUsd))) {
      uncovered.push({ riskId: leg.riskId, reason: `Only ${filled} contract${filled === 1 ? "" : "s"} offered near the quoted price on "${c.label}": a $${filled} payout is too small to be worth buying.` });
      continue;
    }
    const cost = walk(ladder, filled).cost;
    const line: QuoteLine = {
      ...leg, contract: c, coveragePct, contracts: filled,
      pricePerContract: r4(cost / filled), premiumUsd: r2(cost), payoutUsd: filled,
      impliedProb: topAsk, action: actionFor(c),
    };
    if (filled < want) line.maxCoverable = Math.floor(w.available);
    const months = coverMonths(c, args.now);
    cands.push({ line, ladder, want: filled, months });
  }

  // Read-only (context) lines are shown but never bought, so they don't spend the budget or count in totals.
  const context = cands.filter((c) => c.line.action === "read-only").map((c) => c.line);
  const buyable = cands.filter((c) => c.line.action !== "read-only");
  cands.length = 0; cands.push(...buyable);

  // Budget: the owner pays every premium up front, so the plan's total premium must fit the budget (no spreading a season
  // hedge over months: that let a $782 plan "fit" $200). Keep the best payout-per-premium lines first; scale the marginal one; drop the rest.
  const charge = (c: Cand) => c.line.premiumUsd;
  let total = cands.reduce((s, c) => s + charge(c), 0);
  let lines: QuoteLine[];
  if (total <= budgetUsd + 1e-9) {
    lines = cands.map((c) => c.line);
  } else {
    // cheapest protection first (payout per premium dollar): this week's cheap tails stay in; a season line takes what is left
    // direct risks are funded before creative (proxy) hedges, then best payout per premium dollar
    const proxy = (c: Cand) => (riskById.get(c.line.riskId)?.kind === "proxy" ? 1 : 0);
    // QA cycle 2: value alone funded a $1,500 diesel bet and a secondary snow month before the $18-30k core risk; weight
    // value by the loss at stake (sqrt keeps a cheap tail competitive without letting it starve the main exposure)
    const prio = (c: Cand) => (riskById.get(c.line.riskId)?.lossUsd ?? 0) * Math.sqrt(c.line.payoutUsd / Math.max(0.01, c.line.premiumUsd));
    const order = [...cands].sort((a, b) => proxy(a) - proxy(b) || prio(b) - prio(a));
    let left = budgetUsd;
    const kept = new Set<Cand>();
    // pass 1: no single line takes more than MAX_LINE_SHARE of the budget while other lines wait (QA cycle 1: 52-92% of a
    // budget on one line while direct risks went unfunded); pass 2 hands what is left back in the same order
    const cap = order.length > 1 ? budgetUsd * MAX_LINE_SHARE : budgetUsd;
    const full = new Map<Cand, number>(); // contracts wanted before scaling
    for (const c of order) {
      const allow = Math.min(left, cap);
      if (charge(c) <= allow + 1e-9) { kept.add(c); left -= charge(c); continue; }
      full.set(c, c.want);
      const { n, cost } = maxAffordable(c.ladder, c.want, allow);
      // a scaled line must still be worth having: "$0.04 for a $1 payout" is noise, not cover (QA cycle 1)
      if (n >= Math.min(c.want, MIN_PAYOUT_USD)) {
        c.line = { ...c.line, contracts: n, payoutUsd: n, premiumUsd: r2(cost), pricePerContract: r4(cost / n) };
        kept.add(c); left -= cost;
      }
    }
    for (const c of order) {
      if (!full.has(c)) continue;
      const had = kept.has(c) ? c.line.premiumUsd : 0;
      const { n, cost } = maxAffordable(c.ladder, full.get(c)!, had + left);
      if (n >= Math.min(full.get(c)!, MIN_PAYOUT_USD) && cost >= had - 1e-9) {
        c.line = { ...c.line, contracts: n, payoutUsd: n, premiumUsd: r2(cost), pricePerContract: r4(cost / n) };
        left -= cost - had; kept.add(c);
      }
    }
    for (const c of order) {
      if (!full.has(c)) continue;
      if (kept.has(c)) uncovered.push({ riskId: c.line.riskId, reason: `budget: scaled ${c.line.contract.label} to ${c.line.contracts} of ${full.get(c)} contracts` });
      else uncovered.push({ riskId: c.line.riskId, reason: `over budget: ${c.line.contract.label} needs $${c.line.premiumUsd.toFixed(2)}, $${Math.max(0, left).toFixed(2)} left of $${budgetUsd}` });
    }
    lines = cands.filter((c) => kept.has(c)).map((c) => c.line);
  }
  total = r2(lines.reduce((s, l) => s + l.premiumUsd, 0));
  const totalPayoutUsd = lines.reduce((s, l) => s + l.payoutUsd, 0);
  lines = [...lines, ...context];
  if (args.crossCheck ?? args.fetchBooks !== false) {
    try {
      const { attachCrossChecks } = await import("./index");
      await Promise.race([attachCrossChecks(lines), new Promise((r) => setTimeout(r, 4_000))]);
    } catch { /* cross-check is optional */ }
  }
  return { lines, uncovered, totalPremiumUsd: total, totalPayoutUsd };
}
