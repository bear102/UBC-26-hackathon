import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_PRESETS, fixturePositions, fixtureQuote } from "@/lib/fixtures";
import { explainLine, explainPlan, explainPosition, oddsPhrase, parseHistory, whenPhrase } from "@/lib/client/explain";

test("oddsPhrase is tangible", () => {
  assert.equal(oddsPhrase(0.28), "about 1 in 4");
  assert.equal(oddsPhrase(0.5), "about a coin flip");
  assert.equal(oddsPhrase(0.72), "about 7 in 10");
  assert.equal(oddsPhrase(0.01), "less than 1 in 50");
});

test("parseHistory reads backtest evidence", () => {
  const h = parseHistory("Austin hit >= 85°F on 3 of the last 29 days (Gemini settled markets)");
  assert.deepEqual([h?.hits, h?.total, h?.unit], [3, 29, "day"]);
  assert.equal(parseHistory("no numbers here"), null);
});

test("whenPhrase", () => {
  assert.equal(whenPhrase({ window: "Sat Nov 21" }), " on Sat Nov 21");
  assert.equal(whenPhrase({ window: "through Dec 31" }), " through Dec 31");
  assert.equal(whenPhrase({ window: "Dec 10 release" }), " (Dec 10 release)");
});

test("patio bar rain line: story, scenarios, verdict", () => {
  const p = FIXTURE_PRESETS[0];
  const q = fixtureQuote(p, 50);
  const l = q.lines[0], r = q.risks.find((x) => x.id === l.riskId)!;
  const ex = explainLine(l, r, p);
  assert.equal(ex.ifClause, "it rains");
  assert.equal(ex.scenario.happens.withHedge, -r.lossUsd + l.payoutUsd - l.premiumUsd);
  assert.equal(ex.scenario.doesnt.withHedge, -l.premiumUsd);
  assert.equal(ex.verdict.tone, "good");
  assert.ok(ex.pitfalls.some((x) => /airport/i.test(x)));
});

test("expensive or read-only lines are flagged honestly", () => {
  const p = FIXTURE_PRESETS[0];
  const q = fixtureQuote(p, 50);
  const l = { ...q.lines[0], pricePerContract: 0.7, impliedProb: 0.7, premiumUsd: q.lines[0].payoutUsd * 0.7 };
  assert.equal(explainLine(l, q.risks[0], p).verdict.tone, "skip");
  assert.equal(explainLine({ ...q.lines[0], action: "read-only" }, q.risks[0], p).verdict.tone, "info");
  const weak = explainLine({ ...q.lines[1] }, { ...q.risks[1], correlation: "weak" }, p);
  assert.equal(weak.verdict.tone, "skip");
});

test("optional advisor fields degrade gracefully", () => {
  const p = FIXTURE_PRESETS[0];
  const q = fixtureQuote(p, 50);
  const plain = explainLine(q.lines[0], undefined, undefined);
  assert.ok(plain.checks.length >= 1);
  const rich = explainLine({ ...q.lines[0], crossCheck: { venue: "polymarket", contractId: "x", title: "t", prob: 0.4, lineProb: 0.28, diffPts: -12, exact: true } },
    { ...q.risks[0], evidence: "it rained on 9 of the last 29 days", correlation: "strong" }, p);
  assert.ok(rich.history && rich.history.hits === 9);
  assert.ok(rich.checks.some((c) => /Polymarket/.test(c.text)));
  assert.ok(explainPlan(q.lines, q.risks, p).premiumUsd > 0);
});

test("positions read like outcomes", () => {
  const [won, open, lost] = fixturePositions();
  assert.match(explainPosition(won).headline, /got paid \$480/);
  assert.match(explainPosition(open, { contract: { expiry: "2026-11-22T06:00:00Z" } }).headline, /covered for rain until/);
  assert.match(explainPosition(lost).headline, /good day/);
});
