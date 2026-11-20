// AI layer tests: no network. Fake LLM providers + stub market functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod/v4";
import { generateJsonWith, extractJson, LlmError, type Provider, type GenerateJson } from "../lib/ai/llm";
import { advise, enforceCandidates, heuristicPick, type AdvisorDeps, type SizeQuoteFn } from "../lib/ai/advisor";
import { PRESETS, getPreset, publicPresets } from "../lib/ai/presets";
import { buildCatalog, fallbackIdeas, labelBound, ladderChoices } from "../lib/ai/ideas";
import type { BusinessProfile, MarketContract, QuoteLine, Risk } from "../lib/types";

// ---------- fixtures ----------
const mk = (id: string, over: Partial<MarketContract> = {}): MarketContract => ({
  id, venue: "gemini", eventTitle: "Highest temperature in Austin on Nov 22?", label: "85°F or above", symbol: id.split(":")[1] ?? id,
  eventTicker: "EVT", peril: "heat", location: "Austin", expiry: "2026-11-23T00:00:00Z",
  yesAsk: 0.2, yesBid: 0.18, noAsk: 0.82, noBid: 0.8, tradable: false, status: "open", ...over,
});
const CANDS: Record<string, MarketContract[]> = {
  heat: [mk("gemini:HEAT85"), mk("gemini:HEAT80", { label: "80°F or above", yesAsk: 0.45, noAsk: 0.57 })],
  game: [mk("gemini:SPURS", { peril: "game", eventTitle: "Spurs vs Lakers", label: "Spurs", yesAsk: 0.55, noAsk: 0.47 }),
         mk("gemini:LAKERS", { peril: "game", eventTitle: "Spurs vs Lakers", label: "Lakers", yesAsk: 0.47, noAsk: 0.55 })],
  rain: [],
};
const profile: BusinessProfile = { ...getPreset("rainey-patio-bar")!, id: "rainey-patio-bar" };

const stubFind: AdvisorDeps["findCandidates"] = async (risk) => CANDS[risk.peril] ?? [];
const stubSize: SizeQuoteFn = async ({ legs, contracts, coveragePct, risks }) => {
  const lines: QuoteLine[] = legs.map((l) => {
    const c = contracts.get(l.contractId)!; const r = risks.find((x) => x.id === l.riskId)!;
    const price = (l.side === "yes" ? c.yesAsk : c.noAsk) ?? 1;
    const n = Math.ceil((coveragePct / 100) * r.lossUsd);
    return { ...l, contract: c, coveragePct, contracts: n, pricePerContract: price, premiumUsd: n * price, payoutUsd: n, impliedProb: price, action: "open-on-gemini" };
  });
  return { lines, uncovered: [], totalPremiumUsd: lines.reduce((s, l) => s + l.premiumUsd, 0), totalPayoutUsd: lines.reduce((s, l) => s + l.payoutUsd, 0) };
};

const RISKS_JSON = {
  risks: [
    { peril: "heat", title: "Hot Saturday", trigger: "Austin high >= 85°F Sat Nov 22", location: "Austin", window: "Sat Nov 22", lossUsd: 800, lossReasoning: "Sat ~$6k; patio -15% => $800", confidence: 0.5 },
    { peril: "game", title: "Spurs lose", trigger: "Spurs lose to Lakers Fri Nov 21", location: "San Antonio", window: "Fri Nov 21", lossUsd: 900, lossReasoning: "Game night ~$5k; -18% => $900", confidence: 0.6 },
    { peril: "rain", title: "Rainy Friday", trigger: "Rain in Austin Fri Nov 21", location: "Austin", window: "Fri Nov 21", lossUsd: 2700, lossReasoning: "Fri ~$6k; -45% => $2,700", confidence: 0.7 },
  ],
};

/** Fake generateJson routed by system prompt; validates with the real schema like the real one. */
type Handlers = { risk?: () => unknown; brainstorm?: (prompt: string) => unknown; match?: (prompt: string) => unknown; summary?: () => unknown };
function fakeLlm(handlers: Handlers, calls: string[] = []): GenerateJson {
  return (async (opts: any) => {
    const which = opts.system.includes("creative hedging strategist") ? "brainstorm" : opts.system.includes("risk analyst") ? "risk" : opts.system.includes("pick prediction-market") ? "match" : "summary";
    calls.push(which);
    const h = (handlers as any)[which];
    if (!h) throw new Error(`fake llm: no ${which} handler`);
    return { data: opts.schema.parse(h(opts.prompt)), model: `fake/${which}` };
  }) as GenerateJson;
}

