// Clarifying questions: fallback rules, zod validation, answers folded into advise() prompts (no extra LLM calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clarifyQuestions, clarifySchema } from "../lib/ai/clarify";
import { answersSchema } from "../lib/ai/clarifySchemas";
import { alreadyAnswered, fallbackQuestions, isNegative, normalizeQuestions, parseDays, profileWithAnswers, suppressByAnswers } from "../lib/ai/clarifyRules";
import { advise, cleanAnswers, type AdvisorDeps, type SizeQuoteFn } from "../lib/ai/advisor";
import { getPreset } from "../lib/ai/presets";
import type { GenerateJson } from "../lib/ai/llm";
import type { BusinessProfile, ClarifyAnswer, MarketContract, QuoteLine } from "../lib/types";

const biz = (description: string, over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: "t", name: "Test Biz", description, city: "Austin, TX", avgDailyRevenueUsd: 2000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 100, ...over,
});
const failingLlm: GenerateJson = (async () => { throw new Error("429 quota exhausted"); }) as GenerateJson;

// ---------- fallback rules ----------
test("fallback: a bar with no seating info gets the outdoor question; vehicles for catering; loan type when financing appears", () => {
  const bar = fallbackQuestions(biz("Neighborhood bar on South Congress with a patio, busy on weekends."));
  assert.deepEqual(bar.map((q) => q.id), ["outdoor", "game-days"]); // + discovery: Longhorns game days (Austin)
  assert.ok(bar[0].options.includes("None") && bar[0].options.length <= 5 && bar[0].why.length <= 60);

  const cater = fallbackQuestions(biz("We cater office lunches and weddings. We took an SBA loan for the kitchen."));
  assert.deepEqual(cater.map((q) => q.id), ["vehicles", "loan", "weather-cancel"]); // + discovery: weddings vs weather
  assert.ok(cater.find((q) => q.id === "vehicles")!.allowFreeText);

  const roofer = fallbackQuestions(biz("Roofing contractor, 2 crews, financing on our trucks"));
  assert.deepEqual(roofer.map((q) => q.id), ["vehicles", "loan", "weather"]);
});

test("fallback: nothing to ask when the description already answers it (or nothing applies)", () => {
  // the Rainey preset says 80% of seats are outside and how a Spurs loss hurts; busy days are on the form
  assert.deepEqual(fallbackQuestions({ ...getPreset("rainey-patio-bar")! }), []);
  assert.deepEqual(fallbackQuestions(biz("Online store selling stickers.")), []);
  assert.deepEqual(fallbackQuestions(biz("Catering with four delivery vans and a variable-rate line of credit.")), []);
  assert.ok(alreadyAnswered("vehicles", biz("We run 3 vans")));
  assert.ok(alreadyAnswered("outdoor", biz("Indoor only cocktail bar")));
  assert.ok(!alreadyAnswered("outdoor", biz("Cocktail bar")));
});

test("fallback: food trucks are not asked about seating; at most 3 questions", () => {
  assert.ok(!fallbackQuestions(biz("Taco food truck in East Austin")).some((q) => q.id === "outdoor"));
  const many = fallbackQuestions(biz("Bar and restaurant with catering delivery, a loan, landscaping crew, Spurs game nights", { busyDays: [] }));
  assert.equal(many.length, 3);
});

test("clarifyQuestions: LLM failure -> keyword fallback, never throws", async () => {
  const r = await clarifyQuestions(biz("Coffee shop with a small patio"), { llm: failingLlm });
  assert.equal(r.model, "fallback-rules");
  assert.deepEqual(r.questions.map((q) => q.id), ["outdoor"]);
  const none = await clarifyQuestions(biz("Online sticker store"), { llm: failingLlm });
  assert.deepEqual(none.questions, []);
});

test("clarifyQuestions: one fast-tier call; output normalized (max 3, <= 5 options, already-answered topics dropped)", async () => {
  const calls: string[] = [];
  const llm = (async (opts: any) => {
    calls.push(opts.tier);
    const raw = {
      questions: [
        { id: "outdoor", label: "Outdoor seating", question: "How much seating is outdoors?", why: "So rain cover fits", options: ["None", "Some", "Mostly", "All", "Half", "Unsure", "Extra"], allowFreeText: false },
        { id: "vehicles", label: "Vehicles", question: "Do you run your own vans?", why: "Fuel cover", options: ["Yes", "No"], allowFreeText: true },
        { id: "busy-days", label: "Busy days", question: "Which days are busiest?", why: "Busy days only", options: ["Fri", "Sat"], allowFreeText: false },
        { id: "game", label: "Game effect", question: "Does a Spurs loss hurt?", why: "Picks the side", options: ["Yes", "No"], allowFreeText: false },
        { id: "extra", label: "Extra", question: "Anything else?", why: "", options: ["Yes", "No"], allowFreeText: false },
      ],
    };
    return { data: opts.schema.parse(raw), model: "fake/fast" };
  }) as GenerateJson;
  const r = await clarifyQuestions(biz("Bar with a patio and delivery"), { llm });
  assert.deepEqual(calls, ["fast"]);
  assert.equal(r.questions.length, 3);
  assert.ok(!r.questions.some((q) => q.id === "busy-days"), "busy days are on the form: never asked");
  assert.equal(r.questions[0].options.length, 5);
});

