// Exposure-discovery questions: selection by business type + city + live markets, and answers that add / suppress risks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryQuestions, gameDayRisks, marketHints } from "../lib/ai/discovery";
import { adjustByAnswers, answerFacts, fallbackQuestions, isNegative, questionTopic, suppressByAnswers } from "../lib/ai/clarifyRules";
import { clarifyQuestions } from "../lib/ai/clarify";
import { advise, type SizeQuoteFn } from "../lib/ai/advisor";
import { getPreset } from "../lib/ai/presets";
import { setMeta } from "../lib/markets/normalize";
import type { GenerateJson } from "../lib/ai/llm";
import type { BusinessProfile, ClarifyAnswer, MarketContract, QuoteLine, Risk } from "../lib/types";

const biz = (description: string, over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: "t", name: "Test Biz", description, city: "Austin, TX", avgDailyRevenueUsd: 1400, busyDays: ["Fri", "Sat", "Sun"], monthlyBudgetUsd: 120, ...over,
});
const mk = (id: string, over: Partial<MarketContract> = {}): MarketContract => ({
  id, venue: "kalshi", eventTitle: "Texas vs Texas A&M", label: "Texas", symbol: id, eventTicker: "E", peril: "game", location: "Austin",
  expiry: "2026-11-28T03:00:00Z", yesAsk: 0.73, yesBid: 0.71, noAsk: 0.29, noBid: 0.27, tradable: true, status: "open", ...over,
});
const TEXAS = mk("kalshi:CFB-TEXAM-TEX");
const AGGIES = mk("kalshi:CFB-TEXAM-TAM", { label: "Texas A&M", yesAsk: 0.3, noAsk: 0.73 });
const CFP = mk("kalshi:KXCFPQUAL-TEX", { eventTitle: "College Football Playoff Qualifiers", label: "Texas", yesAsk: 0.96, noAsk: 0.05, expiry: "2026-12-07T00:00:00Z" });
setMeta(CFP.id, { futureKind: "playoffs", teams: ["Texas"], league: "NCAAF", eventEnd: "2026-12-06" });
const GAS = mk("kalshi:GAS", { peril: "gas", eventTitle: "US gas price on Nov 30?", label: "Above $3.10", location: "US", yesAsk: 0.3, noAsk: 0.72 });
const RAIN = mk("kalshi:KXRAINWKND-26NOV21-AUS", { peril: "rain", eventTitle: "Where will it rain this weekend (Nov 21 - Nov 22)?", label: "Austin", yesAsk: 0.24, noAsk: 0.78, expiry: "2026-11-23T06:00:00Z" });
const MARKETS = [TEXAS, AGGIES, CFP, GAS, RAIN];
const failing: GenerateJson = (async () => { throw new Error("429 quota"); }) as GenerateJson;

// ---------- selection ----------
test("discovery: the food truck gets a Longhorns game-day question + fuel/propane; a mortgage broker gets none", () => {
  const truck = { ...getPreset("east-austin-food-truck")! };
  const qs = fallbackQuestions(truck, MARKETS);
  assert.deepEqual(qs.map((q) => q.id), ["game-days", "costs"]);
  assert.equal(qs[0].question, "Do Longhorns game days change your sales?");
  assert.deepEqual(qs[0].options, ["More customers", "Fewer customers", "No difference"]);
  assert.ok(qs.every((q) => q.question.split(" ").length <= 12 && q.why.split(" ").length <= 6));
  assert.deepEqual(fallbackQuestions(biz("Mortgage broker. We fund home loans on a variable-rate warehouse line."), MARKETS).map((q) => q.id), []);
});

test("discovery: the three presets (Rainey bar: nothing new; catering: weather on events after the loan gap)", () => {
  assert.deepEqual(fallbackQuestions({ ...getPreset("rainey-patio-bar")! }, MARKETS), []);
  assert.deepEqual(fallbackQuestions({ ...getPreset("austin-catering-delivery")! }, MARKETS).map((q) => q.id), ["loan", "weather-cancel"]);
});

test("discovery: never ask what no market can hedge (no Longhorns game listed / no event markets / no fuel markets)", () => {
  const truck = biz("Taco truck by the stadium, cash only.");
  assert.ok(fallbackQuestions(truck, [RAIN, GAS]).every((q) => q.id !== "game-days"), "no Longhorns market: no game-day question");
  assert.ok(fallbackQuestions(truck, [TEXAS, RAIN]).every((q) => q.id !== "costs"), "no fuel market: no cost question");
  const bar = biz("Sixth Street bar with a dance floor.");
  assert.ok(!fallbackQuestions(bar, MARKETS).some((q) => q.id === "events"), "no ACL / F1 market: skip events");
  const acl = mk("kalshi:ACL", { peril: "other", eventTitle: "Will ACL 2027 sell out?", label: "Yes" });
  assert.equal(discoveryQuestions(bar, [...MARKETS, acl]).find((q) => q.id === "events")?.question, "Do big events like ACL change your sales?");
  assert.deepEqual(marketHints(null, "Austin, TX").teams.map((t) => t.nick), ["Longhorns"], "markets unknown (mock mode): local teams assumed");
  assert.deepEqual(marketHints(MARKETS, "Houston, TX").teams, []);
  assert.equal(discoveryQuestions(biz("Wings and beer spot in Houston", { city: "Houston, TX" }), null)[0].question, "Do Texans or Rockets game days change your sales?");
});

