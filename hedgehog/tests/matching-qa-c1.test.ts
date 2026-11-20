// Regressions from matching QA cycle 1 (12 businesses outside Austin, Nov 20 2026): wrong-day venue routing, Texas-only
// teams, hard-coded Austin ideas, dust lines, prepaid "insurance", off-season hurricanes, wrong-side flips, duplicates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findEquivalent } from "../lib/markets/compare";
import { routeToBest, sizeQuote } from "../lib/markets/quote";
import { contractMeta, setMeta, staleSameDay } from "../lib/markets/normalize";
import { offSeasonHurricane, rankCandidates } from "../lib/markets/index";
import { futuresFallbackRisks, futuresSide, ownTeamsIn } from "../lib/ai/horizon";
import { fallbackIdeas, buildPackages } from "../lib/ai/ideas";
import { dedupeRisks, guardSide, insuranceFirst } from "../lib/ai/advisor";
import { rescaleQuote } from "../lib/client/quote";
import type { BusinessProfile, HedgeLeg, MarketContract, Quote, QuoteLine, Risk } from "../lib/types";

const mc = (o: Partial<MarketContract> & { id: string }): MarketContract => ({
  venue: o.id.split(":")[0] as MarketContract["venue"], symbol: o.id.split(":")[1], eventTicker: o.id.split(":")[1], eventTitle: "", label: "", peril: "rain",
  status: "open", yesAsk: 0.5, noAsk: 0.5, yesBid: 0.49, noBid: 0.49, expiry: "2026-12-01T00:00:00Z", tradable: true, ...o,
} as MarketContract);
const biz = (city: string, description: string): BusinessProfile => ({ id: "b", name: "Biz", city, description, avgDailyRevenueUsd: 3000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 300 } as BusinessProfile);
const risk = (o: Partial<Risk>): Risk => ({ id: "r1", peril: "rain", title: "t", trigger: "t", lossUsd: 1000, lossReasoning: "", confidence: 0.5, ...o } as Risk);

// ---------- 1. venue routing: a one-day market is never "the same" as a weekend ----------
const WKND = mc({ id: "kalshi:KXRAINWKND-26NOV21-MIA", eventTitle: "Where will it rain this weekend (Nov 21 - Nov 22)?", label: "Miami", location: "Miami", yesAsk: 0.76, noAsk: 0.25, expiry: "2026-11-23T05:00:00Z" });
setMeta(WKND.id, { eventDate: "2026-11-21", eventEnd: "2026-11-22" });
// no meta on purpose (a Next bundle that never normalized it): the title's own day must win over the Nov 21 expiry
const POLY_DAY = mc({ id: "polymarket:where-will-it-rain-on-november-20-2026-miami-fl", eventTitle: "Where will it rain on November 20?", label: "Miami: Rain", location: "Miami", yesAsk: 0.1, noAsk: 0.9, expiry: "2026-11-21T19:00:00Z", tradable: false });
const POLY_SAT = mc({ id: "polymarket:where-will-it-rain-on-november-21-2026-miami-fl", eventTitle: "Where will it rain on November 21?", label: "Miami: Rain", location: "Miami", yesAsk: 0.5, noAsk: 0.5, expiry: "2026-11-22T19:00:00Z", tradable: false });
setMeta(POLY_SAT.id, { eventDate: "2026-11-21", eventEnd: "2026-11-21" });

test("findEquivalent: a weekend rain market never matches a one-day market (with or without meta)", () => {
  assert.equal(findEquivalent(WKND, "yes", [POLY_DAY]), null);
  assert.equal(findEquivalent(WKND, "yes", [POLY_SAT]), null, "Saturday alone is not Sat+Sun");
});

test("routeToBest: keeps the weekend leg; a 'same' contract 25+ points cheaper is a different event", () => {
  const leg: HedgeLeg = { riskId: "r1", contractId: WKND.id, side: "yes", rationale: "Nov 21-22 weekend", basisRisk: "" };
  const contracts = new Map([WKND, POLY_DAY, POLY_SAT].map((c) => [c.id, c]));
  assert.equal(routeToBest([leg], contracts)[0].contractId, WKND.id);
});

test("contract meta is process-wide (globalThis), so every Next bundle sees the same event dates", () => {
  assert.ok((globalThis as { __hhMetaMap?: Map<string, unknown> }).__hhMetaMap?.has(WKND.id));
  assert.equal(contractMeta(WKND.id)?.eventEnd, "2026-11-22");
});