// ---------- llm.ts ----------
function fakeProvider(name: string, outputs: (string | Error)[], available = true): Provider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name, calls, available: () => available, model: () => `${name}-m`,
    async call({ prompt }) {
      calls.push(prompt);
      const o = outputs.shift();
      if (o === undefined) throw new Error("no more outputs");
      if (o instanceof Error) throw o;
      return { text: o, model: `${name}-m` };
    },
  };
}
const S = z.object({ n: z.number().int().min(1), tag: z.enum(["a", "b"]) });

test("llm: valid JSON on first try", async () => {
  const p = fakeProvider("p1", ['{"n":2,"tag":"a"}']);
  const r = await generateJsonWith([p], { system: "s", prompt: "q", schema: S, tier: "fast" });
  assert.deepEqual(r.data, { n: 2, tag: "a" });
  assert.equal(r.model, "p1/p1-m");
  assert.equal(p.calls.length, 1);
});

test("llm: schema failure triggers one repair retry that includes the errors", async () => {
  const p = fakeProvider("p1", ['{"n":0,"tag":"c"}', '```json\n{"n":3,"tag":"b"}\n```']);
  const r = await generateJsonWith([p], { system: "s", prompt: "q", schema: S, tier: "fast" });
  assert.deepEqual(r.data, { n: 3, tag: "b" });
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1], /failed validation/);
  assert.match(p.calls[1], /tag/);
});

test("llm: two bad outputs -> falls through to next provider; unavailable providers skipped", async () => {
  const p1 = fakeProvider("p1", ["not json", '{"n":"x"}']);
  const off = fakeProvider("off", ['{"n":1,"tag":"a"}'], false);
  const p2 = fakeProvider("p2", ['{"n":5,"tag":"a"}']);
  const r = await generateJsonWith([p1, off, p2], { system: "s", prompt: "q", schema: S, tier: "pro" });
  assert.equal(r.model, "p2/p2-m");
  assert.equal(off.calls.length, 0);
  assert.equal(p1.calls.length, 2);
});

test("llm: transport error -> next provider; all fail -> LlmError", async () => {
  const p1 = fakeProvider("p1", [new Error("HTTP 500")]);
  const p2 = fakeProvider("p2", [new Error("timeout")]);
  await assert.rejects(generateJsonWith([p1, p2], { system: "s", prompt: "q", schema: S, tier: "fast" }), LlmError);
  assert.equal(p1.calls.length, 1); // no repair retry on transport errors
});