test("discovery: already said -> not asked; LLM path keeps its questions and adds discovery (<= 3 total)", async () => {
  assert.ok(!fallbackQuestions(biz("Food truck. Longhorns game days are huge for us."), MARKETS).some((q) => q.id === "game-days"));
  assert.ok(!fallbackQuestions(biz("Food truck, propane and generator fuel are big costs."), MARKETS).some((q) => q.id === "costs"));
  const llm = (async (o: any) => ({ data: o.schema.parse({ questions: [
    { id: "weather", label: "Weather", question: "Which weather keeps customers away?", why: "So we cover it", options: ["Rain", "Heat", "Cold"], allowFreeText: false },
    { id: "hours", label: "Hours", question: "Do you open for lunch?", why: "So timing fits", options: ["Yes", "No"], allowFreeText: false },
    { id: "staff", label: "Staff", question: "How many staff work weekends?", why: "So losses fit", options: ["1-2", "3-5"], allowFreeText: false },
  ] }), model: "fake/fast" })) as GenerateJson;
  const r = await clarifyQuestions(biz("Taco truck on Cesar Chavez."), { llm, markets: MARKETS });
  assert.deepEqual(r.questions.map((q) => q.id), ["weather", "hours", "game-days"], "one LLM question makes room for discovery");
  const fb = await clarifyQuestions(biz("Taco truck on Cesar Chavez."), { llm: failing, markets: MARKETS });
  assert.equal(fb.model, "fallback-rules");
  assert.deepEqual(fb.questions.map((q) => q.id), ["game-days", "costs"]);
});

// ---------- answers -> plan ----------
const GAME_MORE: ClarifyAnswer = { questionId: "game-days", question: "Do Longhorns game days change your sales?", answer: "More customers", label: "Longhorns game days" };
const GAME_NONE: ClarifyAnswer = { ...GAME_MORE, answer: "No difference" };
const GAME_FEWER: ClarifyAnswer = { ...GAME_MORE, answer: "Fewer customers" };

test("answers: topics, negatives, facts", () => {
  assert.equal(questionTopic(GAME_MORE), "game");
  assert.equal(questionTopic({ questionId: "costs", question: "Do fuel or propane costs squeeze you?" }), "costs");
  assert.equal(questionTopic({ questionId: "x", question: "How much of your sales come from delivery apps?" }), "delivery");
  assert.ok(isNegative("game", "No difference") && isNegative("game", "Fewer customers") && !isNegative("game", "More customers"));
  assert.ok(isNegative("costs", "No") && !isNegative("costs", "A little"));
  assert.match(answerFacts([GAME_MORE]), /^Longhorns game days bring more customers/);
  assert.match(answerFacts([{ questionId: "costs", question: "Do fuel or propane costs squeeze you?", answer: "Yes, a lot" }]), /fuel/i);
});

test("answers: 'No difference' / 'Fewer' drop game risks, costs 'No' drops fuel, weather 'Rarely' drops weather; delivery share shrinks rain losses", () => {
  const risks: Risk[] = [
    { id: "r1", peril: "game", title: "Longhorns lose", trigger: "Texas lose", lossUsd: 500, lossReasoning: "x", confidence: 0.5 },
    { id: "r2", peril: "gas", title: "Fuel spike", trigger: "US gas above $3.10", lossUsd: 200, lossReasoning: "propane and generator", confidence: 0.4 },
    { id: "r3", peril: "rain", title: "Rainy Saturday", trigger: "Rain Sat", lossUsd: 1000, lossReasoning: "x", confidence: 0.6 },
  ];
  assert.deepEqual(suppressByAnswers(risks, [GAME_NONE]).map((r) => r.id), ["r2", "r3"]);
  assert.deepEqual(suppressByAnswers(risks, [GAME_FEWER]).map((r) => r.id), ["r2", "r3"]);
  assert.deepEqual(suppressByAnswers(risks, [{ questionId: "costs", question: "Do fuel or propane costs squeeze you?", answer: "No" }]).map((r) => r.id), ["r1", "r3"]);
  assert.deepEqual(suppressByAnswers(risks, [{ questionId: "weather-cancel", question: "Does bad weather cancel or slow your work?", answer: "Rarely" }]).map((r) => r.id), ["r1", "r2"]);
  const adj = adjustByAnswers(risks, [{ questionId: "delivery", question: "How much of your sales come from delivery apps?", answer: "Half or more" }]);
  assert.equal(adj.find((r) => r.id === "r3")!.lossUsd, 700);
  assert.equal(adj.find((r) => r.id === "r1")!.lossUsd, 500);
  assert.equal(adjustByAnswers(risks, [{ questionId: "delivery", question: "How much of your sales come from delivery apps?", answer: "Under 10%" }]), risks);
});

