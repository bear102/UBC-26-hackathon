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
