import { test } from "node:test";
import assert from "node:assert/strict";
import { rescaleQuote } from "../lib/client/quote";
import type { Quote } from "../lib/types";

const contract = { id: "kalshi:K", venue: "kalshi", eventTitle: "Rain", label: "Austin", symbol: "K", eventTicker: "K", peril: "rain", expiry: "2026-11-23T00:00:00Z", yesAsk: 0.2, yesBid: 0.18, noAsk: 0.82, noBid: 0.8, tradable: true, status: "open" } as const;
const base = (lossUsd: number, budgetUsd: number): Quote => ({
  businessId: "b", createdAt: "2026-11-19T00:00:00Z", budgetUsd, summary: "", model: "test", uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0,
  risks: [{ id: "r1", peril: "rain", title: "Rain", trigger: "rain", lossUsd, lossReasoning: "", confidence: 0.8 }],
  lines: [{ riskId: "r1", contractId: contract.id, side: "yes", rationale: "", basisRisk: "", contract: { ...contract }, coveragePct: 50, contracts: 0, pricePerContract: 0.2, premiumUsd: 0, payoutUsd: 0, impliedProb: 0.2, action: "buy-onchain" }],
});

test("editing the estimated loss re-sizes the hedge (coverage % of the new loss)", () => {
  const q1 = rescaleQuote(base(1000, 10_000), 50);
  assert.equal(q1.lines[0].contracts, 500);
  assert.equal(q1.lines[0].premiumUsd, 100);
  const edited = { ...q1, risks: q1.risks.map((r) => ({ ...r, lossUsdAi: r.lossUsd, lossUsd: 2000 })) };
  const q2 = rescaleQuote(edited, 50);
  assert.equal(q2.lines[0].contracts, 1000);
  assert.equal(q2.lines[0].payoutUsd, 1000);
  assert.equal(q2.risks[0].lossUsdAi, 1000); // AI's original kept for "AI said $…"
});

test("a bigger loss still respects the monthly budget", () => {
  const q = rescaleQuote({ ...base(5000, 120) }, 100);
  assert.ok(q.totalPremiumUsd <= 120 + 1e-9);
});

test("QA #7: per-line payout never drops when coverage goes up; thin books (< $25 of cover) are not funded", () => {
  const mk = (id: string, price: number, max?: number) => ({ ...base(0, 0).lines[0], contractId: id, contract: { ...contract, id }, pricePerContract: price, ...(max ? { maxCoverable: max } : {}) });
  const q: Quote = { ...base(0, 200), risks: [
    { id: "r1", peril: "game", title: "Spurs", trigger: "t", lossUsd: 9000, lossReasoning: "", confidence: 0.7 },
    { id: "r2", peril: "rain", title: "Rain", trigger: "t", lossUsd: 600, lossReasoning: "", confidence: 0.7 },
    { id: "r3", peril: "heat", title: "Heat", trigger: "t", lossUsd: 900, lossReasoning: "", confidence: 0.7 },
    { id: "r4", peril: "game", title: "Thin", trigger: "t", lossUsd: 5000, lossReasoning: "", confidence: 0.7 },
  ], lines: [{ ...mk("kalshi:S", 0.6), riskId: "r1" }, { ...mk("kalshi:R", 0.25), riskId: "r2" }, { ...mk("kalshi:H", 0.1), riskId: "r3" }, { ...mk("kalshi:T", 0.4, 4), riskId: "r4" }] } as Quote;
  const at = (c: 25 | 50 | 100) => rescaleQuote(q, c);
  for (const [lo, hi] of [[25, 50], [50, 100]] as const) {
    const a = at(lo).lines, b = at(hi).lines;
    a.forEach((l, i) => assert.ok(b[i].payoutUsd >= l.payoutUsd, `${l.contractId} ${lo}% $${l.payoutUsd} -> ${hi}% $${b[i].payoutUsd}`));
    assert.ok(at(hi).totalPremiumUsd <= 200 + 1e-9);
  }
  assert.equal(at(50).lines[3].contracts, 0); // 4 contracts for sale against a $5,000 loss: dust, not cover
});
