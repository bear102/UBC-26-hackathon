// Regression tests for fixes found by the AI eval loop (scripts/eval-ai.ts, docs/AI-EVAL.md). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates, underlyings } from "../lib/markets/index";
import type { BusinessProfile, MarketContract, Risk } from "../lib/types";

const profile: BusinessProfile = { id: "t", name: "T", description: "roofer", city: "Austin, TX", avgDailyRevenueUsd: 1000, busyDays: ["Mon"], monthlyBudgetUsd: 100 };
const mk = (id: string, eventTitle: string, label: string, peril: MarketContract["peril"], yesAsk = 0.3): MarketContract => ({
  id, venue: "gemini", eventTitle, label, symbol: id, eventTicker: id, peril, expiry: "2026-11-30T22:00:00Z",
  yesAsk, yesBid: yesAsk - 0.02, noAsk: 1 - yesAsk + 0.02, noBid: 1 - yesAsk - 0.02, tradable: true, status: "open",
});
const risk = (over: Partial<Risk>): Risk => ({ id: "r1", peril: "other", title: "", trigger: "", window: "Nov 30", lossUsd: 100, lossReasoning: "x", confidence: 0.5, ...over });
const now = new Date("2026-11-19T15:00:00Z");

test("iter1: underlyings() names coins/metals/energy and keeps natural gas apart from pump gas", () => {
  assert.deepEqual(underlyings("Natural Gas price on November 30?").map((u) => u.key), ["natgas"]);
  assert.deepEqual(underlyings("US gas prices this week").map((u) => u.key), ["gasoline"]);
  assert.deepEqual(underlyings("Oil (WTI) price on November 20?").map((u) => u.group), ["crude", "crude"]);
});

test("iter1: rankCandidates never offers gold for a copper risk or SOL for a BTC risk", () => {
  const u = [mk("g:XAU", "Gold price on November 30?", "$3,725 or above", "other"), mk("g:CU", "Copper price on November 30?", "$6 or above", "other"),
    mk("g:SOL", "SOL price on November 30", "$73 or above", "crypto"), mk("g:BTC", "BTC price on November 30", "$63,500 or above", "crypto")];
  const cu = rankCandidates(risk({ title: "Copper price spike", trigger: "Copper above $6 on Nov 30" }), profile, u, 10, now).map((c) => c.id);
  assert.deepEqual(cu, ["g:CU"]);
  const btc = rankCandidates(risk({ peril: "crypto", title: "Bitcoin drop", trigger: "BTC below $63,000 on Nov 30" }), profile, u, 10, now).map((c) => c.id);
  assert.deepEqual(btc, ["g:BTC"]);
  // a risk that names no underlying still sees every series
  assert.equal(rankCandidates(risk({ title: "Metal costs", trigger: "metal prices rise" }), profile, u, 10, now).length, 2);
});

import { guardSide } from "../lib/ai/advisor";
test("iter2: guardSide flips a wrong side on threshold contracts and drops NO on a range bucket", () => {
  const leg = { riskId: "r1", contractId: "g:GAS", side: "no" as const, rationale: "x", basisRisk: "y" };
  const gas = mk("g:GAS", "US gas prices this week", "Above 3.6400", "gas", 0.37);
  const fixed = guardSide(risk({ peril: "gas", title: "US gas price spike", trigger: "US gas prices above 3.54" }), leg, gas);
  assert.equal(fixed?.side, "yes");
  const sol = mk("g:SOL", "SOL price on November 30", "$73 or above", "crypto", 0.7);
  assert.equal(guardSide(risk({ peril: "crypto", title: "SOL drawdown", trigger: "SOL falls below $73" }), { ...leg, contractId: "g:SOL" }, sol)?.side, "no");
  const bucket = mk("g:B", "Highest temperature in Austin on Nov 19?", "74° to 75°", "heat", 0.4);
  assert.equal(guardSide(risk({ peril: "heat", title: "Heat", trigger: "high 76°F or above" }), { ...leg, contractId: "g:B" }, bucket), null);
  const game = mk("g:G", "Arkansas vs Texas", "Texas", "game", 0.9);
  assert.equal(guardSide(risk({ peril: "game", title: "Texas loses", trigger: "Arkansas beats Texas" }), { ...leg, contractId: "g:G" }, game)?.side, "no");
});

import { groundedRisk } from "../lib/ai/advisor";
test("iter4: macro risks need a hook in the owner's words", () => {
  const p = (description: string): BusinessProfile => ({ ...profile, description });
  assert.equal(groundedRisk("gas", p("Independent mortgage broker; volume lives and dies by rates")), false);
  assert.equal(groundedRisk("gas", p("four delivery vans doing 3,000 miles a week")), true);
  assert.equal(groundedRisk("fed", p("coffee cart at the farmers market")), false);
  assert.equal(groundedRisk("fed", p("we carry a $150k line of credit")), true);
  assert.equal(groundedRisk("rain", p("anything")), true);
});

