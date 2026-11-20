// Regressions from matching QA cycle 5 (Nov 20 2026): a compound snow trigger flipped to the NO side, an open-topped snow-day
// bucket called "no market pays", a slowdown hedged with hot CPI, a Fri-Sun range risk on the Thanksgiving-Thursday market,
// packages holding lines the plan rejected as coin flips, "pipe" matching "pipeline", delivery notes for businesses whose
// customers order delivery elsewhere, notes that say "don't buy rain cover" next to a rain line, internal "analyst" wording,
// diesel ideas for gasoline vehicles, opponents from another sport in a game trigger, snowy-winter risks in snowless cities.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gameTrigger, guardSide, marketWordedTriggers, openTopBucket, ownFuel, snowlessCity, upThreshold, weatherDayFits } from "../lib/ai/advisor";
import { citesMissingCover, contradictsLoss, contradictsPlan, saysDont } from "../lib/ai/defaultPlan";
import { BRAINSTORM_SYSTEM, buildPackages, ideasFromPlaybook, onDemandDelivery } from "../lib/ai/ideas";
import { matchIndustries, playbookIdeas } from "../lib/ai/playbook";
import { setMeta } from "../lib/markets/normalize";
import type { BusinessProfile, HedgeLeg, MarketContract, NaturalHedge, Quote, QuoteLine, Risk } from "../lib/types";

const NOW = new Date("2026-11-20T15:00:00Z");
const mc = (o: Partial<MarketContract> & { id: string }): MarketContract => ({
  venue: o.id.split(":")[0] as MarketContract["venue"], symbol: o.id.split(":")[1], eventTicker: o.id.split(":")[1], eventTitle: "", label: "", peril: "rain",
  status: "open", yesAsk: 0.5, noAsk: 0.5, yesBid: 0.49, noBid: 0.49, expiry: "2026-12-31T00:00:00Z", tradable: true, ...o,
} as MarketContract);
const biz = (name: string, city: string, description: string, busyDays = ["Fri", "Sat"]): BusinessProfile => ({ id: "b", name, city, description, avgDailyRevenueUsd: 3000, busyDays, monthlyBudgetUsd: 300 } as BusinessProfile);
const risk = (o: Partial<Risk>): Risk => ({ id: "r1", peril: "rain", title: "t", trigger: "t", lossUsd: 1000, lossReasoning: "", confidence: 0.5, ...o } as Risk);
const leg = (contractId: string, side: "yes" | "no" = "yes", riskId = "r1"): HedgeLeg => ({ riskId, contractId, side, rationale: "r", basisRisk: "b" });

test("compound snow trigger: the snow clause sets the side, a cold clause does not flip it to NO", () => {
  const c = mc({ id: "kalshi:KXNYCSNOWM-26DEC-4", eventTicker: "KXNYCSNOWM-26DEC", peril: "snow", label: "Above 4 inches", yesAsk: 0.3, noAsk: 0.71 });
  const r = risk({ peril: "snow", title: "Snowy December empties Union Square", trigger: "NYC December snowfall of at least 3 inches or several days below 30F" });
  assert.equal(guardSide(r, leg(c.id, "yes"), c)?.side, "yes");
  // the matcher's wrong NO is corrected the same way
  assert.equal(guardSide(r, leg(c.id, "no"), c)?.side, "yes");
  // a plain "snow stays below 2 inches" risk still takes the down side
  assert.equal(guardSide(risk({ peril: "snow", title: "Snowless December", trigger: "NYC December snowfall stays below 4 inches" }), leg(c.id, "yes"), c)?.side, "no");
});

test("open-topped snow-day bucket: lower edge = trigger, cheap, top far beyond it -> kept; a pricey bucket is not", () => {
  const ind = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-IND", peril: "snow", eventTitle: "Cumulative Snow Days in Cities (Dec 1, 2026–Apr 1, 2027)", label: "Indianapolis · 10–33 days", yesAsk: 0.228, noAsk: 0.773 });
  const r = risk({ peril: "snow", title: "Snowy winter keeps guests away", trigger: "Indianapolis cumulative snow days Dec 1-Apr 1 at 10 or more" });
  assert.equal(upThreshold(r.trigger), 10);
  assert.ok(openTopBucket(r, ind));
  assert.equal(guardSide(r, leg(ind.id), ind)?.side, "yes");
  const cle = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-CLE", peril: "snow", label: "Cleveland · 6–25 days", yesAsk: 0.4, noAsk: 0.61 });
  assert.equal(guardSide(risk({ peril: "snow", title: "Snowy winter", trigger: "6 or more snow days in Cleveland" }), leg(cle.id), cle), null);
});

