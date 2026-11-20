// Regressions from matching QA cycle 3 (Nov 20 2026): "contractor" read as a tractor / metal buyer (diesel + copper hedges
// for roofers and a parcel fleet), Alabama fans saying "Bama", the third team the owner names, depth-capped dust lines,
// book walks far above the quoted ask, a 60c sole pick, the same market twice (same contract or the other venue's twin),
// bounded snow-day buckets as heavy-snow cover, weather risks on non-busy days / holidays, thin "cheaper" strikes, fuel
// "through December" with only November prints listed, prompt echoes left in uncovered triggers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groundedRisk, guardSide, insuranceFirst, marketWordedTriggers, mergeSameMarketRisks, offBusyDays, pickPlanChoice } from "../lib/ai/advisor";
import { fallbackIdeas, ladderChoices, type TieredLeg } from "../lib/ai/ideas";
import { futuresFallbackRisks, ownTeamsIn, ownTeamsInCity, stageWanted } from "../lib/ai/horizon";
import { rankCandidates } from "../lib/markets/index";
import { sizeQuote } from "../lib/markets/quote";
import { setMeta } from "../lib/markets/normalize";
import type { BusinessProfile, HedgeLeg, MarketContract, QuoteLine, Risk } from "../lib/types";

const mc = (o: Partial<MarketContract> & { id: string }): MarketContract => ({
  venue: o.id.split(":")[0] as MarketContract["venue"], symbol: o.id.split(":")[1], eventTicker: o.id.split(":")[1], eventTitle: "", label: "", peril: "rain",
  status: "open", yesAsk: 0.5, noAsk: 0.5, yesBid: 0.49, noBid: 0.49, expiry: "2026-12-31T00:00:00Z", tradable: true, ...o,
} as MarketContract);
const biz = (name: string, city: string, description: string, busyDays = ["Fri", "Sat"]): BusinessProfile => ({ id: "b", name, city, description, avgDailyRevenueUsd: 3000, busyDays, monthlyBudgetUsd: 300 } as BusinessProfile);
const risk = (o: Partial<Risk>): Risk => ({ id: "r1", peril: "rain", title: "t", trigger: "t", lossUsd: 1000, lossReasoning: "", confidence: 0.5, ...o } as Risk);
const leg = (contractId: string, side: "yes" | "no" = "yes", riskId = "r1"): HedgeLeg => ({ riskId, contractId, side, rationale: "r", basisRisk: "b" });

test("grounding: 'contractor' is not a tractor or a metal buyer; real hooks still count", () => {
  const roofer = biz("Peachtree Peak Roofing", "Atlanta, GA", "Residential roofing contractor, asphalt shingles, 2 crews. Wet months idle the crews.");
  assert.equal(groundedRisk("gas", roofer), false);
  assert.equal(groundedRisk("metals", roofer), false);
  assert.ok(!fallbackIdeas(roofer).ideas.some((i) => i.risk.peril === "metals"), "no copper idea for a shingle roofer");
  const fleet = biz("Inland Empire Last Mile", "Riverside, CA", "Last-mile parcel delivery contractor, 12 gasoline vans on flat-rate routes.");
  assert.equal(groundedRisk("gas", fleet), true);
  assert.equal(groundedRisk("metals", fleet), false);
  assert.ok(!fallbackIdeas(fleet).ideas.some((i) => i.risk.peril === "metals"), "no copper idea for a parcel fleet");
  assert.equal(groundedRisk("gas", biz("Farm", "Ames, IA", "Two tractors and a combine.")), true);
  assert.equal(groundedRisk("metals", biz("Saguaro Comfort Air", "Phoenix, AZ", "HVAC installs; copper line-sets are our biggest material cost.")), true);
  assert.ok(fallbackIdeas(biz("Volt Electric", "Austin, TX", "Electrician buying copper wire.")).ideas.some((i) => i.risk.peril === "metals"));
});

