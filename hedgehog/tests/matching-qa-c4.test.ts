// Regressions from matching QA cycle 4 (Nov 20 2026): one-day weather contracts on the wrong day, college teams missing
// (Kentucky got NBA games, a Pitt football lot got the Steelers), away games for a shop next to the stadium, crossed Gemini
// books, bounded snow-day buckets as heavy-tail cover, same-ladder proxies, 57c season lines in the plan, pricey "cheap tails",
// commentary inside triggers, option-only triggers that disagree with the option, natural hedges that contradict the plan,
// parking lots matched to the food-truck playbook, fuel ideas for businesses without vehicles.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  busyDaysFirst, cleanTrigger, offBusyDays, gameFits, guardSide, marketWordedTriggers, mergeSameMarketRisks, namedDays, prepaidLine, undominated, venueBound, weatherDayFits,
} from "../lib/ai/advisor";
import { contradictsPlan } from "../lib/ai/defaultPlan";
import { fallbackIdeas, ideasFromPlaybook, type TieredLeg } from "../lib/ai/ideas";
import { ownTeamsIn } from "../lib/ai/horizon";
import { matchIndustries, playbookIdeas } from "../lib/ai/playbook";
import { properNouns, rankCandidates, sportLeagues } from "../lib/markets/index";
import { crossedBook, setMeta } from "../lib/markets/normalize";
import type { BusinessProfile, HedgeLeg, MarketContract, Quote, QuoteLine, Risk } from "../lib/types";

const NOW = new Date("2026-11-20T15:00:00Z");
const mc = (o: Partial<MarketContract> & { id: string }): MarketContract => ({
  venue: o.id.split(":")[0] as MarketContract["venue"], symbol: o.id.split(":")[1], eventTicker: o.id.split(":")[1], eventTitle: "", label: "", peril: "rain",
  status: "open", yesAsk: 0.5, noAsk: 0.5, yesBid: 0.49, noBid: 0.49, expiry: "2026-12-31T00:00:00Z", tradable: true, ...o,
} as MarketContract);
const biz = (name: string, city: string, description: string, busyDays = ["Fri", "Sat"]): BusinessProfile => ({ id: "b", name, city, description, avgDailyRevenueUsd: 3000, busyDays, monthlyBudgetUsd: 300 } as BusinessProfile);
const risk = (o: Partial<Risk>): Risk => ({ id: "r1", peril: "rain", title: "t", trigger: "t", lossUsd: 1000, lossReasoning: "", confidence: 0.5, ...o } as Risk);
const leg = (contractId: string, side: "yes" | "no" = "yes", riskId = "r1"): HedgeLeg => ({ riskId, contractId, side, rationale: "r", basisRisk: "b" });

test("crossed / stale books are not prices", () => {
  assert.equal(crossedBook({ yesAsk: 0.03, yesBid: 0.56, noAsk: 0.44, noBid: 0.97 }), true); // the gold $4,100 artifact
  assert.equal(crossedBook({ yesAsk: 0.2, yesBid: 0.1, noAsk: 0.3, noBid: 0.75 }), true); // YES + NO asks far under $1
  assert.equal(crossedBook({ yesAsk: 0.43, yesBid: 0.41, noAsk: 0.59, noBid: 0.57 }), false);
  assert.equal(crossedBook({ yesAsk: null, yesBid: null, noAsk: 0.3, noBid: null }), false);
});

