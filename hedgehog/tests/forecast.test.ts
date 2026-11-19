// Forecast-aware advice: NWS / Open-Meteo parsing (saved real responses), busy-day-weighted signals, forecast vs market
// notes, fallback risks steered by the forecast, the heads-up banner, and advise() still <= 4 LLM calls. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applySignals, attachForecast, computeSignals, forecastBlock, forecastProbYes, lineForecast, marketDates, nwsDays, parseNwsAlerts,
  parseNwsForecast, parseNwsHourly, parseOpenMeteo, thresholdsFor, type ForecastDay, type ForecastSummary,
} from "../lib/ai/forecast";
import { headsUpItems } from "../lib/client/headsUp";
import { advise, type AdvisorDeps, type SizeQuoteFn } from "../lib/ai/advisor";
import { getPreset } from "../lib/ai/presets";
import type { GenerateJson } from "../lib/ai/llm";
import type { MarketContract, Quote, QuoteLine } from "../lib/types";

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8"));
const TODAY = "2026-11-19";

// ---------- parsing (real responses saved 2026-11-19, Austin) ----------
test("NWS forecast + hourly -> 7 days: highs, overnight lows, max PoP, text", () => {
  const acc = parseNwsForecast(fx("forecast-nws-daily-austin.json"));
  parseNwsHourly(fx("forecast-nws-hourly-austin.json"), acc);
  const days = nwsDays(acc, TODAY);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.dow), ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]);
  const sat = days.find((d) => d.date === "2026-11-21")!;
  assert.equal(sat.high, 76);                 // "Saturday" period
  assert.equal(sat.low, 56);                  // "Friday Night" low = Saturday morning
  assert.ok(sat.pop! >= 11, "Saturday Night 11% counts for Saturday (evening trade)");
  assert.equal(days.find((d) => d.date === "2026-11-25")!.high, 57);
  assert.ok(days.every((d) => d.high != null && d.pop != null));
});

test("Open-Meteo fallback -> days (°F, max precipitation probability)", () => {
  const days = parseOpenMeteo(fx("forecast-openmeteo-austin.json"), TODAY);
  assert.equal(days.length, 7);
  assert.deepEqual(days[2], { date: "2026-11-21", dow: "Sat", high: 77, low: 57, pop: 3, text: "Fog" });
  assert.equal(parseOpenMeteo(fx("forecast-openmeteo-austin.json"), "2026-11-23").length, 3);
});

test("NWS alerts -> signals: flood + winter alerts become signals, statements are skipped; no alerts in Austin today", () => {
  assert.deepEqual(parseNwsAlerts(fx("forecast-nws-alerts-austin.json")), []);
  const alerts = parseNwsAlerts(fx("forecast-nws-alerts-sample.json"));
  assert.deepEqual(alerts.map((a) => a.event), ["Winter Weather Advisory", "Coastal Flood Statement", "Flood Warning"]);
  const sig = computeSignals([], alerts);
  assert.deepEqual(sig.map((s) => s.kind).sort(), ["flood", "snow"]);
  assert.equal(sig.find((s) => s.kind === "flood")!.peril, "rain");
  assert.match(sig.find((s) => s.kind === "flood")!.text, /^Flood Warning until \w{3}$/);
});

