// Client-side quote sizing (mirrors DESIGN §4 step 4) — used to rescale coverage without re-calling the AI.
import type { Quote, QuoteLine, Risk } from "@/lib/types";

export type Coverage = 25 | 50 | 100;

/** Resize every line to `pct` of its risk's loss, cap by book depth (maxCoverable), then greedily fit the budget (best payout/$ first). */
export function rescaleQuote(q: Quote, pct: Coverage): Quote {
  const risks = new Map<string, Risk>(q.risks.map((r) => [r.id, r]));
  // keep lines that were cut for budget too — we re-derive from the full list
  const sized: QuoteLine[] = q.lines.map((l) => {
    const risk = risks.get(l.riskId);
    const price = l.pricePerContract || (l.side === "yes" ? l.contract.yesAsk : l.contract.noAsk) || 0.5;
    const want = Math.ceil(((risk?.lossUsd ?? l.payoutUsd) * pct) / 100);
    // `maxCoverable` (set by the quote engine after walking the book) is the hard cap; we keep it on the line.
    const cap = l.maxCoverable != null && l.maxCoverable > 0 ? Math.floor(l.maxCoverable) : undefined;
    const contracts = cap != null ? Math.min(want, cap) : want;
    const { premiumPerMonth: _pm, ...rest } = l; // the budget caps the up-front premium; no per-month spreading
    return {
      ...rest,
      coveragePct: pct,
      contracts,
      premiumUsd: round2(contracts * price),
      payoutUsd: contracts,
    };
  });
    let left = q.budgetUsd > 0 ? q.budgetUsd : Infinity;
  // direct risks before creative (proxy) hedges, then cheapest probability first
  const proxy = (l: QuoteLine) => (risks.get(l.riskId)?.kind === "proxy" ? 1 : 0);
  const order = [...sized].sort((a, b) => proxy(a) - proxy(b) || a.pricePerContract - b.pricePerContract);
  const out = new Map<QuoteLine, QuoteLine>();
  for (const l of order) {
    if (l.action === "read-only") { out.set(l, l); continue; }
    if (l.premiumUsd <= left + 1e-9) { left -= l.premiumUsd; out.set(l, l); continue; }
    const fit = Math.floor(left / Math.max(l.pricePerContract, 0.01));
    if (fit < 1) { out.set(l, { ...l, contracts: 0, premiumUsd: 0, payoutUsd: 0 }); continue; }
    const prem = round2(fit * l.pricePerContract);
    const nl = { ...l, contracts: fit, premiumUsd: prem, payoutUsd: fit };
    left -= prem;
    out.set(l, nl);
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