test("one-day weather contracts must fall on a day the risk names; month totals and in-window weekends pass", () => {
  const day = (id: string, d: string, end?: string) => { setMeta(id, { eventDate: d, ...(end ? { eventEnd: end } : {}) }); return mc({ id, eventTitle: id }); };
  const fri = day("kalshi:KXLOWTAUS-26NOV20-T46", "2026-11-20"), thx = day("kalshi:KXRAINTHANKSGIVING-26NOV26-NYC", "2026-11-26");
  const wknd = day("kalshi:KXRAINWKND-26NOV21-AUS", "2026-11-21", "2026-11-22"), month = day("kalshi:KXRAINAUSM-26NOV-5", "2026-11-01", "2026-11-30");
  const sat = risk({ peril: "cold", title: "Cold Saturday on the water", trigger: "Austin lowest temperature on Nov 21 at or below 44F", window: "Nov 21" });
  assert.equal(weatherDayFits(sat, fri, NOW), false);
  assert.equal(weatherDayFits(risk({ title: "Rain on the Wed Nov 25 pie market", trigger: "Rain in NYC on Nov 25", window: "Nov 25" }), thx, NOW), false);
  const late = risk({ title: "Wet weekends", trigger: "Rain in Austin", window: "Nov 19-30" });
  assert.equal(weatherDayFits(late, wknd, NOW), true);
  assert.equal(weatherDayFits(late, month, NOW), true);
  assert.equal(weatherDayFits(risk({ title: "Rainy weekend", trigger: "Rain this weekend", window: "this weekend" }), fri, NOW), true, "no date named: other guards");
  assert.equal(namedDays("Nov 19 - 30", NOW).length, 12);
});

test("a weekend-only business: the in-window weekend market goes before the month total", () => {
  setMeta("kalshi:KXRAINWKND-26NOV21-AUS", { eventDate: "2026-11-21", eventEnd: "2026-11-22" });
  setMeta("kalshi:KXRAINAUSM-26NOV-5", { eventDate: "2026-11-01", eventEnd: "2026-11-30" });
  const wknd = mc({ id: "kalshi:KXRAINWKND-26NOV21-AUS", eventTitle: "Where will it rain this weekend (Nov 21 - Nov 22)?", label: "Austin", yesAsk: 0.25 });
  const month = mc({ id: "kalshi:KXRAINAUSM-26NOV-5", eventTitle: "Rain in Austin in Nov 2026?", label: "Above 5 inches", yesAsk: 0.27 });
  const r = risk({ id: "r3", title: "Wet late-November weekends", trigger: "Rain in Austin", window: "Nov 19-30" });
  const legs: TieredLeg[] = [{ ...leg(month.id, "yes", "r3"), tier: "recommended" }, { ...leg(wknd.id, "yes", "r3"), tier: "other-date" }];
  const out = busyDaysFirst(r, legs, [wknd, month], ["Sat", "Sun"], NOW);
  assert.deepEqual(out.map((l) => `${l.contractId}:${l.tier}`), [`${wknd.id}:recommended`, `${month.id}:broad`]);
  assert.deepEqual(busyDaysFirst(r, legs, [wknd, month], ["Mon", "Tue", "Wed", "Thu", "Fri"], NOW), legs, "a weekday business keeps the month");
});