test("teams: 'Bama' / 'Alabama home football' are the Crimson Tide; 'miss the College Football Playoff' is the playoffs stage", () => {
  assert.deepEqual(ownTeamsIn("College bar. Alabama home football Saturdays are our year.").map((t) => t.nick), ["Crimson Tide"]);
  assert.deepEqual(ownTeamsIn("If Bama misses the playoff we lose January.").map((t) => t.nick), ["Crimson Tide"]);
  assert.deepEqual(ownTeamsIn("We sell Alabama-shaped cookies."), []);
  assert.equal(stageWanted("Crimson Tide miss the College Football Playoff")[0], "playoffs");
});

test("season fallback: the teams the owner ties to a loss come first; bare 'Lions' counts in a Detroit sports sentence", () => {
  const futs: [string, string, string, number][] = [
    ["kalshi:KXNBAPLAYOFF-27-DET", "Detroit", "NBA", 0.07], ["kalshi:KXNHLPLAYOFF-27-DET", "Detroit", "NHL", 0.8], ["kalshi:KXNFLPLAYOFF-27-DET", "Detroit", "NFL", 0.2],
  ];
  const markets = futs.map(([id, team, league, no]) => {
    setMeta(id, { eventDate: "2026-09-01", eventEnd: "2027-04-15", futureKind: "playoffs", league, teams: [team] });
    return mc({ id, peril: "game", eventTitle: `${league} playoff qualifiers`, label: team, yesAsk: 1 - no, noAsk: no });
  });
  const hotel = biz("Woodward Arena Hotel", "Detroit, MI", "Hotel by Little Caesars Arena and Ford Field. Red Wings and Pistons game nights fill us. If the Pistons or Lions miss the playoffs our winter and January bookings collapse.");
  assert.deepEqual(ownTeamsInCity(hotel.description, hotel.city).map((t) => t.nick), ["Red Wings", "Pistons", "Lions"]);
  assert.deepEqual(futuresFallbackRisks(hotel, markets).map((r) => r.title), ["Pistons miss the playoffs", "Lions miss the playoffs"]);
  // a bare "Lions" in another city is not Detroit's team
  assert.deepEqual(ownTeamsInCity("Lions club meets here on game nights.", "Austin, TX"), []);
});

test("sizeQuote: a depth-capped line paying crumbs is dropped, and the walk stays near the quoted ask", async () => {
  const snow = mc({ id: "kalshi:SNOW-4", yesAsk: 0.2, depthYes: 19 });
  const r = risk({ id: "r1", lossUsd: 3600 });
  const q = await sizeQuote({ legs: [leg(snow.id)], risks: [r], contracts: new Map([[snow.id, snow]]), coveragePct: 50, budgetUsd: 450, fetchBooks: false, crossCheck: false, route: false });
  assert.equal(q.lines.length, 0);
  assert.match(q.uncovered[0].reason, /Only 19 contracts/);
  // 4c top of book with deep levels at 9-12c: the walk stops near the quoted price, not at 4c + 10c
  const tail = mc({ id: "kalshi:PLAYOFF-BOS", peril: "game", noAsk: 0.04, yesAsk: 0.97 });
  const books = new Map([[tail.id, { yes: [], no: [{ price: 0.04, size: 200 }, { price: 0.06, size: 300 }, { price: 0.09, size: 2000 }, { price: 0.12, size: 5000 }] }]]);
  const q2 = await sizeQuote({ legs: [leg(tail.id, "no")], risks: [risk({ id: "r1", peril: "game", lossUsd: 6000 })], contracts: new Map([[tail.id, tail]]), coveragePct: 50, budgetUsd: 1000, books: books as never, fetchBooks: false, crossCheck: false, route: false });
  assert.equal(q2.lines[0].contracts, 500);
  assert.ok(q2.lines[0].pricePerContract <= 0.06, `avg ${q2.lines[0].pricePerContract}`);
});