// ---------- 2. teams outside Texas ----------
test("ownTeamsIn: every league's teams; everyday words only next to their city or a sports word", () => {
  assert.deepEqual(ownTeamsIn("Sports bar by TD Garden; Celtics and Bruins nights").map((t) => t.nick), ["Celtics", "Bruins"]);
  assert.deepEqual(ownTeamsIn("Lot by Arrowhead, Chiefs home games").map((t) => t.nick), ["Chiefs"]);
  assert.deepEqual(ownTeamsIn("Ohio State football Saturdays").map((t) => t.nick), ["Buckeyes"]);
  assert.deepEqual(ownTeamsIn("Hotel by Ball Arena: Nuggets and Avalanche games").map((t) => t.nick), ["Nuggets", "Avalanche"]);
  assert.deepEqual(ownTeamsIn("Summer heat empties the patio; utility bills; avalanche risk on the pass"), []);
  assert.deepEqual(ownTeamsIn("Miami Heat games fill the bar").map((t) => t.nick), ["Heat"]);
});

test("futuresSide / ranking: a Boston pub's Celtics playoff qualifiers are found and NO pays on a miss", () => {
  const BOS = mc({ id: "kalshi:KXNBAPLAYOFF-27-BOS", peril: "game", eventTitle: "Pro Basketball Playoff Qualifiers", label: "Boston", yesAsk: 0.97, noAsk: 0.04, expiry: "2027-04-20T00:00:00Z" });
  setMeta(BOS.id, { eventDate: "2026-10-20", eventEnd: "2027-04-17", futureKind: "playoffs", league: "NBA", teams: ["Boston"] });
  const BOS_NHL = mc({ id: "kalshi:KXNHLPLAYOFF-27-BOS", peril: "game", eventTitle: "NHL Playoff Qualifiers", label: "Boston Bruins", yesAsk: 0.67, noAsk: 0.37, expiry: "2027-04-20T00:00:00Z" });
  setMeta(BOS_NHL.id, { eventDate: "2026-10-06", eventEnd: "2027-04-15", futureKind: "playoffs", league: "NHL", teams: ["Boston Bruins"] });
  const p = biz("Boston, MA", "Sports bar by TD Garden; Celtics and Bruins game nights are our biggest nights.");
  const r = risk({ peril: "game", title: "Celtics miss the playoffs", trigger: "Celtics fail to make the NBA playoffs", window: "through the end of the 2026-27 NBA regular season", horizon: "season", location: "Boston" });
  const top = rankCandidates(r, p, [BOS, BOS_NHL], 5, new Date("2026-11-20T15:00:00Z"));
  assert.equal(top[0]?.id, BOS.id);
  assert.ok(!top.some((c) => c.id === BOS_NHL.id), "Bruins (NHL) are not the Celtics");
  assert.equal(futuresSide(r, contractMeta(BOS.id), ownTeamsIn(r.title)), "no");
  assert.deepEqual(futuresFallbackRisks(p, [BOS, BOS_NHL]).map((x) => x.title), ["Celtics miss the playoffs", "Bruins miss the playoffs"]);
  assert.equal(futuresFallbackRisks(biz("Kansas City, MO", "Parking lot by Arrowhead; Chiefs home games fill it"), []).length, 1, "parking lots are a crowd business");
});

// ---------- 3. fallback ideas use the owner's city ----------
test("fallback cold idea: the profile's city, never Austin; none for ski shops", () => {
  const miami = fallbackIdeas(biz("Miami, FL", "Boat and jet ski rentals at the marina, outdoor dock")).ideas.find((i) => i.risk.peril === "cold");
  assert.equal(miami?.risk.location, "Miami");
  assert.match(miami!.hint!, /Miami/);
  assert.ok(!/Austin/.test(`${miami!.risk.trigger} ${miami!.risk.causalStory}`));
  assert.equal(fallbackIdeas(biz("Denver, CO", "Ski and bike rental shop, outdoor trail tours")).ideas.find((i) => i.risk.peril === "cold"), undefined);
});

// ---------- 4. stale same-day weather, off-season hurricanes ----------
test("staleSameDay: today's one-day weather market after 10 am Central is not a hedge", () => {
  const today = mc({ id: "gemini:GEMI-WXHIGH-BOS-2611210459-LO61", peril: "cold", expiry: "2026-11-21T04:59:00Z" });
  setMeta(today.id, { eventDate: "2026-11-20" });
  assert.equal(staleSameDay(today, new Date("2026-11-20T20:00:00Z")), true);
  assert.equal(staleSameDay(today, new Date("2026-11-20T13:00:00Z")), false, "7 am Central: still forecastable");
  assert.equal(staleSameDay(WKND, new Date("2026-11-21T20:00:00Z")), false, "a weekend market is not one day");
});