import { fallbackRisks, heuristicPick, marketDays, sameExposureX } from "../lib/ai/advisor";
test("iter5: fallback risks follow the business (no weather map for a mortgage broker)", () => {
  const mb = fallbackRisks({ ...profile, id: "x", description: "Independent mortgage broker; refi volume follows mortgage rates and inflation prints." });
  assert.deepEqual(mb.map((r) => r.peril).sort(), ["cpi", "fed"]);
  const cart = fallbackRisks({ ...profile, id: "y", description: "Outdoor coffee cart at the farmers market", busyDays: ["Sat", "Sun"] });
  assert.ok(cart.some((r) => r.peril === "rain") && !cart.some((r) => r.peril === "fed"));
});
test("iter5: heuristic game pick follows win/lose; rain pick lands on a busy day", () => {
  const g = [mk("k:AM", "Texas A&M vs Oklahoma", "Texas A&M", "game", 0.4), mk("k:OU", "Texas A&M vs Oklahoma", "Oklahoma", "game", 0.62)];
  assert.equal(heuristicPick(risk({ peril: "game", title: "Texas A&M wins (rival game pulls the crowd)", trigger: "Texas A&M wins its next game" }), g)?.side, "yes");
  const rain = [mk("k:WK", "Where will it rain this weekend (Nov 21 - Nov 22)?", "Austin", "rain", 0.35), mk("k:TG", "Where will it rain on Thanksgiving?", "Austin", "rain", 0.23)];
  assert.deepEqual(marketDays(rain[0]), ["Sat", "Sun"]);
  assert.equal(heuristicPick(risk({ peril: "rain", title: "Rain", trigger: "Rain on Mon-Fri" }), rain, ["Mon", "Tue", "Wed", "Thu", "Fri"])?.contractId, "k:TG");
  assert.equal(heuristicPick(risk({ peril: "rain", title: "Rain", trigger: "Rain on Sat/Sun" }), rain, ["Sat", "Sun"])?.contractId, "k:WK");
});
test("iter5: one game hedged once; different matchups of the same team stay separate", () => {
  const a = risk({ peril: "game", title: "Spurs lose to the Clippers", trigger: "Los Angeles C vs San Antonio on Nov 21" });
  assert.equal(sameExposureX(risk({ peril: "game", title: "Our team loses", trigger: "Los Angeles C beats our team (Los Angeles C vs San Antonio, Nov 21)" }), a), true);
  assert.equal(sameExposureX(risk({ peril: "game", title: "Longhorns lose", trigger: "Southern Utah vs Texas on Nov 21" }), risk({ peril: "game", title: "Our team loses", trigger: "Arkansas beats our team (Arkansas vs Texas, Nov 23)" })), false);
});

test("iter5b: heuristic Fed pick never buys a cut for a 'no cut' risk (Gemini 'Cut >25bps' labels)", () => {
  const f = [mk("g:CUT", "Fed decision in December?", "Cut >25bps", "fed", 0.05), mk("g:HOLD", "Fed decision in December?", "Fed maintains rate", "fed", 0.3)];
  const leg = heuristicPick(risk({ peril: "fed", title: "Rates stay high (no Fed cut)", trigger: "No Fed rate cut at the next FOMC meeting" }), f);
  assert.deepEqual([leg?.contractId, leg?.side], ["g:HOLD", "yes"]);
});

// ---------- long-term & creative hedges loop, iteration 2 (lib/ai/horizon.ts) ----------
import { readFileSync } from "node:fs";
import { parseWindow } from "../lib/markets/index";
import { setMeta } from "../lib/markets/normalize";
import { sizeQuote } from "../lib/markets/quote";
import { advise } from "../lib/ai/advisor";

test("hz2: parseWindow understands seasons and months (NBA playoffs end in June 2027; December is Dec 1-31)", () => {
  const w = parseWindow("through the NBA playoffs", now);
  assert.equal(w.end.slice(0, 7), "2027-06");
  assert.deepEqual([parseWindow("December", now).start, parseWindow("December", now).end], ["2026-12-01", "2026-12-31"]);
  assert.equal(parseWindow("next 7 days", now).end, "2026-11-26"); // short windows unchanged
});