test("insuranceFirst: a sole pick at exactly 60c is not a hedge", () => {
  const gb = mc({ id: "kalshi:KXNFLPLAYOFF-27-GB", peril: "game", noAsk: 0.6, yesAsk: 0.41 });
  assert.deepEqual(insuranceFirst([{ ...leg(gb.id, "no"), tier: "recommended" }], [gb]), []);
});

test("mergeSameMarketRisks: the same contract, or its twin on another venue, is one risk; the stage-matching wording survives", () => {
  const k = mc({ id: "kalshi:KXNFLPLAYOFF-27-KC", peril: "game", eventTitle: "Pro Football Playoff Qualifiers", label: "Kansas City", noAsk: 0.03 });
  const g = mc({ id: "gemini:GEMI-NFLPLAYOFF26-27-KC", peril: "game", eventTitle: "Pro Football Playoff Qualifiers", label: "Kansas City", noAsk: 0.05 });
  for (const c of [k, g]) setMeta(c.id, { eventDate: "2026-09-09", eventEnd: "2027-01-10", futureKind: "playoffs", league: "NFL", teams: ["Kansas City"] });
  const rs = [
    risk({ id: "r1", peril: "game", title: "Chiefs don't host a home playoff game", trigger: "Chiefs miss the playoffs", lossUsd: 20000, horizon: "season" }),
    risk({ id: "r2", peril: "rain", title: "Rain on Thanksgiving", trigger: "Rain in NYC on Thanksgiving", lossUsd: 4000 }),
    risk({ id: "r3", peril: "rain", title: "Rain empties the patio", trigger: "Where will it rain on Thanksgiving: New York City", lossUsd: 2100, kind: "proxy" }),
    risk({ id: "r4", peril: "game", title: "Chiefs miss the playoffs", trigger: "Kansas City fail to make the NFL playoffs", lossUsd: 12800, horizon: "season" }),
  ];
  const rain = mc({ id: "kalshi:KXRAINTHANKSGIVING-26NOV26-NYC", eventTitle: "Where will it rain on Thanksgiving?", label: "New York City", yesAsk: 0.82 });
  const T = (riskId: string, c: MarketContract, side: "yes" | "no"): TieredLeg[] => [{ ...leg(c.id, side, riskId), tier: "recommended" }];
  const choices = new Map([["r1", T("r1", g, "no")], ["r2", T("r2", rain, "yes")], ["r3", T("r3", rain, "yes")], ["r4", T("r4", k, "no")]]);
  const gone = mergeSameMarketRisks(rs, choices, new Map([k, g, rain].map((c) => [c.id, c])));
  assert.deepEqual([...gone].sort(), ["r1", "r3"]);
  assert.deepEqual([...choices.keys()].sort(), ["r2", "r4"]);
});

test("guardSide: a bounded snow-day bucket is not cover for 'the heaviest winter'", () => {
  const c = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-DTW", peril: "snow", label: "7-19 days", yesAsk: 0.3 });
  const r = risk({ peril: "snow", title: "Heavy snow winter", trigger: "Detroit snow days in the top bracket" });
  assert.equal(guardSide(r, leg(c.id), c), null);
  const low = mc({ id: "kalshi:KXSNOWDAYS-ATL-0", peril: "snow", label: "0-4 days", yesAsk: 0.3 });
  assert.ok(guardSide(risk({ peril: "snow", title: "Snowless winter", trigger: "Snow days stay low this winter" }), leg(low.id), low));
});