test("a slowdown risk is never hedged with hot inflation", () => {
  const cpi = mc({ id: "kalshi:KXCPIYOY-26NOV-T3.7", eventTicker: "KXCPIYOY-26NOV", eventTitle: "CPI year-over-year in November", peril: "cpi", label: "Above 3.7%", yesAsk: 0.39 });
  assert.equal(guardSide(risk({ peril: "cpi", title: "Economic slowdown cuts restaurant wholesale orders", trigger: "Inflation above 3.7% in November" }), leg(cpi.id), cpi), null);
  assert.equal(guardSide(risk({ peril: "cpi", title: "Hot food inflation", trigger: "CPI above 3.7% in November" }), leg(cpi.id), cpi)?.side, "yes");
});

test("a dated range counts only on the business's busy days in it", () => {
  setMeta("kalshi:KXRAINTHANKSGIVING-26NOV26-SFO", { eventDate: "2026-11-26" });
  setMeta("kalshi:KXRAINWKND-26NOV28-SFO", { eventDate: "2026-11-28", eventEnd: "2026-11-29" });
  const thx = mc({ id: "kalshi:KXRAINTHANKSGIVING-26NOV26-SFO" }), wk = mc({ id: "kalshi:KXRAINWKND-26NOV28-SFO" });
  const r = risk({ title: "Rainy holiday weekend", trigger: "Rain in San Francisco over Thanksgiving weekend", window: "Nov 26-29" });
  assert.equal(weatherDayFits(r, thx, NOW, ["Fri", "Sat", "Sun"]), false);
  assert.equal(weatherDayFits(r, wk, NOW, ["Fri", "Sat", "Sun"]), true);
  assert.equal(weatherDayFits(r, thx, NOW), true, "no busy days given: the named range stands");
});

test("packages never hold a line the plan excludes", () => {
  const ln = (riskId: string, id: string, p: number, tier: string): QuoteLine => ({
    riskId, contractId: id, side: "no", contracts: 10, pricePerContract: p, impliedProb: p, premiumUsd: 10 * p, payoutUsd: 10, rationale: "", basisRisk: "", tier,
    contract: mc({ id, peril: "game", noAsk: p, label: "40+ wins", eventTitle: "Pacers total wins" }),
  } as unknown as QuoteLine);
  const q = {
    risks: [risk({ id: "r1", peril: "game", title: "Pacers miss", lossUsd: 2000, horizon: "season" })],
    lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0, budgetUsd: 600,
    options: [{ riskId: "r1", choices: [ln("r1", "kalshi:KXNBAWINS-27IND-40", 0.6, "Balanced"), ln("r1", "kalshi:KXNBAWINS-27IND-30", 0.16, "Cheap tail")] }],
  } as unknown as Quote;
  const pk = buildPackages(q, 50, (x) => x.impliedProb > 0.5);
  assert.ok(pk.length > 0);
  for (const p of pk) assert.ok(p.picks.every((x) => x.contractId !== "kalshi:KXNBAWINS-27IND-40"), p.name);
});