test("college teams: Kentucky basketball gets Kentucky's game, never NBA games; Pitt football never Pitt basketball", () => {
  assert.deepEqual(ownTeamsIn("College bar in Lexington. Kentucky basketball nights pack the place.").map((t) => t.nick), ["Wildcats"]);
  assert.deepEqual(ownTeamsIn("We stock Kentucky bourbon."), []);
  assert.deepEqual(ownTeamsIn("Pitt Panthers football Saturdays fill the lot.").map((t) => t.nick), ["Panthers"]);
  assert.deepEqual(sportLeagues("Pitt football Saturdays and Steelers Sundays"), ["NFL", "NCAAF"]);
  assert.equal(sportLeagues("football and basketball nights"), undefined);
  const g = (id: string, title: string, label: string, league: string, teams: string[], date = "2026-11-21") => {
    setMeta(id, { eventDate: date, league, teams });
    return mc({ id, peril: "game", eventTitle: title, label, location: "US", yesAsk: 0.42, noAsk: 0.59, yesBid: 0.41, noBid: 0.57, expiry: "2026-11-22T06:00:00Z" });
  };
  const U = [
    g("gemini:GEMI-NCAAM-2611210100-UK-IU-M-UK", "Kentucky vs Indiana", "Kentucky", "NCAAM", ["Kentucky"]),
    g("gemini:GEMI-NBA-2611210100-BOS-MIA-M-BOS", "Boston vs Miami", "Boston", "NBA", ["Boston"]),
    g("gemini:GEMI-NCAAM-2611210000-CMU-PITT-M-PITT", "Central Michigan vs Pittsburgh", "Pittsburgh", "NCAAM", ["Pittsburgh"]),
    g("kalshi:KXNCAAFGAME-26NOV28PITTCAL-PITT", "Pittsburgh vs California", "Pittsburgh", "NCAAF", ["Pittsburgh"], "2026-11-28"),
    g("kalshi:KXNFLGAME-26NOV22PITPHI-PHI", "Pittsburgh vs Philadelphia", "Philadelphia", "NFL", ["Philadelphia"], "2026-11-22"),
  ];
  const bar = biz("Big Blue Taphouse", "Lexington, KY", "College bar in Lexington. Kentucky basketball nights pack the place.");
  const uk = rankCandidates(risk({ peril: "game", title: "Kentucky loses a home game this week", trigger: "Kentucky loses its next game", location: "Lexington", window: "next 7 days" }), bar, U, 10, NOW);
  assert.deepEqual(uk.map((c) => c.id), ["gemini:GEMI-NCAAM-2611210100-UK-IU-M-UK"]);
  const lot = biz("North Shore Park", "Pittsburgh, PA", "Stadium parking. Pitt Panthers football Saturdays and Steelers Sundays fill the lot.");
  const pitt = rankCandidates(risk({ peril: "game", title: "Pitt loses its home finale", trigger: "Pitt loses", location: "Pittsburgh", window: "next 14 days" }), lot, U, 10, NOW);
  assert.deepEqual(pitt.map((c) => c.id), ["kalshi:KXNCAAFGAME-26NOV28PITTCAL-PITT"]);
  // no known team: a game must name one of the risk's own proper nouns
  assert.deepEqual(properNouns("Home team: Wolfpack lose on Saturday"), ["Wolfpack"]);
  const none = rankCandidates(risk({ peril: "game", title: "Wolfpack lose on Saturday", trigger: "Wolfpack lose", location: "Raleigh", window: "next 7 days" }), biz("Bar", "Raleigh, NC", "Bar near campus."), U, 10, NOW);
  assert.deepEqual(none, []);
});

test("stadium-adjacent retail needs a home game; a bar showing games on TV does not", () => {
  const shop = biz("Titletown Fan Gear", "Green Bay, WI", "Packers fan-gear shop a block from Lambeau Field. Home games bring out-of-town fans.");
  assert.equal(venueBound(shop.description), true);
  assert.equal(venueBound("Sports bar with 20 TVs; Packers home games and road games both fill it."), false);
  setMeta("kalshi:KXNFLGAME-26NOV25GBLAR-LAR", { eventDate: "2026-11-25", league: "NFL", teams: ["Los Angeles R"] });
  setMeta("gemini:GEMI-NFL-2611260100-GB-LAR-M-LAR", { eventDate: "2026-11-25", league: "NFL", teams: ["Los Angeles R"] });
  const r = risk({ peril: "game", title: "Packers lose this week", trigger: "Packers lose", window: "next 7 days" });
  assert.equal(gameFits(r, mc({ id: "kalshi:KXNFLGAME-26NOV25GBLAR-LAR", eventTicker: "KXNFLGAME-26NOV25GBLAR", peril: "game", eventTitle: "Green Bay vs Los Angeles R", label: "Los Angeles R" }), shop, NOW), false);
  assert.equal(gameFits(r, mc({ id: "gemini:GEMI-NFL-2611260100-GB-LAR-M-LAR", peril: "game", eventTitle: "Green Bay vs Los Angeles R", label: "Los Angeles R" }), shop, NOW), false);
});

test("same ladder = same market: a proxy on another strike of the risk's event merges into it", () => {
  const a = mc({ id: "kalshi:KXRAINAUSM-26NOV-5", eventTicker: "KXRAINAUSM-26NOV", label: "Above 5 inches", yesAsk: 0.27 });
  const b = mc({ id: "kalshi:KXRAINAUSM-26NOV-6", eventTicker: "KXRAINAUSM-26NOV", label: "Above 6 inches", yesAsk: 0.13 });
  const r3 = risk({ id: "r3", title: "Wet November", trigger: "Austin rain above 5 inches in November", window: "November", horizon: "month" });
  const r5 = risk({ id: "r5", kind: "proxy", title: "Proxy: a very wet month", trigger: "Austin rain above 6 inches in November", window: "November", horizon: "month", lossUsd: 400 });
  const choices = new Map<string, TieredLeg[]>([["r3", [{ ...leg(a.id, "yes", "r3"), tier: "recommended" }]], ["r5", [{ ...leg(b.id, "yes", "r5"), tier: "recommended" }]]]);
  assert.deepEqual([...mergeSameMarketRisks([r3, r5], choices, new Map([[a.id, a], [b.id, b]]))], ["r5"]);
});