test("offBusyDays: weather risks on non-busy days and holidays for weekday crews are dropped", () => {
  const today = "2026-11-20";
  const bar = ["Thu", "Fri", "Sat"];
  assert.equal(offBusyDays({ peril: "cold", title: "Cold night before Thanksgiving", trigger: "high <= 47F on Wed Nov 25", window: "Nov 25" }, bar, today), true);
  assert.equal(offBusyDays({ peril: "rain", title: "Rainy Saturday", trigger: "Rain in New Orleans this weekend (Nov 21-22)", window: "Nov 21-22" }, bar, today), false);
  assert.equal(offBusyDays({ peril: "rain", title: "Rain on Thanksgiving", trigger: "Rain on Thanksgiving Day", window: "Nov 26" }, bar, today), false);
  assert.equal(offBusyDays({ peril: "snow", title: "Snow on Thanksgiving-week weekend run-up", trigger: "Detroit measurable snow on Wed Nov 25", window: "Nov 25" }, ["Fri", "Sat"], today), true);
  const crew = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  assert.equal(offBusyDays({ peril: "rain", title: "Thanksgiving week washout", trigger: "Rain in Atlanta on Thanksgiving", window: "Nov 24-26" }, crew, today), true);
  assert.equal(offBusyDays({ peril: "rain", title: "Wet week", trigger: "Rain in Atlanta Tue Nov 24", window: "Nov 24" }, crew, today), false);
  assert.equal(offBusyDays({ peril: "rain", title: "Soaked month", trigger: "Atlanta November rain above 4 inches", window: "November", horizon: "month" }, crew, today), false);
});

test("ladderChoices: a cheaper strike with a sliver of depth is not offered as the cheap tail", () => {
  const ev = "KXBOSSNOWM-26DEC";
  const six = mc({ id: "kalshi:KXBOSSNOWM-26DEC-6", eventTicker: ev, peril: "snow", label: "Above 6 inches", yesAsk: 0.36, depthYes: 400 });
  const ten = mc({ id: "kalshi:KXBOSSNOWM-26DEC-10", eventTicker: ev, peril: "snow", label: "Above 10 inches", yesAsk: 0.2, depthYes: 0.21 });
  const out = ladderChoices({ ...leg(six.id), tier: "recommended" }, [six, ten], [{ ...leg(six.id), tier: "recommended" }]);
  assert.ok(!out.some((l) => l.contractId === ten.id));
  const deep = { ...ten, depthYes: 300 };
  assert.ok(ladderChoices({ ...leg(six.id), tier: "recommended" }, [six, deep], [{ ...leg(six.id), tier: "recommended" }]).some((l) => l.contractId === ten.id && l.tier === "cheap-tail"));
});

test("rankCandidates: fuel 'through December' with only a November print listed still finds it", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const nov = mc({ id: "kalshi:KXAAAGASM-26NOV30-3.55", peril: "gas", eventTitle: "Gas prices in the US in Nov 2026?", label: "Above 3.55", yesAsk: 0.2, noAsk: 0.81, location: "US", expiry: "2026-11-30T04:59:00Z" });
  setMeta(nov.id, { eventDate: "2026-11-01", eventEnd: "2026-11-30" });
  const r = risk({ peril: "gas", title: "Pump prices jump", trigger: "US gas above $3.55 through December", location: "US", window: "through December", horizon: "month" });
  assert.deepEqual(rankCandidates(r, biz("Fleet", "Riverside, CA", "12 gasoline vans"), [nov], 5, now).map((c) => c.id), [nov.id]);
});

test("marketWordedTriggers: an uncovered risk loses the echoed '(the lowest rung shown)' aside", () => {
  const r = risk({ peril: "rain", trigger: "Minneapolis November rain above 2 inches (the lowest rung shown)" });
  marketWordedTriggers([r], []);
  assert.equal(r.trigger, "Minneapolis November rain above 2 inches");
});

