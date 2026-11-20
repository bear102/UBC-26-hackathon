import { test } from "node:test";
import assert from "node:assert/strict";
import { contradictsLoss, settleDefaultPlan, skipReason } from "../lib/ai/defaultPlan";
import { currentPicks, packagePicks, samePicks } from "../lib/client/choices";
import type { MarketContract, Quote, QuoteLine, Risk } from "../lib/types";

const mc = (id: string, p: number): MarketContract => ({ id, venue: "kalshi", symbol: id, eventTicker: id, eventTitle: id, label: id, peril: "rain", status: "open",
  yesAsk: p, noAsk: 1 - p, yesBid: p - 0.01, noBid: 0.99 - p, expiry: "2026-12-01T00:00:00Z", tradable: true } as MarketContract);
const line = (riskId: string, id: string, p: number, n = 100): QuoteLine => ({ riskId, contractId: id, side: "yes", rationale: "", basisRisk: "", contract: mc(id, p),
  coveragePct: 50, contracts: n, pricePerContract: p, premiumUsd: n * p, payoutUsd: n, impliedProb: p, action: "buy-onchain" } as QuoteLine);
const risk = (id: string, lossUsd: number, o: Partial<Risk> = {}): Risk => ({ id, peril: "rain", title: id, trigger: id, lossUsd, lossReasoning: "", confidence: 0.6, kind: "direct", ...o } as Risk);

test("QA #4: the default plan is Plan B (Selected), skip-priced picks stay out with a reason", () => {
  const risks = [risk("r1", 9000, { peril: "game" }), risk("r2", 2000), risk("r3", 800, { peril: "heat" })];
  const r1 = [line("r1", "kalshi:WCF", 0.41, 4), line("r1", "kalshi:WEST", 0.66, 2000)];
  const r2 = [line("r2", "kalshi:RAIN5", 0.26, 1000), line("r2", "kalshi:RAIN6", 0.15, 1000)];
  const r3 = [line("r3", "kalshi:HI82", 0.1, 400)];
  const q: Quote = { businessId: "b", createdAt: "", risks, lines: [r1[1], r2[0], r3[0]], uncovered: [{ riskId: "r3", reason: "over budget: stale" }],
    totalPremiumUsd: 0, totalPayoutUsd: 0, budgetUsd: 300, summary: "", model: "",
    options: [{ riskId: "r1", choices: r1 }, { riskId: "r2", choices: r2 }, { riskId: "r3", choices: r3 }],
    packages: [{ id: "max", name: "Broadest triggers", blurb: "", picks: [{ riskId: "r1", contractId: "kalshi:WEST" }], totalPremiumUsd: 300, totalPayoutUsd: 450 }],
    naturalHedges: [{ peril: "cold", title: "Mild, dry weekends", explanation: "Don't pay for heat or rain cover this week.", advice: "dont-hedge" },
      { peril: "game", title: "Big wins", explanation: "Don't also hedge the winning side.", advice: "dont-hedge" }] } as Quote;
  settleDefaultPlan(q, 50, new Map([["r1", "kalshi:WEST"], ["r2", "kalshi:RAIN5"], ["r3", "kalshi:HI82"]]));
  assert.deepEqual(q.lines.map((l) => l.contractId), ["kalshi:RAIN5", "kalshi:HI82"]);
  const bal = q.packages!.find((p) => p.id === "balanced")!;
  assert.ok(samePicks(currentPicks(q), packagePicks(q, bal)), "Plan B shows as Selected");
  assert.equal(bal.totalPremiumUsd, q.totalPremiumUsd);
  assert.ok(!q.packages!.some((p) => p.id === "max"), "a plan costing as much and paying less is not offered");
  assert.match(q.uncovered.find((u) => u.riskId === "r1")!.reason, /66¢/);
  assert.ok(!q.uncovered.some((u) => u.riskId === "r3"), "a funded risk is not listed as uncovered");
  assert.deepEqual(q.naturalHedges!.map((n) => n.title), ["Big wins"]);
});

test("skipReason / contradictsLoss", () => {
  assert.ok(skipReason(line("r", "k", 0.6), risk("r", 1)));
  assert.equal(skipReason(line("r", "k", 0.35), risk("r", 1)), null);
  assert.ok(skipReason(line("r", "k", 0.35), risk("r", 1, { correlation: "weak" })));
  assert.equal(contradictsLoss("dont-hedge", "Rainy Thursday-Sunday nights", [risk("r", 1)]), true);
  assert.equal(contradictsLoss("watch", "Rainy nights", [risk("r", 1)]), false);
  assert.equal(contradictsLoss("dont-hedge", "Rainy nights", [risk("r", 1, { kind: "proxy" })]), false);
});