test("bounded snow-day buckets never cover a heavy-tail trigger, with or without a direction word", () => {
  const dtw = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-DTW", peril: "snow", eventTitle: "Cumulative Snow Days in Cities", label: "Detroit · 7–19 days", yesAsk: 0.28, noAsk: 0.72 });
  const cle = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-CLE", peril: "snow", eventTitle: "Cumulative Snow Days in Cities", label: "Cleveland · 6–25 days", yesAsk: 0.4, noAsk: 0.61 });
  assert.equal(guardSide(risk({ peril: "snow", title: "Snow-day count in Detroit this winter", trigger: "high bucket (for example 20+ days)" }), leg(dtw.id), dtw), null);
  assert.equal(guardSide(risk({ peril: "snow", title: "Snowy winter", trigger: "6 or more snow days in Cleveland" }), leg(cle.id), cle), null);
  // a bucket starting at zero is still fine for "too little snow"
  const zero = mc({ id: "kalshi:KXSNOWDAYS-X-ATL", peril: "snow", label: "Atlanta · 0–4 days", yesAsk: 0.3, noAsk: 0.7 });
  assert.ok(guardSide(risk({ peril: "snow", title: "Snowless winter", trigger: "Fewer snow days than normal" }), leg(zero.id), zero));
});

test("season / month lines above 50c stay out of the plan; event lines keep the 60c rule", () => {
  assert.equal(prepaidLine({ horizon: "season" }, { impliedProb: 0.57, pricePerContract: 0.57 }), true);
  assert.equal(prepaidLine({ horizon: "season" }, { impliedProb: 0.48, pricePerContract: 0.49 }), false);
  assert.equal(prepaidLine({}, { impliedProb: 0.57, pricePerContract: 0.57 }), false);
  assert.equal(prepaidLine({}, { impliedProb: 0.6, pricePerContract: 0.6 }), true);
  // a single game lost at 59c is expected, not a tail
  assert.equal(prepaidLine({ peril: "game" }, { impliedProb: 0.59, pricePerContract: 0.59 }), true);
  assert.equal(prepaidLine({ peril: "game" }, { impliedProb: 0.42, pricePerContract: 0.43 }), false);
});

test("a broader strike within 2c replaces the pick (it pays far more often for about the same money)", () => {
  const s = (v: number, a: number) => mc({ id: `kalshi:KXNYCSNOWM-26DEC-${v}`, eventTicker: "KXNYCSNOWM-26DEC", peril: "snow", label: `Above ${v} inches`, yesAsk: a, noAsk: 1 - a + 0.01 });
  const cands = [s(2, 0.62), s(4, 0.3), s(8, 0.28), s(12, 0.18)];
  assert.equal(undominated(leg("kalshi:KXNYCSNOWM-26DEC-8"), cands).contractId, "kalshi:KXNYCSNOWM-26DEC-4");
  assert.equal(undominated(leg("kalshi:KXNYCSNOWM-26DEC-12"), cands).contractId, "kalshi:KXNYCSNOWM-26DEC-12", "10c dearer is not the same money");
});

test("triggers carry no forecasts, odds or prices", () => {
  assert.equal(cleanTrigger("Minneapolis high at or above 40F on Mon Nov 23 (forecast 36F, so unlikely; no live market for that date)"), "Minneapolis high at or above 40F on Mon Nov 23");
  assert.equal(cleanTrigger("Measurable rain in Orlando this weekend (Flood Watch, 44% chance of showers)"), "Measurable rain in Orlando this weekend");
  assert.equal(cleanTrigger("Diesel above $6.20 at year end (YES ~28c)"), "Diesel above $6.20 at year end");
  assert.equal(cleanTrigger("Rain in Austin this weekend (Nov 21-22)"), "Rain in Austin this weekend (Nov 21-22)");
  assert.equal(cleanTrigger("Government shutdown in effect on Dec 12 (priced about 28 cents)"), "Government shutdown in effect on Dec 12");
});