test("pickPlanChoice: a depth-capped rung yields to a deeper one; a coin-flip pick yields to a funded cheap tail", () => {
  const L = (id: string, contracts: number, p: number, tier: string, maxCoverable?: number): QuoteLine => ({ ...leg(`kalshi:${id}`), contract: mc({ id: `kalshi:${id}` }), coveragePct: 50,
    contracts, pricePerContract: p, premiumUsd: contracts * p, payoutUsd: contracts, impliedProb: p, action: "buy-onchain", tier, ...(maxCoverable !== undefined ? { maxCoverable } : {}) } as QuoteLine);
  const all = () => true, none = () => false;
  // Lake Harriet: DEC-8 NO capped at 52 contracts, DEC-4 NO (26c) sizes 7,500
  const capped = L("DEC-8", 52, 0.3, "Balanced", 52), tail = L("DEC-4", 7500, 0.26, "Cheap tail");
  assert.equal(pickPlanChoice([capped, tail], all, none, 7500)?.contractId, tail.contractId);
  // Echo Park: 52c monthly rain vs an 8c tail on the same event
  const pricey = L("NOV-2", 120, 0.52, "Balanced"), cheap = L("NOV-3", 120, 0.08, "Cheap tail");
  assert.equal(pickPlanChoice([pricey, cheap], all, none, 120)?.contractId, cheap.contractId);
  // an uncapped insurance-priced pick stays
  const fine = L("X", 500, 0.2, "Balanced");
  assert.equal(pickPlanChoice([fine, L("Y", 500, 0.1, "Cheap tail")], all, none, 500)?.contractId, fine.contractId);
});

test("advise: an ungrounded fuel idea about the owner's own trucks is dropped; a supplier surcharge story stays", async () => {
  const { advise } = await import("../lib/ai/advisor");
  const diesel = mc({ id: "kalshi:KXDIESELMON-26NOV30-T5.80", peril: "gas", eventTitle: "Diesel prices in Nov 2026?", label: "Above $5.80", yesAsk: 0.15, noAsk: 0.86, location: "US" });
  const brent = mc({ id: "gemini:BRENT30-93", peril: "oil", eventTitle: "Brent Nov 30", label: "Above $93", yesAsk: 0.2, noAsk: 0.81, location: "US" });
  const llm = (async (o: { system: string; schema: { parse: (x: unknown) => unknown } }) => {
    const which = o.system.includes("creative hedging strategist") ? "b" : o.system.includes("risk analyst") ? "r" : o.system.includes("pick prediction-market") ? "m" : "s";
    const out = which === "r" ? { risks: [{ peril: "rain", title: "Wet November idles crews", trigger: "Atlanta rain above 4 inches in November", location: "Atlanta", window: "November", lossUsd: 6000, lossReasoning: "2 idle crew days x $3,000 = $6,000", confidence: 0.5 }] }
      : which === "b" ? { ideas: [
        { catalogKey: "", peril: "gas", title: "Diesel spike hitting truck and dump costs", trigger: "Diesel above $5.80", location: "US", window: "Nov 30", lossUsd: 600, lossReasoning: "1,000 gal x $0.60 = $600", causalStory: "Crews burn diesel.", correlation: "medium", worthIt: "Cheap tail cover.", confidence: 0.4 },
        { catalogKey: "", peril: "oil", title: "Brent lifts supplier delivery surcharges", trigger: "Brent above $93", location: "US", window: "Nov 30", lossUsd: 300, lossReasoning: "1,000 gal x $0.60 = $600", causalStory: "Shingle suppliers add fuel surcharges that track Brent.", correlation: "medium", worthIt: "Cheap tail cover.", confidence: 0.4 },
      ], naturalHedges: [] } : which === "m" ? { matches: [] } : { summary: "s" };
    return { data: o.schema.parse(out), model: `fake/${which}` };
  }) as never;
  const roofer = biz("Peachtree Peak Roofing", "Atlanta, GA", "Residential roofing contractor, asphalt shingles, 2 crews.", ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const q = await advise(roofer, { deps: { llm, findCandidates: async (r) => (r.peril === "gas" ? [diesel] : r.peril === "oil" ? [brent] : []), sizeQuote: async () => ({ lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0 }), listMarkets: async () => [], now: () => new Date("2026-11-20T15:00:00Z") } });
  assert.ok(!q.risks.some((r) => /truck and dump/.test(r.title)));
  assert.ok(q.risks.some((r) => /supplier delivery surcharges/.test(r.title)), JSON.stringify(q.risks.map((r) => r.title)));
  assert.ok(!q.risks.some((r) => r.peril === "metals"));
});