test("offSeasonHurricane: a landfall market observed only after mid-November is not insurance", () => {
  const fl = mc({ id: "kalshi:KXHURRLANDFL4-31DEC26-YES", peril: "storm", eventTitle: "Florida Cat 4+ hurricane landfall by Dec 31, 2026?", label: "Category 4 or higher landfall", expiry: "2027-01-01T04:59:00Z" });
  assert.equal(offSeasonHurricane(fl, new Date("2026-11-20T15:00:00Z")), true);
  assert.equal(offSeasonHurricane(fl, new Date("2026-10-15T15:00:00Z")), false);
  assert.equal(offSeasonHurricane(mc({ id: "kalshi:X", peril: "storm", eventTitle: "Tornadoes in 2026", expiry: "2027-01-01T00:00:00Z" }), new Date("2026-11-20T15:00:00Z")), false);
});

// ---------- 5. side guard: "fails to reach" is a downside trigger ----------
test("guardSide: 'S&P fails to reach 8,000' keeps NO on '8,400 or above' (no flip to a rally bet)", () => {
  const spx = mc({ id: "gemini:GEMI-SPXHIGH26-SPXGE8400", peril: "other", eventTitle: "S&P 500 high in 2026", label: "8,400 or above", yesAsk: 0.12, noAsk: 0.89 });
  const leg: HedgeLeg = { riskId: "r5", contractId: spx.id, side: "no", rationale: "", basisRisk: "" };
  const r = risk({ peril: "other", title: "Stock slump dents event budgets", trigger: "S&P 500 fails to reach 8,000 by year end" });
  assert.equal(guardSide(r, leg, spx)?.side, "no");
  assert.equal(guardSide(risk({ peril: "other", title: "x", trigger: "S&P 500 by year end" }), leg, spx)?.side, "no", "no direction word: matcher's side stands");
  assert.equal(guardSide(risk({ peril: "other", title: "x", trigger: "S&P 500 rallies above 8,400" }), leg, spx)?.side, "yes");
});

// ---------- 6. insurance pricing ----------
test("insuranceFirst: a 0.84 pick yields to a 3-60c choice; nothing under 0.75 -> uncovered", () => {
  const pricey = mc({ id: "kalshi:PRICEY", yesAsk: 0.84, noAsk: 0.17 }), tail = mc({ id: "kalshi:TAIL", yesAsk: 0.3, noAsk: 0.71 });
  const L = (id: string, tier: string) => ({ riskId: "r1", contractId: id, side: "yes" as const, rationale: "", basisRisk: "", tier });
  const out = insuranceFirst([L(pricey.id, "recommended"), L(tail.id, "cheap-tail")], [pricey, tail]);
  assert.deepEqual(out.map((l) => `${l.contractId}:${l.tier}`), ["kalshi:TAIL:recommended"], "0.84 is dropped (> 0.75), the tail is recommended");
  assert.deepEqual(insuranceFirst([L(pricey.id, "recommended")], [pricey]), []);
  const mid = mc({ id: "kalshi:MID", yesAsk: 0.68, noAsk: 0.33 });
  assert.deepEqual(insuranceFirst([L(mid.id, "recommended"), L(tail.id, "cheap-tail")], [mid, tail]).map((l) => `${l.contractId}:${l.tier}`), ["kalshi:TAIL:recommended", "kalshi:MID:broad"]);
});

// ---------- 7. one risk per exposure ----------
test("dedupeRisks: same team+stage, same month peril, same trigger words merge; different days/stages stay", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const rs = [
    risk({ id: "a", peril: "game", title: "Celtics miss the playoffs entirely", trigger: "Celtics fail to make the NBA playoffs", window: "through the 2026-27 NBA regular season", horizon: "season" }),
    risk({ id: "b", peril: "game", title: "Celtics miss the playoffs", trigger: "Boston Celtics miss the playoffs", window: "through April 2027", horizon: "season" }),
    risk({ id: "c", peril: "game", title: "Celtics deep run ends early", trigger: "Celtics fail to reach the Eastern Conference finals", window: "through the 2026-27 NBA playoffs", horizon: "season" }),
    risk({ id: "d", peril: "snow", title: "Thin December snowfall", trigger: "Denver December snowfall at or below 8 inches", window: "December", horizon: "month" }),
    risk({ id: "e", peril: "snow", title: "Severe December snow shortfall", trigger: "Denver snowfall does not exceed 10 inches", window: "December", horizon: "month" }),
    risk({ id: "f", peril: "rain", title: "Rain on the weekend", trigger: "Rain in Miami this weekend (Nov 21-22)", window: "next 7 days", location: "Miami" }),
    risk({ id: "g", peril: "rain", title: "Rain on Thanksgiving Day", trigger: "Rain in Miami on Thanksgiving (Nov 26)", window: "next 7 days", location: "Miami" }),
  ];
  assert.deepEqual(dedupeRisks(rs, now).map((r) => r.id), ["a", "c", "d", "f", "g"]);
});