test("an option-only macro risk takes its option's wording (no near-certain trigger next to a different strike)", () => {
  const c = mc({ id: "kalshi:KXCPIYOY-26NOV-T3.7", peril: "cpi", eventTitle: "CPI year-over-year in Nov 2026?", label: "Above 3.7%", yesAsk: 0.13 });
  const r = risk({ id: "r5", peril: "cpi", title: "Food inflation squeezes wing costs", trigger: "November CPI YoY above 3.2%" });
  const choice = { riskId: "r5", contractId: c.id, contract: c, side: "yes", contracts: 10, premiumUsd: 1.3, payoutUsd: 10, impliedProb: 0.13, pricePerContract: 0.13, rationale: "", basisRisk: "" } as unknown as QuoteLine;
  marketWordedTriggers([r], [], [{ riskId: "r5", choices: [choice] }]);
  assert.equal(r.trigger, "CPI year-over-year in Nov 2026: Above 3.7%");
});

test("a natural-hedge note that contradicts a line the plan buys is dropped; unrelated notes stay", () => {
  const pistons = risk({ id: "r5", peril: "game", title: "Pistons miss the playoffs", trigger: "Detroit Pistons miss the NBA playoffs", horizon: "season" });
  const line = { riskId: "r5", contracts: 500, action: "buy" } as unknown as QuoteLine;
  const q = { risks: [pistons], lines: [line] } as unknown as Pick<Quote, "lines" | "risks">;
  assert.equal(contradictsPlan({ peril: "game", title: "Pistons playoff odds", explanation: "Pistons priced at 0.94 to make the playoffs; insuring a miss is costly - watch.", advice: "watch" }, q), true);
  assert.equal(contradictsPlan({ peril: "game", title: "Pistons wins already pay you", explanation: "Wins fill the hotel.", advice: "dont-hedge" }, q), false);
  assert.equal(contradictsPlan({ peril: "game", title: "Lions road games", explanation: "Lions away games don't matter - watch.", advice: "watch" }, q), false);
});

test("a parking lot is not a food truck; a hotel gets no 'delivery mile' fuel idea", () => {
  const lot = biz("North Shore Park & Tailgate", "Pittsburgh, PA", "Stadium parking lots on the North Shore with walk-up parking and tailgate spots. Pitt football Saturdays fill the lot.");
  assert.ok(!matchIndustries(lot).some((m) => m.industry.id === "food-truck"));
  const rainWknd = mc({ id: "kalshi:KXRAINWKND-26NOV21-PIT", eventTitle: "Where will it rain this weekend (Nov 21 - Nov 22)?", label: "Pittsburgh", location: "Pittsburgh", yesAsk: 0.23, noAsk: 0.79, expiry: "2026-11-23T06:00:00Z" });
  assert.ok(!playbookIdeas(lot, [rainWknd], { now: NOW }).some((p) => p.entry.id === "truck-rain-day"));
  assert.ok(matchIndustries(biz("Birria Truck", "Austin, TX", "Taco truck with a walk-up window, no indoor seating.")).some((m) => m.industry.id === "food-truck"));
  // the playbook's delivery-app note only for a business that delivers
  const bar = biz("Patio Pub", "Austin, TX", "Bar with a big patio and beer garden.");
  assert.ok(!ideasFromPlaybook([{ idea: { industry: "bar-restaurant", title: "Rain empties the patio", peril: "rain", naturalHedgeNote: "Delivery-heavy kitchens get some of it back as delivery orders on rainy days." }, candidates: [] }], bar).naturalHedges.length);
  assert.equal(ideasFromPlaybook([{ idea: { industry: "bar-restaurant", title: "Rain empties the patio", peril: "rain", naturalHedgeNote: "Delivery-heavy kitchens get some of it back." }, candidates: [] }], biz("Pizza", "Austin, TX", "Pizza kitchen, 60% delivery.")).naturalHedges.length, 1);
  const hotel = biz("Woodward Arena Hotel", "Detroit, MI", "Hotel by Little Caesars Arena. Fans drive in from out of town for game nights.");
  assert.ok(!fallbackIdeas(hotel).ideas.some((i) => i.risk.title === "Fuel price spike"));
  assert.ok(fallbackIdeas(biz("Fleet", "Austin, TX", "12 delivery vans.")).ideas.some((i) => i.risk.title === "Fuel price spike"));
});

