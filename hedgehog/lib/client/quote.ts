// Client-side quote sizing (mirrors DESIGN §4 step 4) — used to rescale coverage without re-calling the AI.
import type { Quote, QuoteLine, Risk } from "@/lib/types";

export type Coverage = 25 | 50 | 100;

/** Resize every line to `pct` of its risk's loss, cap by book depth (maxCoverable), then fit the budget.
 *  Monotonic in coverage (QA #7): 50% starts from what 25% funded and 100% from what 50% funded, so choosing more
 *  coverage never pays less on any line. */
export function rescaleQuote(q: Quote, pct: Coverage): Quote {
  let floor: number[] = [];
  let out = sizeAt(q, 25, floor);
  for (const c of [50, 100] as const) {
    if (c > pct) break;
    floor = out.lines.map((l) => l.contracts);
    out = sizeAt(q, c, floor);
  }
  return out;
}

/** One coverage level; `floor[i]` = contracts line i keeps from the level below (already inside the budget). */
function sizeAt(q: Quote, pct: Coverage, floor: number[]): Quote {
  const risks = new Map<string, Risk>(q.risks.map((r) => [r.id, r]));
  // keep lines that were cut for budget too — we re-derive from the full list
  const wantOf = new Map<QuoteLine, number>();
  const sized: QuoteLine[] = q.lines.map((l, i) => {
    const risk = risks.get(l.riskId);
    const price = l.pricePerContract || (l.side === "yes" ? l.contract.yesAsk : l.contract.noAsk) || 0.5;
    const want = Math.ceil(((risk?.lossUsd ?? l.payoutUsd) * pct) / 100);
    // `maxCoverable` (set by the quote engine after walking the book) is the hard cap; we keep it on the line.
    const cap = l.maxCoverable != null && l.maxCoverable > 0 ? Math.floor(l.maxCoverable) : undefined;
    const contracts = Math.max(cap != null ? Math.min(want, cap) : want, floor[i] ?? 0);
    const { premiumPerMonth: _pm, ...rest } = l; // the budget caps the up-front premium; no per-month spreading
    const out = { ...rest, coveragePct: pct, contracts, pricePerContract: price, premiumUsd: round2(contracts * price), payoutUsd: contracts };
    wantOf.set(out, want);
    return out;
  });
  const base = new Map<QuoteLine, number>(sized.map((l, i) => [l, Math.min(l.contracts, floor[i] ?? 0)]));
  const cost = (l: QuoteLine, n: number) => round2(n * l.pricePerContract);
  let left = q.budgetUsd > 0 ? q.budgetUsd : Infinity;
  for (const l of sized) if (l.action !== "read-only") left -= cost(l, base.get(l)!);
  // direct risks before creative (proxy) hedges, then the loss at stake weighted by value (same order as lib/markets/quote.ts)
  const proxy = (l: QuoteLine) => (risks.get(l.riskId)?.kind === "proxy" ? 1 : 0);
  const prio = (l: QuoteLine) => (risks.get(l.riskId)?.lossUsd ?? 0) * Math.sqrt(1 / Math.max(0.01, l.pricePerContract));
  const order = [...sized].sort((a, b) => proxy(a) - proxy(b) || prio(b) - prio(a));
  const out = new Map<QuoteLine, QuoteLine>();
  // same split as the quote engine (lib/markets/quote.ts sizeQuote): pass 1 caps one line at 60% of the budget while others
  // wait, pass 2 hands the rest back in order; a new line paying under $25 is noise and stays unfunded (also a thin book's $4 line)
  const buyable = order.filter((l) => l.action !== "read-only");
  const cap = buyable.length > 1 ? (q.budgetUsd > 0 ? q.budgetUsd : Infinity) * 0.6 : Infinity;
  const fit = (l: QuoteLine, money: number) => {
    const b = base.get(l)!;
    const n = Math.min(l.contracts, b + Math.floor((money + 1e-9) / Math.max(l.pricePerContract, 0.01)));
    if (b > 0) return n;
    return n >= 1 && n >= Math.min(wantOf.get(l)!, 25) ? n : 0;
  };
  for (const l of order) {
    if (l.action === "read-only") { out.set(l, l); continue; }
    const b = base.get(l)!;
    if (b === 0 && l.contracts < Math.min(wantOf.get(l)!, 25)) { out.set(l, { ...l, contracts: 0, premiumUsd: 0, payoutUsd: 0 }); continue; }
    const extra = cost(l, l.contracts) - cost(l, b);
    const allow = Math.min(left, Math.max(0, cap - cost(l, b)));
    if (extra <= allow + 1e-9) { left -= extra; out.set(l, l); continue; }
    const n = fit(l, allow);
    left -= cost(l, n) - cost(l, b);
    out.set(l, { ...l, contracts: n, premiumUsd: cost(l, n), payoutUsd: n });
  }
  for (const l of order) {
    const cur = out.get(l)!;
    if (l.action === "read-only" || cur.contracts >= l.contracts) continue;
    const n = fit(l, cost(l, cur.contracts) - cost(l, base.get(l)!) + left);
    if (n <= cur.contracts) continue;
    left -= cost(l, n) - cost(l, cur.contracts);
    out.set(l, { ...l, contracts: n, premiumUsd: cost(l, n), payoutUsd: n });
  }
  const lines = sized.map((l) => out.get(l)!);
  const counted = lines.filter((l) => l.action !== "read-only");
  return {
    ...q,
    lines,
    totalPremiumUsd: round2(counted.reduce((s, l) => s + l.premiumUsd, 0)),
    totalPayoutUsd: round2(counted.reduce((s, l) => s + l.payoutUsd, 0)),
  };
}

export function round2(n: number) { return Math.round(n * 100) / 100; }
