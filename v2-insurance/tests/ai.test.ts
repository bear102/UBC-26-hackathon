// AI layer tests: no network. Fake LLM providers + stub market functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod/v4";
import { generateJsonWith, extractJson, LlmError, type Provider, type GenerateJson } from "../lib/ai/llm";
import { advise, enforceCandidates, heuristicPick, type AdvisorDeps, type SizeQuoteFn } from "../lib/ai/advisor";
import { PRESETS, getPreset, publicPresets } from "../lib/ai/presets";
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
function fakeLlm(handlers: { risk?: () => unknown; match?: (prompt: string) => unknown; summary?: () => unknown }): GenerateJson {
  return (async (opts: any) => {
    const which = opts.system.includes("risk analyst") ? "risk" : opts.system.includes("pick prediction-market") ? "match" : "summary";
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
test("advise: full path; invented market dropped; no-candidate risk goes to uncovered", async () => {
  const llm = fakeLlm({
    risk: () => RISKS_JSON,
    match: (prompt) => prompt.includes("Spurs lose")
      ? { picks: [{ contractId: "gemini:SPURS", side: "no", rationale: "Pays if Spurs lose", basisRisk: "Loss != empty bar" },
                  { contractId: "kalshi:INVENTED", side: "yes", rationale: "x", basisRisk: "x" }] }
      : { picks: [{ contractId: "gemini:HEAT85", side: "yes", rationale: "Pays if hot", basisRisk: "Camp Mabry, not Rainey St" }] },
    summary: () => ({ summary: "Two hedges cost a little and cover heat and the Spurs. Rain is not covered." }),
  });
  const q = await advise(profile, { coveragePct: 50, deps: { llm, findCandidates: stubFind, sizeQuote: stubSize, now: () => new Date("2026-11-19T12:00:00Z") } });
  assert.deepEqual(q.risks.map((r) => r.id), ["r1", "r2", "r3"]);
  assert.deepEqual(q.lines.map((l) => l.contractId).sort(), ["gemini:HEAT85", "gemini:SPURS"]);
  assert.ok(q.lines.every((l) => !l.contractId.startsWith("kalshi:INVENTED")));
  assert.equal(q.uncovered.length, 1);
  assert.equal(q.uncovered[0].riskId, "r3");
  assert.match(q.uncovered[0].reason, /No live market for rain in Austin/);
  assert.equal(q.budgetUsd, 300);
  assert.equal(q.totalPayoutUsd, 400 + 450);
  assert.match(q.model, /fake\/risk/);
  assert.match(q.summary, /Rain is not covered/);
});

test("advise: risk-map LLM failure -> preset fallback risks; summary failure -> template", async () => {
  const llm = fakeLlm({ match: () => ({ picks: [], noMatchReason: "No contract on that date." }) });
  const q = await advise(profile, { deps: { llm, findCandidates: stubFind, sizeQuote: stubSize } });
  assert.deepEqual(q.risks, getPreset("rainey-patio-bar")!.fallbackRisks);
  assert.match(q.model, /fallback-risk-map/);
  assert.equal(q.lines.length, 0);
  assert.equal(q.uncovered.length, q.risks.length);
  assert.ok(q.uncovered.some((u) => u.reason === "No contract on that date."));
  assert.match(q.summary, /We found 4 risks/);
});

test("advise: matcher failure -> heuristic pick; non-preset profile fallback is revenue-scaled", async () => {
  const llm = fakeLlm({ risk: () => RISKS_JSON }); // match + summary throw
  const q = await advise(profile, { deps: { llm, findCandidates: stubFind, sizeQuote: stubSize } });
  assert.ok(q.lines.find((l) => l.riskId === "r2" && l.contractId === "gemini:SPURS" && l.side === "no"));
  assert.match(q.lines[0].basisRisk, /Heuristic/);

  const free: BusinessProfile = { id: "x", name: "Yoga Studio", description: "Outdoor yoga", city: "Austin, TX", avgDailyRevenueUsd: 1000, busyDays: ["Sat"], monthlyBudgetUsd: 50 };
  const q2 = await advise(free, { deps: { llm: fakeLlm({}), findCandidates: async () => [], sizeQuote: stubSize } });
  assert.equal(q2.risks[0].lossUsd, 350);
  assert.equal(q2.uncovered.length, 3);
});

test("advise: lossUsd is clamped to 7 days of revenue and rounded", async () => {
  const llm = fakeLlm({ risk: () => ({ risks: [{ ...RISKS_JSON.risks[0], lossUsd: 1e9 }, RISKS_JSON.risks[1], { ...RISKS_JSON.risks[2], lossUsd: 1234.5 }] }), match: () => ({ picks: [] }) });
  const q = await advise(profile, { deps: { llm, findCandidates: async () => [], sizeQuote: stubSize } });
  assert.equal(q.risks[0].lossUsd, 4200 * 7);
  assert.equal(q.risks[2].lossUsd, 1230);
});

test("presets: 3 presets, public view strips fallbackRisks", () => {
  assert.equal(PRESETS.length, 3);
  for (const p of PRESETS) assert.ok(p.fallbackRisks.length >= 3 && p.avgDailyRevenueUsd > 0);
  assert.ok(publicPresets().every((p) => !("fallbackRisks" in p)));
});