test("llm: extractJson tolerates prose and fences", () => {
  assert.deepEqual(extractJson('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.deepEqual(extractJson('```json\n[1,2]\n```'), [1, 2]);
  assert.throws(() => extractJson("nothing here"));
});

// ---------- candidate enforcement ----------
test("enforceCandidates drops invented, closed and duplicate ids", () => {
  const cands = [...CANDS.heat, mk("gemini:CLOSED", { status: "closed" })];
  const { legs, dropped } = enforceCandidates("r1", [
    { contractId: "gemini:HEAT85", side: "yes", rationale: "r", basisRisk: "b" },
    { contractId: "kalshi:MADEUP", side: "yes", rationale: "r", basisRisk: "b" },
    { contractId: "gemini:CLOSED", side: "yes", rationale: "r", basisRisk: "b" },
    { contractId: " gemini:HEAT85 ", side: "no", rationale: "r", basisRisk: "b" },
  ], cands);
  assert.deepEqual(legs.map((l) => l.contractId), ["gemini:HEAT85"]);
  assert.deepEqual(dropped, ["kalshi:MADEUP", "gemini:CLOSED", "gemini:HEAT85"]);
});

test("heuristicPick: team loss -> NO on own team; heat -> YES on threshold", () => {
  const game: Risk = { id: "r2", peril: "game", title: "Spurs lose", trigger: "Spurs lose", lossUsd: 900, lossReasoning: "x", confidence: 0.5 };
  assert.deepEqual([heuristicPick(game, CANDS.game)?.contractId, heuristicPick(game, CANDS.game)?.side], ["gemini:SPURS", "no"]);
  const heat: Risk = { ...game, id: "r1", peril: "heat", title: "Hot", trigger: "high >= 85" };
  assert.equal(heuristicPick(heat, CANDS.heat)?.side, "yes");
});

// ---------- advise() ----------
const FAR = "2099-11-23T00:00:00Z";
const U: MarketContract[] = [
  mk("gemini:AUS75", { label: "75°F or above", yesAsk: 0.55, noAsk: 0.47, eventTicker: "WX-AUS-22", expiry: FAR }),
  mk("gemini:AUS78", { label: "78°F or above", yesAsk: 0.3, noAsk: 0.72, eventTicker: "WX-AUS-22", expiry: FAR }),
  mk("gemini:AUS82", { label: "82°F or above", yesAsk: 0.12, noAsk: 0.9, eventTicker: "WX-AUS-22", expiry: FAR }),
  mk("gemini:AUS69", { peril: "cold", label: "69°F or below", yesAsk: 0.09, noAsk: 0.93, eventTicker: "WX-AUS-22", expiry: FAR }),
  mk("gemini:DAL80", { location: "Dallas", eventTitle: "Highest temperature in Dallas on Nov 22?", label: "80°F or above", yesAsk: 0.2, noAsk: 0.82, eventTicker: "WX-DAL-22", expiry: FAR }),
  mk("gemini:SPURS", { peril: "game", location: undefined, eventTitle: "Spurs vs Lakers", label: "San Antonio", yesAsk: 0.55, noAsk: 0.47, eventTicker: "NBA-SAS-LAL", expiry: FAR }),
  mk("gemini:LAKERS", { peril: "game", location: undefined, eventTitle: "Spurs vs Lakers", label: "Los Angeles L", yesAsk: 0.47, noAsk: 0.55, eventTicker: "NBA-SAS-LAL", expiry: FAR }),
  mk("gemini:BRENT20-90", { peril: "oil", location: undefined, eventTitle: "Oil (Brent) price on November 20?", label: "$90 or above", yesAsk: 0.51, noAsk: 0.49, eventTicker: "BRENT-1120", expiry: FAR }),
  mk("gemini:BRENT20-93", { peril: "oil", location: undefined, eventTitle: "Oil (Brent) price on November 20?", label: "$93 or above", yesAsk: 0.23, noAsk: 0.77, eventTicker: "BRENT-1120", expiry: FAR }),
  mk("gemini:BRENT20-96", { peril: "oil", location: undefined, eventTitle: "Oil (Brent) price on November 20?", label: "$96 or above", yesAsk: 0.11, noAsk: 0.89, eventTicker: "BRENT-1120", expiry: FAR }),
  mk("gemini:BRENT30-93", { peril: "oil", location: undefined, eventTitle: "Oil (Brent) price on November 30?", label: "$93 or above", yesAsk: 0.47, noAsk: 0.53, eventTicker: "BRENT-1130", expiry: FAR }),
  mk("kalshi:GAS362", { venue: "kalshi", tradable: true, peril: "gas", location: undefined, eventTitle: "US gas prices this week", label: "Above 3.6200", yesAsk: 0.3, noAsk: 0.72, eventTicker: "GASW", expiry: FAR }),
  mk("gemini:BTC-TICK", { peril: "crypto", location: undefined, eventTitle: "BTC price today at 4am EST", label: "Up", yesAsk: 0.5, noAsk: 0.52, eventTicker: "BTC-TICK", expiry: FAR }),
];
const WX = ["heat", "cold", "rain"];
const findU: AdvisorDeps["findCandidates"] = async (risk) => U.filter((c) =>
  ((risk.peril === "heat" || risk.peril === "cold") ? (c.peril === "heat" || c.peril === "cold") : c.peril === risk.peril)
  && (!WX.includes(risk.peril) || c.location === (risk.location ?? "Austin")));
const key = (prompt: string, re: RegExp) => prompt.match(re)?.[1] ?? "M0";
const ids = (prompt: string) => [...prompt.matchAll(/^RISK (r\d+)/gm)].map((m) => m[1]);

const BRAIN = (prompt: string) => ({
  ideas: [
    { catalogKey: key(prompt, /(M\d+) \| oil \| Oil \(Brent\)/), peril: "oil", title: "Diesel spike via Brent", trigger: "Brent >= $93 on Nov 20", location: "US", window: "Nov 20", lossUsd: 260,
      lossReasoning: "1,300 gal x $0.20 = $260", causalStory: "Diesel prices off Brent within two weeks.", correlation: "strong", worthIt: "Cheap tail, strong link.", confidence: 0.5 },
    { catalogKey: "M99", peril: "other", title: "Invented market", trigger: "Unobtainium > $1", location: "US", window: "Nov 30", lossUsd: 100,
      lossReasoning: "made up numbers here", causalStory: "Not a real market at all.", correlation: "strong", worthIt: "no way.", confidence: 0.9 },
    { catalogKey: key(prompt, /(M\d+) \| gas \|/), peril: "gas", title: "Pump prices squeeze bar tabs", trigger: "US gas above $3.62 this week", location: "US", window: "this week", lossUsd: 300,
      lossReasoning: "1-2% of $29k/week = $300", causalStory: "Same wallet pays for gas and drinks.", correlation: "weak", worthIt: "Weak; tiny position.", confidence: 0.25 },
  ],
  naturalHedges: [{ peril: "game", title: "Spurs wins already pay you", explanation: "A win keeps the crowd; only hedge losses.", advice: "dont-hedge" }],
});
const MATCH = (prompt: string) => ({
  matches: ids(prompt).map((riskId) => {
    const block = prompt.split(`RISK ${riskId}`)[1].split("\nRISK ")[0];
    if (block.includes("gemini:AUS78")) return { riskId, picks: [{ contractId: "gemini:AUS78", side: "yes", tier: "recommended", rationale: "Pays if hot", basisRisk: "Camp Mabry, not Rainey St" },
      { contractId: "kalshi:INVENTED", side: "yes", tier: "broad", rationale: "x", basisRisk: "x" }] };
    if (block.includes("gemini:SPURS")) return { riskId, picks: [{ contractId: "gemini:SPURS", side: "no", rationale: "Pays if Spurs lose", basisRisk: "Loss != empty bar" }] };
    if (block.includes("gemini:BRENT20-93")) return { riskId, picks: [{ contractId: "gemini:BRENT20-93", side: "yes", rationale: "Pays on a crude spike", basisRisk: "Diesel lags Brent" }] };
    if (block.includes("kalshi:GAS362")) return { riskId, picks: [{ contractId: "kalshi:GAS362", side: "yes", rationale: "Pays if gas jumps", basisRisk: "Loose link" }] };
    return { riskId, picks: [], noMatchReason: "nothing fits" };
  }),
});
const NOW = () => new Date("2026-11-19T12:00:00Z");

test("advise: risk map || brainstorm -> one batched match -> ladders, options, packages (<= 4 LLM calls)", async () => {
  const calls: string[] = [];
  const llm = fakeLlm({ risk: () => RISKS_JSON, brainstorm: BRAIN, match: MATCH, summary: () => ({ summary: "Hedges cover heat, the Spurs and a Brent-driven diesel spike. Rain is not covered." }) }, calls);
  const hitRate: AdvisorDeps["hitRate"] = async (_p, _l, _d, o) => ({ settled: 29, yesCount: 3, threshold: o?.threshold, source: "test history" });
  const q = await advise(profile, { coveragePct: 50, deps: { llm, findCandidates: findU, sizeQuote: stubSize, listMarkets: async () => U, hitRate, now: NOW } });

  assert.ok(calls.length <= 4, `LLM calls: ${calls.join(",")}`);
  assert.equal(calls.filter((c) => c === "match").length, 1, "matching is batched into one call");
  // direct risks r1-r3, creative ideas r4 (Brent, strong) + r5 (fallback cold front: the weak "pump prices squeeze bar tabs"
  // idea has no fuel hook in the owner's words, QA cycle 2); invented catalog key dropped
  assert.deepEqual(q.risks.map((r) => `${r.id}:${r.kind}`), ["r1:direct", "r2:direct", "r3:direct", "r4:proxy", "r5:proxy"]);
  assert.ok(!q.risks.some((r) => /Invented/.test(r.title)));
  assert.equal(q.risks[3].correlation, "strong");
  // default plan: direct + strong/medium proxies; weak proxy only offered as an option
  assert.deepEqual(q.lines.map((l) => l.contractId).sort(), ["gemini:AUS78", "gemini:BRENT20-93", "gemini:SPURS"]);
  assert.ok(q.lines.every((l) => !l.contractId.includes("INVENTED")));
  // every recommended / alternative contract is a real universe id
  const real = new Set(U.map((c) => c.id));
  for (const o of q.options!) for (const c of o.choices) assert.ok(real.has(c.contractId), c.contractId);
  // strike ladder on heat: balanced / cheap tail / broad
  const heat = q.options!.find((o) => o.riskId === "r1")!;
  assert.deepEqual(heat.choices.map((c) => `${c.contractId}:${c.tier}`), ["gemini:AUS78:Balanced", "gemini:AUS82:Cheap tail", "gemini:AUS75:Broad"]);
  assert.equal(q.lines.find((l) => l.riskId === "r1")!.tier, "Balanced");
  // game: other side offered
  assert.deepEqual(q.options!.find((o) => o.riskId === "r2")!.choices.map((c) => `${c.contractId}:${c.side}`), ["gemini:SPURS:no", "gemini:LAKERS:yes"]);
  assert.ok(q.options!.some((o) => o.riskId === "r5"));
  // rain had no market
  // rain had no market; the 47c cold proxy is a coin flip (QA cycle 2): an option, not a plan line
  assert.deepEqual(q.uncovered.map((u) => u.riskId), ["r3", "r5"]);
  assert.match(q.uncovered[1].reason, /coin flip/);
  // packages
  assert.deepEqual(q.packages!.map((p) => p.id).slice(0, 2), ["essentials", "balanced"]);
  const [ess, bal, max] = q.packages!;
  assert.ok(ess.totalPremiumUsd < bal.totalPremiumUsd);
  // QA #4: the default plan IS Balanced (same picks, same totals); QA #5: a plan costing as much and paying no more is not offered
  assert.deepEqual(q.lines.filter((l) => l.contracts > 0 && q.options!.some((o) => o.riskId === l.riskId)).map((l) => l.contractId).sort(), bal.picks.map((p) => p.contractId).sort());
  assert.equal(q.totalPremiumUsd, bal.totalPremiumUsd);
  if (max) assert.ok(max.totalPremiumUsd < bal.totalPremiumUsd - 0.01 || max.totalPayoutUsd > bal.totalPayoutUsd);
  for (const p of q.packages!) assert.ok(p.totalPremiumUsd <= q.budgetUsd + 1e-9, `${p.name} ${p.totalPremiumUsd} over budget ${q.budgetUsd}`);
  assert.ok(!ess.picks.some((p) => p.riskId === "r4" || p.riskId === "r5"));
  // packages list only funded legs (QA cycle 1): Max offers r5 only when the budget leaves room for it
  if (max) assert.ok(max.picks.length >= bal.picks.length);
  // Balanced = the plan's lines that the budget actually funds (the stub sizer here ignores the budget)
  assert.ok(bal.picks.length >= 2 && bal.picks.every((p) => q.lines.some((l) => l.contractId === p.contractId)));
  // natural hedge + backtest evidence for the heat strike
  assert.equal(q.naturalHedges![0].advice, "dont-hedge");
  assert.match(q.risks[0].evidence ?? "", /78°F or more on 3 of the last 29/);
  assert.match(q.model, /fake\/risk.*fake\/brainstorm/);
  assert.match(q.summary, /Rain is not covered/);
});

test("advise: risk map + brainstorm fail -> preset fallback risks and fallback creative ideas", async () => {
  const llm = fakeLlm({ match: () => ({ matches: [] }) });
  const q = await advise(profile, { deps: { llm, findCandidates: findU, sizeQuote: stubSize, listMarkets: async () => U, now: NOW } });
  const direct = q.risks.filter((r) => r.kind === "direct").map(({ kind: _k, ...r }) => r);
  assert.deepEqual(direct, getPreset("rainey-patio-bar")!.fallbackRisks);
  assert.match(q.model, /fallback-risk-map/);
  const creative = q.risks.filter((r) => r.kind === "proxy");
  assert.ok(creative.length >= 1, "creative section never empty");
  assert.ok(creative.some((r) => r.title.includes("Cold front")));
  assert.ok(q.naturalHedges!.length >= 1);
  // matcher returned nothing for these risks -> heuristics still give choices
  assert.ok(q.options!.some((o) => creative.some((r) => r.id === o.riskId)));
  assert.match(q.summary, /We found 4 risks/);
});

test("advise: matcher failure -> heuristic pick + ladder; non-preset profile gets keyword ideas", async () => {
  const llm = fakeLlm({ risk: () => RISKS_JSON }); // brainstorm, match, summary throw
  const q = await advise(profile, { deps: { llm, findCandidates: findU, sizeQuote: stubSize, listMarkets: async () => U, now: NOW } });
  const spurs = q.lines.find((l) => l.riskId === "r2")!;
  assert.deepEqual([spurs.contractId, spurs.side], ["gemini:SPURS", "no"]);
  assert.match(spurs.basisRisk, /Heuristic/);
  assert.ok(q.options!.find((o) => o.riskId === "r1")!.choices.length >= 2);

  const free: BusinessProfile = { id: "x", name: "Yoga Studio", description: "Outdoor yoga in the park", city: "Austin, TX", avgDailyRevenueUsd: 1000, busyDays: ["Sat"], monthlyBudgetUsd: 50 };
  const q2 = await advise(free, { deps: { llm: fakeLlm({}), findCandidates: async () => [], sizeQuote: stubSize } });
  assert.equal(q2.risks[0].lossUsd, 350);
  // business-aware fallback map (eval iter 5): outdoor yoga gets rain + cold, no 90°F heat risk in a description without heat
  assert.deepEqual(q2.risks.filter((r) => r.kind === "direct").map((r) => r.peril), ["rain", "cold"]);
  assert.equal(q2.uncovered.filter((u) => q2.risks.find((r) => r.id === u.riskId)?.kind === "direct").length, 2);
  // keyword idea (cold) duplicates the generic cold risk; the generic "gas squeezes spending" filler has no fuel hook in the
  // owner's words and is a weak link, so it is dropped (QA cycle 2)
  assert.deepEqual(q2.risks.filter((r) => r.kind === "proxy").map((r) => r.peril), []);
});

test("advise: lossUsd is clamped to 7 days of revenue and rounded", async () => {
  const llm = fakeLlm({ risk: () => ({ risks: [{ ...RISKS_JSON.risks[0], lossUsd: 1e9 }, RISKS_JSON.risks[1], { ...RISKS_JSON.risks[2], lossUsd: 1234.5 }] }), match: () => ({ matches: [] }) });
  const q = await advise(profile, { deps: { llm, findCandidates: async () => [], sizeQuote: stubSize } });
  assert.equal(q.risks[0].lossUsd, 4200 * 7);
  assert.equal(q.risks[2].lossUsd, 1230);
});

// ---------- ideas.ts helpers ----------
test("buildCatalog: one line per series, weather grouped across cities, intraday ticks skipped", () => {
  const cat = buildCatalog(U, profile, ["spurs", "san antonio"]);
  const text = cat.map((c) => c.line).join("\n");
  assert.equal(cat.filter((c) => c.peril === "heat").length, 1);
  assert.match(text, /heat \| Highest temperature in <city> on <date>\? .*cities: Austin, Dallas/);
  assert.equal(cat.find((c) => /Brent/.test(c.series))!.ids.length, 4);
  assert.ok(!/BTC price today/.test(text));
  assert.match(text, /Spurs vs Lakers/);
});

test("labelBound + ladderChoices only use the risk's own candidates", () => {
  assert.deepEqual(labelBound("$93 or above"), { dir: "up", v: 93 });
  assert.deepEqual(labelBound("Above 3.6200"), { dir: "up", v: 3.62 });
  assert.equal(labelBound("69°F or below").dir, "down");
  assert.equal(labelBound("74°F to 75°F").dir, "range");
  const oil = U.filter((c) => c.peril === "oil");
  const rec = { riskId: "r9", contractId: "gemini:BRENT20-93", side: "yes" as const, tier: "recommended", rationale: "r", basisRisk: "b" };
  const out = ladderChoices(rec, oil, [rec], 4);
  assert.deepEqual(out.map((l) => `${l.contractId}:${l.tier}`), ["gemini:BRENT20-93:recommended", "gemini:BRENT20-96:cheap-tail", "gemini:BRENT20-90:broad", "gemini:BRENT30-93:other-date"]);
  assert.equal(ladderChoices({ ...rec, contractId: "nope" }, oil, [], 3).length, 0);
});

test("fallbackIdeas: every preset has creative ideas and natural hedges", () => {
  for (const p of PRESETS) {
    const f = fallbackIdeas(p);
    assert.ok(f.ideas.length >= 2 && f.naturalHedges.length >= 1, p.id);
    assert.ok(f.ideas.every((i) => i.risk.kind === "proxy" && i.risk.correlation && i.risk.causalStory && i.hint));
  }
});

test("presets: 3 presets, public view strips fallbackRisks", () => {
  assert.equal(PRESETS.length, 3);
  for (const p of PRESETS) assert.ok(p.fallbackRisks.length >= 3 && p.avgDailyRevenueUsd > 0);
  assert.ok(publicPresets().every((p) => !("fallbackRisks" in p)));
});

test("enforceCandidates resolves a bare symbol (venue prefix dropped) only to a unique candidate", () => {
  const cands = [mk("kalshi:KXGAS-362"), mk("gemini:HEAT85")];
  const { legs, dropped } = enforceCandidates("r1", [
    { contractId: "KXGAS-362", side: "yes", rationale: "r", basisRisk: "b" },
    { contractId: "KXNOPE-1", side: "yes", rationale: "r", basisRisk: "b" },
  ], cands);
  assert.deepEqual(legs.map((l) => l.contractId), ["kalshi:KXGAS-362"]);
  assert.deepEqual(dropped, ["KXNOPE-1"]);
});

test("advise: two risks never buy the same contract in the default plan or a package", async () => {
  const two = { risks: [RISKS_JSON.risks[0], { ...RISKS_JSON.risks[0], title: "Hot Sunday", window: "Sun Nov 23", lossUsd: 500 }, RISKS_JSON.risks[1]] };
  const llm = fakeLlm({ risk: () => two, brainstorm: BRAIN, match: MATCH });
  const q = await advise(profile, { deps: { llm, findCandidates: findU, sizeQuote: stubSize, listMarkets: async () => U, now: NOW } });
  const ids = q.lines.map((l) => l.contractId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(q.lines.find((l) => l.riskId === "r1")!.contractId, "gemini:AUS78"); // bigger loss keeps the AI's pick
  for (const p of q.packages!) assert.equal(new Set(p.picks.map((x) => x.contractId)).size, p.picks.length, p.id);
});

test("advise: playbook seeds become creative ideas limited to their own contracts; a failing playbook is ignored", async () => {
  const seeds = [{ idea: { industry: "bar", title: "Silver-free test: Brent drives keg delivery surcharges", peril: "oil" as const, correlation: "strong" as const,
    causalStory: "Distributors add fuel surcharges that track Brent.", naturalHedgeNote: "Busy game nights offset slow rainy ones." },
    candidates: U.filter((c) => c.id === "gemini:BRENT30-93") }];
  const calls: string[] = [];
  const llm = fakeLlm({ risk: () => RISKS_JSON, brainstorm: (p) => { assert.match(p, /INDUSTRY PLAYBOOK/); return { ideas: [], naturalHedges: [] }; }, match: (p) => ({ matches: ids(p).map((riskId) => ({ riskId, picks: [] })) }) }, calls);
  const q = await advise(profile, { deps: { llm, findCandidates: findU, sizeQuote: stubSize, listMarkets: async () => U, playbookIdeas: () => seeds, now: NOW } });
  const pb = q.risks.find((r) => r.title.includes("keg delivery"))!;
  assert.equal(pb.kind, "proxy");
  // matcher gave no picks -> uncovered with its reason; options only ever reference the seed contract
  for (const o of q.options ?? []) if (o.riskId === pb.id) assert.ok(o.choices.every((c) => c.contractId === "gemini:BRENT30-93"));
  assert.ok(q.naturalHedges!.some((n) => n.explanation.includes("rainy ones")));
  assert.ok(calls.length <= 4);

  const q2 = await advise(profile, { deps: { llm: fakeLlm({ risk: () => RISKS_JSON, match: MATCH }), findCandidates: findU, sizeQuote: stubSize, listMarkets: async () => U,
    playbookIdeas: () => { throw new Error("boom"); }, now: NOW } });
  assert.ok(q2.lines.length > 0);
});