test("hz2: a landscaper's month-rain risk ranks the monthly total above daily rain", () => {
  const month = { ...mk("kalshi:KXRAINAUSM-26NOV-5", "Rain in Austin in Nov 2026?", "Above 5 inches", "rain", 0.2), venue: "kalshi" as const, location: "Austin", eventTicker: "KXRAINAUSM-26NOV" };
  const day = { ...mk("kalshi:KXRAINTHANKSGIVING-26NOV26-AUS", "Where will it rain on Thanksgiving?", "Austin", "rain", 0.17), venue: "kalshi" as const, location: "Austin", eventTicker: "KXRAINTHANKSGIVING-26NOV26" };
  setMeta(month.id, { eventDate: "2026-11-01", eventEnd: "2026-11-30", bounds: { lo: 5, loInclusive: false, hiInclusive: false, unit: "in", text: ">5 in" } });
  setMeta(day.id, { eventDate: "2026-11-26" });
  const land: BusinessProfile = { ...profile, description: "landscaping crews", busyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"] };
  const r = risk({ peril: "rain", title: "A soaked November rains out crew days", trigger: "Austin gets more than 5 inches of rain in November", location: "Austin", window: "November", horizon: "month" });
  assert.equal(rankCandidates(r, land, [day, month], 5, now)[0].id, month.id);
  // a this-week rain risk still prefers the day market
  assert.equal(rankCandidates(risk({ peril: "rain", title: "Rain on a crew day", trigger: "Rain in Austin on Thanksgiving", location: "Austin", window: "next 7 days" }), land, [day, month], 5, now)[0].id, day.id);
});

test("hz2: Spurs bar fallback plan (no LLM) carries a NO on a Spurs playoffs / West / WCF future", async () => {
  const LONG: MarketContract[] = JSON.parse(readFileSync(new URL("./fixtures/long-horizon-markets.json", import.meta.url), "utf8"));
  const meta: Record<string, { eventEnd: string; futureKind: "playoffs" | "round" | "conference" | "wins"; league: string; teams: string[] }> = {
    "gemini:GEMI-NBAF-2627CONF-WEST-SAS": { eventEnd: "2027-05-31", futureKind: "conference", league: "NBA", teams: ["San Antonio"] },
    "kalshi:KXNBAWEST-27-SAS": { eventEnd: "2027-05-31", futureKind: "conference", league: "NBA", teams: ["San Antonio"] },
    "kalshi:KXNBAPLAYOFF-27-SAS": { eventEnd: "2027-04-17", futureKind: "playoffs", league: "NBA", teams: ["San Antonio"] },
    "kalshi:KXNBAWCFQUAL-27-SAS": { eventEnd: "2027-05-17", futureKind: "round", league: "NBA", teams: ["San Antonio"] },
  };
  for (const [id, m] of Object.entries(meta)) setMeta(id, { eventDate: "2026-10-20", ...m });
  const bar: BusinessProfile = { id: "spurs-bar", name: "Spurs Bar", description: "Sports bar by the Frost Bank Center. A deep Spurs playoff run means weeks of packed nights.", city: "San Antonio, TX", avgDailyRevenueUsd: 5000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 400 };
  const fail = (async () => { throw new Error("LLM down"); }) as never;
  const q = await advise(bar, { deps: { llm: fail, now: () => now, listMarkets: async () => LONG, findCandidates: async (r, p, n) => rankCandidates(r, p, LONG, n, now),
    sizeQuote: (a) => sizeQuote({ ...a, fetchBooks: false, crossCheck: false }) } });
  const season = q.risks.find((r) => r.horizon === "season")!;
  assert.match(season.title, /Spurs/);
  // the season risk is offered as a NO on a Spurs future; in this fixture the only deep book is NO 66c (WCF NO 41c has 4
  // contracts, playoffs NO 4c has 14: dust), so the plan leaves it out as prepaying the payout (QA cycle 3)
  const opt = q.options?.find((o) => o.riskId === season.id);
  assert.ok(opt?.choices.some((c) => c.side === "no" && Object.keys(meta).includes(c.contractId)), "season risk offered as a NO future");
  const line = q.lines.find((l) => l.riskId === season.id && l.contracts > 0);
  if (line) { assert.equal(line.side, "no"); assert.ok(line.pricePerContract < 0.6); }
  else assert.match(q.uncovered.find((u) => u.riskId === season.id)?.reason ?? "", /coin flip|prepay/);
  assert.ok(q.totalPremiumUsd <= bar.monthlyBudgetUsd + 1e-9, `plan premium ${q.totalPremiumUsd} stays inside the budget`);
  for (const pk of q.packages ?? []) assert.ok(pk.totalPremiumUsd <= bar.monthlyBudgetUsd + 1e-9, `${pk.name} ${pk.totalPremiumUsd} inside the budget`);
});