// ---------- 8. dust lines + packages = funded legs ----------
test("sizeQuote: a budget-scaled line paying under $25 is dropped, not shown as a $1 line", async () => {
  // A ($59) and B ($40) fit; $1 is left: C would be 2 contracts ($2 payout) -> dropped as over budget
  const A = mc({ id: "kalshi:A", yesAsk: 0.5, noAsk: 0.51 }), B = mc({ id: "kalshi:B", yesAsk: 0.5, noAsk: 0.51 }), C = mc({ id: "kalshi:C", yesAsk: 0.4, noAsk: 0.61 });
  const risks = [risk({ id: "r1", lossUsd: 118 }), risk({ id: "r3", lossUsd: 80 }), risk({ id: "r2", lossUsd: 200, kind: "proxy" } as Partial<Risk>)];
  const L = (riskId: string, c: MarketContract): HedgeLeg => ({ riskId, contractId: c.id, side: "yes", rationale: "", basisRisk: "" });
  const q = await sizeQuote({ legs: [L("r1", A), L("r3", B), L("r2", C)], risks, contracts: new Map([A, B, C].map((c) => [c.id, c])), coveragePct: 100, budgetUsd: 100, fetchBooks: false, crossCheck: false, route: false });
  assert.deepEqual(q.lines.map((l) => l.contractId), [A.id, B.id]);
  assert.match(q.uncovered.find((u) => u.riskId === "r2")?.reason ?? "", /over budget/);
});

test("rescaleQuote + buildPackages: 60% cap then leftover; unfunded (under $25) legs are not package picks", () => {
  const c1 = mc({ id: "kalshi:A", yesAsk: 0.2 }), c2 = mc({ id: "kalshi:B", yesAsk: 0.5 }), c3 = mc({ id: "kalshi:C", yesAsk: 0.5 });
  const line = (riskId: string, c: MarketContract, n: number): QuoteLine => ({ riskId, contractId: c.id, side: "yes", rationale: "", basisRisk: "", contract: c, coveragePct: 100, contracts: n, pricePerContract: c.yesAsk!, premiumUsd: n * c.yesAsk!, payoutUsd: n, impliedProb: c.yesAsk!, action: "buy-onchain" } as QuoteLine);
  const risks = [risk({ id: "r1", lossUsd: 100 }), risk({ id: "r2", lossUsd: 400 }), risk({ id: "r3", lossUsd: 50 })];
  const q = { businessId: "b", createdAt: "", risks, lines: [line("r1", c1, 100), line("r2", c2, 400), line("r3", c3, 50)], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0, budgetUsd: 25, summary: "", model: "",
    options: [{ riskId: "r1", choices: [line("r1", c1, 100)] }, { riskId: "r2", choices: [line("r2", c2, 400)] }, { riskId: "r3", choices: [line("r3", c3, 50)] }] } as unknown as Quote;
  // loss-weighted order B, A, C. 25%: B capped at $15 (30), A $5 (25), C $5 -> 10 < 13 wanted: none; pass 2: B takes the rest (40)
  assert.deepEqual(rescaleQuote(q, 25).lines.map((l) => l.contracts), [25, 40, 0]);
  // QA #7: more coverage never pays less on a line (the budget was already spent at 25%)
  assert.deepEqual(rescaleQuote(q, 100).lines.map((l) => l.contracts), [25, 40, 0]);
  for (const p of buildPackages(q, 100)) assert.deepEqual(p.picks.map((x) => x.contractId), [c1.id, c2.id], p.name);
});

test("sizeQuote: one line takes at most 60% of the budget while another direct risk waits", async () => {
  const a = mc({ id: "kalshi:SNOWDAYS", yesAsk: 0.25, noAsk: 0.76 }), b = mc({ id: "kalshi:BRUINS", yesAsk: 0.64, noAsk: 0.37 });
  const risks = [risk({ id: "r1", lossUsd: 2000 }), risk({ id: "r2", lossUsd: 200 })];
  const legs: HedgeLeg[] = [{ riskId: "r1", contractId: a.id, side: "yes", rationale: "", basisRisk: "" }, { riskId: "r2", contractId: b.id, side: "no", rationale: "", basisRisk: "" }];
  const q = await sizeQuote({ legs, risks, contracts: new Map([[a.id, a], [b.id, b]]), coveragePct: 100, budgetUsd: 300, fetchBooks: false, crossCheck: false, route: false });
  assert.deepEqual(q.lines.map((l) => [l.contractId, l.contracts]), [[a.id, 904], [b.id, 200]], "Bruins fully funded ($74), snow days get the rest ($226)");
  assert.ok(q.totalPremiumUsd <= 300 + 1e-9);
});