// ---------- signals ----------
const day = (date: string, over: Partial<ForecastDay> = {}): ForecastDay => ({ date, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00Z`).getUTCDay()], high: 72, low: 55, pop: 5, text: "Sunny", ...over });
const WEEK = [day("2026-11-19"), day("2026-11-20"), day("2026-11-21", { pop: 60, text: "Chance Showers" }), day("2026-11-22"), day("2026-11-23"), day("2026-11-24", { pop: 80, text: "Showers" }), day("2026-11-25", { high: 48, low: 30 })];

test("signals: rain >= 50% only, busy days weighted double (Sat 60% outranks Tue 80% for a weekend business)", () => {
  const weekend = computeSignals(WEEK, [], { busyDays: ["Fri", "Sat", "Sun"] });
  const rain = weekend.filter((s) => s.kind === "rain");
  assert.deepEqual(rain.map((s) => s.dow), ["Sat", "Tue"]);
  assert.ok(rain[0].busy && !rain[1].busy);
  assert.equal(rain[0].text, "Rain possible Sat (60%)");
  assert.equal(rain[1].text, "Rain likely Tue (80%)");
  const weekday = computeSignals(WEEK, [], { busyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] });
  assert.equal(weekday[0].dow, "Tue", "a weekday business: Tuesday first");
  assert.ok(!computeSignals([day("2026-11-21", { pop: 40 })], []).length, "40% is not a signal");
});

test("signals: cold / freeze / heat vs the business's thresholds; storms from the text", () => {
  const s = computeSignals(WEEK, [], { busyDays: ["Wed"] });
  assert.ok(s.some((x) => x.kind === "cold" && x.dow === "Wed" && x.text === "Cold Wed (high 48°F)"));
  assert.ok(s.some((x) => x.kind === "freeze" && x.value === 30));
  assert.deepEqual(thresholdsFor("When it's cold nobody comes"), { heatF: 90, coldHighF: 55, freezeLowF: 32, rainPct: 50 });
  const cool = [day("2026-11-25", { high: 53 })];
  assert.equal(computeSignals(cool, []).length, 0, "53°F is not cold for most businesses");
  assert.equal(computeSignals(cool, [], { description: "cold days kill the lunch line" })[0].kind, "cold");
  assert.equal(computeSignals([day("2026-07-04", { high: 101 })], [], {})[0].text, "Hot Sat (101°F)");
  assert.equal(computeSignals([day("2026-11-21", { pop: 70, text: "Showers And Thunderstorms Likely" })], [])[0].text, "Storms likely Sat (70%)");
});

// ---------- forecast vs market ----------
const SUMMARY = (days = WEEK): ForecastSummary => ({ place: "Austin", lat: 30.27, lon: -97.74, source: "NWS", fetchedAt: "2026-11-19T18:00:00Z", days, alerts: [], signals: computeSignals(days, [], { busyDays: ["Fri", "Sat", "Sun"] }) });
const mkc = (id: string, over: Partial<MarketContract> = {}): MarketContract => ({
  id, venue: "kalshi", eventTitle: "Where will it rain this weekend (Nov 21 - Nov 22)?", label: "Austin", symbol: id, eventTicker: "E", peril: "rain", location: "Austin",
  expiry: "2026-11-23T06:00:00Z", yesAsk: 0.23, yesBid: 0.2, noAsk: 0.79, noBid: 0.77, tradable: true, status: "open", ...over,
});
const line = (c: MarketContract, side: "yes" | "no", implied: number): QuoteLine => ({
  riskId: "r1", contractId: c.id, side, rationale: "", basisRisk: "", contract: c, coveragePct: 50, contracts: 100, pricePerContract: implied, premiumUsd: 100 * implied, payoutUsd: 100, impliedProb: implied, action: "buy-onchain",
});

test("forecast vs market: weekend rain = 1 - P(no rain Sat) x P(no rain Sun); note only at >= 15 pts", () => {
  const s = SUMMARY([day("2026-11-21", { pop: 70 }), day("2026-11-22", { pop: 0 })]);
  const wk = mkc("kalshi:KXRAINWKND-26NOV21-AUS");
  assert.deepEqual(marketDates(wk), ["2026-11-21", "2026-11-22"]);
  assert.equal(forecastProbYes(wk, s)!.prob, 0.7);
  assert.deepEqual(lineForecast(line(wk, "yes", 0.23), s), { prob: 0.7, marketProb: 0.23, source: "NWS", date: "2026-11-21", note: "Forecast 70% vs market 23%: cheap cover" });
  assert.equal(lineForecast(line(wk, "yes", 0.6), s)!.note, undefined, "10 pts apart: no note");
  assert.equal(lineForecast(line(wk, "yes", 0.55), s)!.note, "Forecast 70% vs market 55%: cheap cover", "exactly 15 pts: note");
  assert.equal(lineForecast(line(wk, "yes", 0.9), s)!.note, "Forecast 70% vs market 90%: pricey for now");
  assert.equal(lineForecast(line(wk, "no", 0.79), s)!.prob, 0.3, "NO side: the chance it stays dry");
  // monthly totals and days outside the forecast: no opinion
  assert.equal(forecastProbYes(mkc("k:M", { eventTitle: "Rain in Austin in Nov 2026?", label: "Above 4 inches" }), s), null);
  assert.equal(forecastProbYes(mkc("k:D", { eventTitle: "Rain in Austin on Feb 14, 2027?", label: "Above 0 inches", expiry: "2027-02-15T05:59:00Z" }), s), null);
});

test("forecast vs market: temperature thresholds and buckets from the forecast high (spread grows with lead time)", () => {
  const s = SUMMARY([day("2026-11-19", { high: 74 }), day("2026-11-20", { high: 77 })]);
  const hi = (label: string, d = "November 20, 2026") => mkc(`g:${label}`, { venue: "gemini", peril: "heat", eventTitle: `Highest temperature in Austin on ${d}?`, label, expiry: "2026-11-21T04:59:59Z" });
  const above78 = forecastProbYes(hi("78°F or above"), s)!.prob;
  assert.ok(above78 > 0.3 && above78 < 0.5, `P(high >= 78 | forecast 77) = ${above78}`);
  assert.ok(forecastProbYes(hi("73°F or below"), s)!.prob < 0.15);
  const bucket = forecastProbYes(hi("76°F to 77°F"), s)!.prob;
  assert.ok(bucket > 0.2 && bucket < 0.45, `bucket ${bucket}`);
  assert.equal(forecastProbYes(hi("74°F or above", "November 19, 2026"), s), null, "today: the market already sees the observed high");
  const lowTitle = mkc("k:LOW", { peril: "cold", eventTitle: "Lowest temperature in Austin on Nov 20, 2026?", label: "45° or below" });
  assert.equal(forecastProbYes(lowTitle, s), null, "lows skipped: grid point vs station");
  // a note only when the point forecast and the market disagree on the outcome
  assert.equal(lineForecast(line(hi("73°F or below"), "yes", 0.05), s)!.note, undefined, "77 forecast, market 5% on <= 73: they agree");
  assert.equal(lineForecast(line(hi("80°F or above"), "yes", 0.6), s)!.note, "Forecast 22% vs market 60%: pricey for now");
});

test("attachForecast: plan lines and every choice get QuoteLine.forecast; non-weather lines untouched", () => {
  const s = SUMMARY([day("2026-11-21", { pop: 70 }), day("2026-11-22", { pop: 0 })]);
  const wk = line(mkc("kalshi:WK"), "yes", 0.24);
  const gas = line(mkc("kalshi:GAS", { peril: "gas", eventTitle: "US gas price on Nov 30?", label: "Above $3.40" }), "yes", 0.3);
  const q = { lines: [wk, gas], options: [{ riskId: "r1", choices: [{ ...wk }] }], risks: [] } as unknown as Quote;
  attachForecast(q, s);
  assert.equal(q.lines[0].forecast?.note, "Forecast 70% vs market 24%: cheap cover");
  assert.equal(q.lines[1].forecast, undefined);
  assert.equal(q.options![0].choices[0].forecast?.prob, 0.7);
});

// ---------- prompts + fallback ----------
test("forecastBlock + applySignals: a rainy busy Saturday moves the rain risk first, dated to that day", () => {
  const s = SUMMARY();
  const block = forecastBlock(s);
  assert.match(block, /WEATHER FORECAST for Austin \(NWS/);
  assert.match(block, /Rain possible Sat \(60%\) \[busy day\]/);
  const truck = { ...getPreset("east-austin-food-truck")! };
  const risks = applySignals(truck.fallbackRisks, s, truck);
  assert.equal(risks[0].peril, "rain");
  assert.equal(risks[0].window, "2026-11-21");
  assert.match(risks[0].title, /^Rain on Sat, a busy day$/);
  assert.match(risks[0].lossReasoning, /Forecast: Rain possible Sat \(60%\)\./);
  assert.deepEqual(risks.map((r) => r.id), ["r1", "r2", "r3"]);
  const broker = { ...truck, presetId: undefined, description: "Mortgage broker, variable-rate warehouse line." };
  const fed = [{ id: "r1", peril: "fed" as const, title: "Fed", trigger: "x", lossUsd: 100, lossReasoning: "y", confidence: 0.4 }];
  assert.deepEqual(applySignals(fed, s, broker), fed, "no weather exposure: untouched");
});

// ---------- heads-up banner ----------
test("heads-up: signal line + its cover price; a calm line when the week is quiet", () => {
  const s = SUMMARY([day("2026-11-20"), day("2026-11-21", { pop: 70 }), day("2026-11-22", { pop: 0 })]);
  const wk = { ...line(mkc("kalshi:WK"), "yes", 0.24), forecast: { prob: 0.7, marketProb: 0.24, source: "NWS" as const, date: "2026-11-21", note: "Forecast 70% vs market 24%: cheap cover" } };
  const q = { lines: [wk], options: [], risks: [{ id: "r1", peril: "rain" }] } as unknown as Quote;
  const items = headsUpItems(s, q);
  assert.equal(items[0].text, "Rain likely Sat (70%), your busy day.");
  assert.equal(items[0].cover, "Weekend rain cover: 24¢ per $1.");
  assert.equal(items[0].line?.contractId, "kalshi:WK");
  const calm = headsUpItems(SUMMARY([day("2026-11-20", { high: 76, pop: 0 }), day("2026-11-21", { high: 75, pop: 11 })]), null);
  assert.deepEqual(calm.map((i) => i.text), ["Dry week ahead: highs 75–76°F, rain chance under 20%."]);
});

// ---------- advise(): forecast in the prompts, still <= 4 calls ----------
const stubSize: SizeQuoteFn = async ({ legs, contracts, coveragePct, risks }) => {
  const lines: QuoteLine[] = legs.map((l) => {
    const c = contracts.get(l.contractId)!; const r = risks.find((x) => x.id === l.riskId)!;
    const px = (l.side === "yes" ? c.yesAsk : c.noAsk) ?? 0.5; const n = Math.ceil((coveragePct / 100) * r.lossUsd);
    return { ...l, contract: c, coveragePct, contracts: n, pricePerContract: px, premiumUsd: n * px, payoutUsd: n, impliedProb: px, action: "buy-onchain" };
  });
  return { lines, uncovered: [], totalPremiumUsd: lines.reduce((a, l) => a + l.premiumUsd, 0), totalPayoutUsd: lines.reduce((a, l) => a + l.payoutUsd, 0) };
};
const WKND = mkc("kalshi:KXRAINWKND-26NOV21-AUS", { yesAsk: 0.24, noAsk: 0.78 });

test("advise: the forecast reaches the risk-map + brainstorm prompts (no extra LLM call) and weather lines get forecast notes", async () => {
  const prompts: Record<string, string> = {};
  const llm = (async (o: any) => {
    const which = o.system.includes("creative hedging strategist") ? "brainstorm" : o.system.includes("risk analyst") ? "risk" : o.system.includes("pick prediction-market") ? "match" : "summary";
    prompts[which] = o.prompt;
    const out = which === "risk" ? { risks: [
      { peril: "rain", title: "Rain on Saturday", trigger: "Rain in Austin this weekend (Nov 21-22)", location: "Austin", window: "Nov 21-22", lossUsd: 1300, lossReasoning: "Sat $2,200 -60%", confidence: 0.7 },
      { peril: "heat", title: "Hot lunch", trigger: "Austin high >= 90°F", location: "Austin", window: "next 7 days", lossUsd: 300, lossReasoning: "lunch -30%", confidence: 0.4 },
      { peril: "cold", title: "Cold snap", trigger: "Austin high below 50°F", location: "Austin", window: "next 7 days", lossUsd: 300, lossReasoning: "walk-ups -25%", confidence: 0.4 },
    ] } : which === "brainstorm" ? { ideas: [], naturalHedges: [] }
      : which === "match" ? { matches: [{ riskId: "r1", picks: [{ contractId: WKND.id, side: "yes", tier: "recommended", rationale: "weekend rain", basisRisk: "airport gauge" }] }] }
      : { summary: "Rain cover for the weekend." };
    return { data: o.schema.parse(out), model: `fake/${which}` };
  }) as GenerateJson;
  const truck = { ...getPreset("east-austin-food-truck")! };
  let fcCalls = 0;
  const deps: Partial<AdvisorDeps> = { llm, findCandidates: async (r) => (r.peril === "rain" ? [WKND] : []), sizeQuote: stubSize, now: () => new Date("2026-11-19T18:00:00Z"),
    forecast: async () => { fcCalls++; return SUMMARY([day("2026-11-19"), day("2026-11-20"), day("2026-11-21", { pop: 70 }), day("2026-11-22", { pop: 0 })]); } };
  const q = await advise(truck, { deps });
  assert.equal(fcCalls, 1);
  assert.ok(Object.keys(prompts).length <= 4);
  assert.match(prompts.risk, /WEATHER FORECAST for Austin/);
  assert.match(prompts.risk, /Rain likely Sat \(70%\) \[busy day\]/);
  assert.match(prompts.brainstorm, /WEATHER FORECAST/);
  const l = q.lines.find((x) => x.contractId === WKND.id)!;
  assert.equal(l.forecast?.note, "Forecast 70% vs market 24%: cheap cover");
});

test("advise: LLM down -> fallback risks follow the forecast (rainy busy Sat first) and lines still get the forecast", async () => {
  let calls = 0;
  const llm = (async () => { calls++; throw new Error("429 quota"); }) as GenerateJson;
  const truck = { ...getPreset("east-austin-food-truck")! };
  const q = await advise(truck, { deps: { llm, findCandidates: async (r) => (r.peril === "rain" ? [WKND] : []), sizeQuote: stubSize, now: () => new Date("2026-11-19T18:00:00Z"),
    forecast: async () => SUMMARY([day("2026-11-19"), day("2026-11-20"), day("2026-11-21", { pop: 70 }), day("2026-11-22", { pop: 0 })]) } });
  assert.ok(calls <= 4);
  assert.equal(q.risks[0].peril, "rain");
  assert.equal(q.risks[0].window, "2026-11-21");
  assert.ok(q.lines.some((l) => l.contractId === WKND.id && l.forecast?.prob === 0.7));
});