test("advise: wrong-day weather contracts leave the risk uncovered with a dated reason; the current month never says 'not listed yet'", async () => {
  const { advise } = await import("../lib/ai/advisor");
  setMeta("kalshi:KXLOWTAUS-26NOV20-T46", { eventDate: "2026-11-20" });
  const fri = mc({ id: "kalshi:KXLOWTAUS-26NOV20-T46", peril: "cold", eventTitle: "Lowest temperature in Austin on Nov 20, 2026?", label: "45° or below", yesAsk: 0.16, noAsk: 0.86, location: "Austin" });
  const dec = mc({ id: "kalshi:KXRAINSFOM-26DEC-3", eventTitle: "Rain in San Francisco in Dec 2026?", label: "Above 3 inches", yesAsk: 0.3, noAsk: 0.71, location: "San Francisco" });
  const llm = (async (o: { system: string; schema: { parse: (x: unknown) => unknown } }) => {
    const which = o.system.includes("creative hedging strategist") ? "b" : o.system.includes("risk analyst") ? "r" : o.system.includes("pick prediction-market") ? "m" : "s";
    const out = which === "r" ? { risks: [
      { peril: "cold", title: "Cold Saturday on the water", trigger: "Austin lowest temperature on Nov 21 at or below 44F", location: "Austin", window: "Nov 21", lossUsd: 800, lossReasoning: "two slow days x $400", confidence: 0.5 },
      { peril: "rain", title: "Rain idles the trucks", trigger: "Rain in Fresno in November", location: "Fresno", window: "November", lossUsd: 900, lossReasoning: "two slow days x $450", confidence: 0.5 },
      { peril: "heat", title: "Hot Sunday on the dock", trigger: "Austin high above 90F on Sun Nov 22", location: "Austin", window: "Nov 22", lossUsd: 300, lossReasoning: "one slow day x $300", confidence: 0.3 },
    ] } : which === "b" ? { ideas: [], naturalHedges: [] } : which === "m" ? { matches: [] } : { summary: "a summary of the quote" };
    return { data: o.schema.parse(out), model: `fake/${which}` };
  }) as never;
  const b = biz("Paddle", "Austin, TX", "Kayak rentals on the lake, weekends; trucks haul boats.", ["Sat", "Sun"]);
  const q = await advise(b, { deps: { llm, findCandidates: async (r) => (r.peril === "cold" ? [fri] : r.peril === "rain" ? [dec] : []), sizeQuote: async () => ({ lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0 }), listMarkets: async () => [], now: () => NOW } });
  const why = (t: RegExp) => q.uncovered.find((u) => t.test(q.risks.find((r) => r.id === u.riskId)?.title ?? ""))?.reason ?? "";
  assert.match(why(/Cold Saturday/), /No live market for cold on Sat, Nov 21/);
  assert.doesNotMatch(why(/Rain idles/), /listed yet/);
});

test("a dated weather risk is judged by its date, not a weekday word in its title", () => {
  const r = { peril: "cold", title: "Cold Saturday kills rentals", trigger: "Austin low at or below 45°F on Tue Nov 24", window: "Nov 24" };
  assert.equal(offBusyDays(r, ["Sat", "Sun"], "2026-11-20"), true);
  assert.equal(offBusyDays({ ...r, trigger: "Austin low at or below 45°F on Sat Nov 21", window: "Nov 21" }, ["Sat", "Sun"], "2026-11-20"), false);
  assert.equal(offBusyDays({ peril: "rain", title: "Rainy Saturday", trigger: "Rain on Saturday", window: "this week" }, ["Sat", "Sun"], "2026-11-20"), false);
});