test("playbook keywords: short ones are whole words; a customer ordering delivery is not a delivery business", () => {
  const broker = biz("Gateway Home Mortgage", "St. Louis, MO", "Mortgage broker; my pipeline of closings dries up when rates stay above 6.5%.");
  assert.ok(!matchIndustries(broker).some((m) => m.industry.id === "hvac-plumbing"));
  assert.ok(!playbookIdeas(broker, []).some((x) => /copper/i.test(x.idea.title ?? "")));
  const truck = biz("Wacker Drive Dumpling Truck", "Chicago, IL", "Food truck on Wacker Drive, weekday lunch. On bitter or rainy days office workers order delivery instead. We buy propane and gas for the generator and the truck.", ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  assert.ok(!matchIndustries(truck).some((m) => m.industry.id === "delivery"));
  assert.equal(onDemandDelivery(truck.description), false);
  assert.equal(onDemandDelivery("Propane and heating oil distributor. We deliver propane to 900 homes."), false);
  assert.equal(onDemandDelivery("Pizza kitchen, 60% delivery."), true);
  assert.equal(onDemandDelivery("Courier service with 6 drivers downtown."), true);
  // a natural-hedge note gets its own title, never the idea's
  const nh = ideasFromPlaybook([{ idea: { title: "Diesel spike via Brent crude", peril: "oil", naturalHedgeNote: "Rainy days raise delivery demand: don't buy rain cover." }, candidates: [] }], biz("Pizza", "Austin, TX", "Pizza kitchen, 60% delivery.")).naturalHedges;
  assert.equal(nh[0]?.title, "Rainy days raise delivery demand");
});

test("natural hedges: 'don't buy rain cover' text is don't-hedge advice, and it may not cite cover the plan lacks", () => {
  const n: NaturalHedge = { peril: "oil", title: "Rainy days raise delivery demand", explanation: "Rainy days raise delivery demand: don't buy rain cover.", advice: "watch" };
  assert.equal(saysDont(n), "dont-hedge");
  const rain = risk({ id: "r1", peril: "rain", title: "Rainy lunch", trigger: "Rain in Chicago on Tue Nov 24" });
  assert.ok(contradictsLoss(saysDont(n), `${n.title} ${n.explanation}`, [rain]));
  const q = { risks: [rain], lines: [{ riskId: "r1", contracts: 10, action: "buy" } as unknown as QuoteLine] };
  assert.ok(contradictsPlan(n, q));
  assert.ok(citesMissingCover({ peril: "game", title: "Rainy game days", explanation: "The playbook rain cover already protects the downside.", advice: "watch" }, { risks: [], lines: [] }));
  assert.ok(citesMissingCover({ peril: "cold", title: "Warm winter", explanation: "What your weather analyst already covers.", advice: "watch" }, { risks: [], lines: [] }));
  assert.ok(!citesMissingCover({ peril: "cold", title: "Cold helps soup", explanation: "Cold days sell more soup: don't hedge cold.", advice: "dont-hedge" }, { risks: [], lines: [] }));
  assert.doesNotMatch(BRAINSTORM_SYSTEM, /another analyst/);
});

test("fuel ideas follow the owner's fuel: diesel lines are dropped for a gasoline business", () => {
  const diesel = mc({ id: "kalshi:KXDIESELYE-26DEC31-T5.80", eventTitle: "US diesel price at year end", peril: "gas" });
  const brent = mc({ id: "gemini:GEMI-BRENT2611302200-HI93", eventTitle: "Brent crude", peril: "oil" });
  const desc = "BBQ restaurant with 3 catering vans that burn about 400 gallons of gas a month.";
  assert.deepEqual(ownFuel([diesel, brent], desc, true).map((c) => c.id), [brent.id]);
  assert.deepEqual(ownFuel([diesel], desc, true), []);
  assert.deepEqual(ownFuel([diesel], desc).map((c) => c.id), [diesel.id], "non-strict keeps the only market");
  assert.equal(ownFuel([diesel], "Two diesel box trucks.", true).length, 1);
});

test("a game trigger naming another sport's opponent is rewritten to the contract's own matchup", () => {
  setMeta("kalshi:KXNCAAFGAME-26NOV21LSUTENN-LSU", { eventDate: "2026-11-21" });
  const c = mc({ id: "kalshi:KXNCAAFGAME-26NOV21LSUTENN-LSU", peril: "game", eventTitle: "LSU vs Tennessee", label: "LSU", yesAsk: 0.51 });
  const r = risk({ peril: "game", title: "Tennessee loses to Coastal Carolina on Sat Nov 21", trigger: "Tennessee loses to Coastal Carolina on Sat Nov 21", window: "Nov 21" });
  assert.equal(gameTrigger(r, c, "yes"), "Tennessee lose to LSU on Sat, Nov 21");
  marketWordedTriggers([r], [], [{ riskId: "r1", choices: [{ riskId: "r1", contractId: c.id, side: "yes", contract: c, contracts: 10 } as unknown as QuoteLine] }]);
  assert.doesNotMatch(`${r.title} ${r.trigger}`, /Coastal/);
  // a matching trigger is left alone
  const ok = risk({ peril: "game", title: "Vols lose to LSU", trigger: "Tennessee loses to LSU on Sat Nov 21" });
  assert.equal(gameTrigger(ok, c, "yes"), null);
});

test("a snowy-winter risk in a city whose snow-day market is a 0-2 day bucket is not an exposure", () => {
  const hou = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-HOU", peril: "snow", eventTitle: "Cumulative Snow Days in Cities (Dec 1, 2026–Apr 1, 2027)", label: "Houston · 0–2 days", yesAsk: 0.19 });
  const ind = mc({ id: "kalshi:KXSNOWDAYS-01DEC26-01APR27-IND", peril: "snow", eventTitle: "Cumulative Snow Days in Cities (Dec 1, 2026–Apr 1, 2027)", label: "Indianapolis · 10–33 days", yesAsk: 0.23 });
  const r = risk({ peril: "snow", title: "Winter freeze-day season cover", trigger: "3 or more snow days this winter", horizon: "season" });
  assert.ok(snowlessCity(r, [hou]));
  assert.ok(!snowlessCity(r, [ind]));
  assert.ok(!snowlessCity(risk({ peril: "snow", title: "Snowless winter", trigger: "Fewer snow days than normal" }), [hou]));
});