test("clarifyQuestions: the model may say no questions are needed", async () => {
  const llm = (async (opts: any) => ({ data: opts.schema.parse({ questions: [] }), model: "fake/fast" })) as GenerateJson;
  const r = await clarifyQuestions({ ...getPreset("rainey-patio-bar")! }, { llm });
  assert.deepEqual(r.questions, []);
});

// ---------- zod ----------
test("zod: clarify output and answers request are validated", () => {
  assert.equal(clarifySchema.safeParse({ questions: [{ id: "x", label: "X", question: "Q?", why: "", options: [], allowFreeText: true }] }).success, false, "question too short");
  assert.equal(clarifySchema.safeParse({ questions: [{ id: "x", label: "X", question: "Is it outdoors?", why: "w", options: ["a"], allowFreeText: "yes" }] }).success, false);
  assert.equal(clarifySchema.safeParse({ questions: [] }).success, true);
  assert.equal(answersSchema.safeParse([{ questionId: "outdoor", question: "How much?", answer: "Mostly" }]).success, true);
  assert.equal(answersSchema.safeParse([{ questionId: "", question: "How much?", answer: "Mostly" }]).success, false);
  assert.equal(answersSchema.safeParse(Array.from({ length: 6 }, () => ({ questionId: "a", question: "b", answer: "c" }))).success, false);
  assert.equal(answersSchema.safeParse([{ questionId: "a", question: "b", answer: "x".repeat(121) }]).success, false);
  assert.equal(normalizeQuestions([{ id: "o", question: "Hm?", why: "", options: [], allowFreeText: false }], biz("bar")).length, 0);
});