test("gameDayRisks: 'More customers' -> the next Longhorns game (exact 'Texas' market, not 'Texas A&M')", () => {
  const out = gameDayRisks(biz("Taco truck by DKR stadium"), [GAME_MORE], MARKETS, new Date("2026-11-19T18:00:00Z"));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Longhorns lose to Texas A&M");
  assert.deepEqual(gameDayRisks(biz("x"), [GAME_NONE], MARKETS, new Date("2026-11-19T18:00:00Z")), []);
});

const stubSize: SizeQuoteFn = async ({ legs, contracts, coveragePct, risks }) => {
  const lines: QuoteLine[] = legs.map((l) => {
    const c = contracts.get(l.contractId)!; const r = risks.find((x) => x.id === l.riskId)!;
    const px = (l.side === "yes" ? c.yesAsk : c.noAsk) ?? 0.5; const n = Math.ceil((coveragePct / 100) * r.lossUsd);
    return { ...l, contract: c, coveragePct, contracts: n, pricePerContract: px, premiumUsd: n * px, payoutUsd: n, impliedProb: px, action: "buy-onchain" };
  });
  return { lines, uncovered: [], totalPremiumUsd: lines.reduce((a, l) => a + l.premiumUsd, 0), totalPayoutUsd: lines.reduce((a, l) => a + l.payoutUsd, 0) };
};
const cands = async (r: Risk) => r.peril === "game" ? (r.horizon === "season" ? [CFP] : [TEXAS, AGGIES]) : r.peril === "rain" ? [RAIN] : r.peril === "gas" ? [GAS] : [];

test("advise (LLM down): 'More customers on game days' adds the next game (NO on Texas) + CFP season cover (NO); 'No difference' adds none; <= 4 calls", async () => {
  const truck = { ...getPreset("east-austin-food-truck")! };
  let calls = 0;
  const llm = (async () => { calls++; throw new Error("429 quota"); }) as GenerateJson;
  const deps = { llm, findCandidates: cands, sizeQuote: stubSize, listMarkets: async () => MARKETS, now: () => new Date("2026-11-19T18:00:00Z") };
  const q = await advise(truck, { answers: [GAME_MORE], deps });
  assert.ok(calls <= 4, `LLM calls ${calls}`);
  const game = q.risks.filter((r) => r.peril === "game");
  assert.deepEqual(game.map((r) => r.title).sort(), ["Longhorns lose to Texas A&M", "Longhorns miss the College Football Playoff"]);
  const next = q.lines.find((l) => l.riskId === game.find((r) => r.horizon !== "season")!.id)!;
  assert.deepEqual([next.contractId, next.side], [TEXAS.id, "no"], "pays when the Longhorns lose");
  const season = q.lines.find((l) => l.contractId === CFP.id)!;
  assert.equal(season.side, "no", "pays when Texas misses the CFP (fewer home game days)");

  const none = await advise(truck, { answers: [GAME_NONE], deps });
  assert.ok(!none.risks.some((r) => r.peril === "game"));
});

test("advise (LLM down): fuel answer grounds a fuel risk for a non-preset truck; 'No' keeps it out", async () => {
  const truck = biz("Taco truck on Cesar Chavez, no seating. Rain kills the line.");
  const deps = { llm: failing, findCandidates: cands, sizeQuote: stubSize, listMarkets: async () => MARKETS, now: () => new Date("2026-11-19T18:00:00Z") };
  const yes = await advise(truck, { answers: [{ questionId: "costs", question: "Do fuel or propane costs squeeze you?", answer: "Yes, a lot", label: "Fuel and propane" }], deps });
  assert.ok(yes.risks.some((r) => r.peril === "gas"));
  const no = await advise(truck, { answers: [{ questionId: "costs", question: "Do fuel or propane costs squeeze you?", answer: "No" }], deps });
  assert.ok(!no.risks.some((r) => (r.peril === "gas" || r.peril === "oil") && !/customer/i.test(`${r.title} ${r.causalStory ?? ""}`)), "no fuel-bill risk (a customer-spending proxy may stay)");
});