// ---------- answer semantics ----------
test("answers: negatives, busy-day parsing, grounding facts, suppression", () => {
  assert.ok(isNegative("outdoor", "None"));
  assert.ok(isNegative("vehicles", "No, third-party"));
  assert.ok(isNegative("loan", "Fixed"));
  assert.ok(!isNegative("vehicles", "Yes, 3 vans"));
  assert.deepEqual(parseDays("Thu–Sun"), ["Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(parseDays("weekends"), ["Sat", "Sun"]);
  assert.deepEqual(parseDays("Fri and Saturday"), ["Fri", "Sat"]);

  const ans: ClarifyAnswer[] = [
    { questionId: "vehicles", question: "Do you run your own vehicles?", answer: "Yes, 3 vans" },
    { questionId: "busy-days", question: "Which days are busiest?", answer: "Mon-Wed" },
  ];
  const p = profileWithAnswers(biz("We cater office lunches."), ans);
  assert.match(p.description, /vehicles: Yes, 3 vans/);
  assert.deepEqual(p.busyDays, ["Mon", "Tue", "Wed"]);
  // a "No" answer adds no grounding text
  assert.equal(profileWithAnswers(biz("x y z"), [{ questionId: "vehicles", question: "Own vans?", answer: "No, third-party" }]).description, "x y z");

  const risks = [
    { peril: "rain" as const, title: "Rain empties the patio", trigger: "Rain Sat", lossReasoning: "80% patio" },
    { peril: "rain" as const, title: "Rain keeps walk-ins home", trigger: "Rain Sat", lossReasoning: "foot traffic -20%" },
    { peril: "gas" as const, title: "Fuel spike", trigger: "Gas > $3.40", lossReasoning: "4 vans x 3,000 mi" },
    { peril: "fed" as const, title: "No Fed cut", trigger: "Fed holds", lossReasoning: "variable-rate loan interest" },
  ];
  const kept = suppressByAnswers(risks, [
    { questionId: "outdoor", question: "How much seating is outdoors?", answer: "None" },
    { questionId: "vehicles", question: "Own vehicles?", answer: "No, third-party" },
    { questionId: "loan", question: "Fixed or variable?", answer: "Fixed" },
  ]);
  assert.deepEqual(kept.map((r) => r.title), ["Rain keeps walk-ins home"]);
  assert.equal(cleanAnswers([{ questionId: "a", question: "q", answer: "  " }]).length, 0);
});

// ---------- advise() integration ----------
const mk = (id: string, peril: MarketContract["peril"], label: string): MarketContract => ({
  id, venue: "gemini", eventTitle: `${peril} market`, label, symbol: id, eventTicker: "E", peril, location: peril === "gas" ? "US" : "Austin",
  expiry: "2026-11-23T00:00:00Z", yesAsk: 0.2, yesBid: 0.18, noAsk: 0.82, noBid: 0.8, tradable: false, status: "open",
});
const CANDS: Record<string, MarketContract[]> = { rain: [mk("gemini:RAIN", "rain", "Rain")], gas: [mk("gemini:GAS", "gas", "Above $3.40")] };
const stubSize: SizeQuoteFn = async ({ legs, contracts, coveragePct, risks }) => {
  const lines: QuoteLine[] = legs.map((l) => {
    const c = contracts.get(l.contractId)!; const r = risks.find((x) => x.id === l.riskId)!;
    const n = Math.ceil((coveragePct / 100) * r.lossUsd);
    return { ...l, contract: c, coveragePct, contracts: n, pricePerContract: 0.2, premiumUsd: n * 0.2, payoutUsd: n, impliedProb: 0.2, action: "open-on-gemini" };
  });
  return { lines, uncovered: [], totalPremiumUsd: lines.reduce((s, l) => s + l.premiumUsd, 0), totalPayoutUsd: lines.reduce((s, l) => s + l.payoutUsd, 0) };
};
const RISKS = {
  risks: [
    { peril: "rain", title: "Rain empties the patio", trigger: "Rain in Austin Sat", location: "Austin", window: "Sat Nov 22", lossUsd: 900, lossReasoning: "Patio seats -50%", confidence: 0.6 },
    { peril: "gas", title: "Fuel spike for the vans", trigger: "US gas above $3.40", location: "US", window: "this week", lossUsd: 200, lossReasoning: "3 vans burn ~400 gal/month", confidence: 0.4 },
    { peril: "rain", title: "Rain cuts walk-in lunch trade", trigger: "Rain in Austin Fri", location: "Austin", window: "Fri Nov 21", lossUsd: 400, lossReasoning: "Walk-ins -20%", confidence: 0.5 },
  ],
};
function recordingLlm(prompts: Record<string, string[]>): GenerateJson {
  return (async (opts: any) => {
    const which = opts.system.includes("creative hedging strategist") ? "brainstorm" : opts.system.includes("risk analyst") ? "risk" : opts.system.includes("pick prediction-market") ? "match" : "summary";
    (prompts[which] ??= []).push(opts.prompt);
    const out = which === "risk" ? RISKS
      : which === "brainstorm" ? { ideas: [], naturalHedges: [] }
      : which === "match" ? { matches: [...opts.prompt.matchAll(/RISK (r\d+)/g)].map((m: RegExpMatchArray) => ({ riskId: m[1], picks: [{ contractId: m[1] === "r2" ? "gemini:GAS" : "gemini:RAIN", side: "yes", tier: "recommended", rationale: "fits", basisRisk: "airport gauge" }] })) }
      : { summary: "Short summary." };
    return { data: opts.schema.parse(out), model: `fake/${which}` };
  }) as GenerateJson;
}
const deps = (llm: GenerateJson): Partial<AdvisorDeps> => ({ llm, findCandidates: async (r) => CANDS[r.peril] ?? [], sizeQuote: stubSize, now: () => new Date("2026-11-19T12:00:00Z") });

test("advise: answers reach the risk-map, brainstorm and summary prompts; still <= 4 LLM calls; stored on the quote", async () => {
  const prompts: Record<string, string[]> = {};
  const answers: ClarifyAnswer[] = [
    { questionId: "vehicles", question: "Do you run your own vehicles?", answer: "Yes, 3 vans", label: "Own vehicles" },
    { questionId: "outdoor", question: "How much of your seating is outdoors?", answer: "Mostly", label: "Outdoor seating" },
  ];
  // the description never mentions vehicles: the answer is what grounds the fuel risk
  const q = await advise(biz("Cafe and lunch catering spot downtown."), { coveragePct: 50, answers, deps: deps(recordingLlm(prompts)) });
  const total = Object.values(prompts).flat().length;
  assert.ok(total <= 4, `LLM calls: ${total}`);
  for (const k of ["risk", "brainstorm", "summary"]) assert.match(prompts[k][0], /Yes, 3 vans/, `${k} prompt carries the answers`);
  assert.match(prompts.risk[0], /How much of your seating is outdoors\? -> Mostly/);
  assert.ok(q.risks.some((r) => r.peril === "gas"), "fuel risk grounded by the vans answer");
  assert.deepEqual(q.clarifications?.map((a) => a.answer), ["Yes, 3 vans", "Mostly"]);
});

test("advise: 'No outdoor seating' / 'No, third-party' suppress patio-weather and fuel risks", async () => {
  const prompts: Record<string, string[]> = {};
  const q = await advise(biz("Cafe with delivery, lunch crowd."), {
    answers: [
      { questionId: "outdoor", question: "How much of your seating is outdoors?", answer: "None" },
      { questionId: "vehicles", question: "Do you run your own vehicles?", answer: "No, third-party" },
    ],
    deps: deps(recordingLlm(prompts)),
  });
  assert.deepEqual(q.risks.filter((r) => r.kind !== "proxy").map((r) => r.title), ["Rain cuts walk-in lunch trade"]);
  assert.equal(q.risks[0].id, "r1");
  assert.ok(Object.values(prompts).flat().length <= 4);
});

test("advise: without answers nothing changes (no clarifications field, no answers block)", async () => {
  const prompts: Record<string, string[]> = {};
  const q = await advise(biz("Cafe with a patio and 3 delivery vans."), { deps: deps(recordingLlm(prompts)) });
  assert.equal(q.clarifications, undefined);
  assert.doesNotMatch(prompts.risk[0], /quick questions/);
  assert.equal(q.risks.filter((r) => r.kind !== "proxy").length, 3);
});
