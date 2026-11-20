// Regressions from matching QA cycle 2 (re-tests + new businesses, Nov 19-20 2026): playbook keyword leaks (copper for a
// rooftop bar / roofer, jeweler ideas for "Silver State"), warm-night side flip, dominated ladder rungs, prepaid sole picks,
// school vs mascot duplicates, fuel/rate families, venue text in basis risk, stale dates, ERCOT outside Texas, owner
// temperature thresholds, away games for a stadium lot, loss-weighted budget order, "Eagles" = NFL, metro station cities.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchIndustries, playbookIdeas } from "../lib/ai/playbook/index";
import { dedupeRisks, futuresTrigger, gameFits, guardSide, insuranceFirst, ownerBasis, ownTempThreshold, pastDated, regionOk, sameExposureX, sameFamily, undominated } from "../lib/ai/advisor";
import { normLoc, rankCandidates } from "../lib/markets/index";
import { sizeQuote } from "../lib/markets/quote";
import { setMeta } from "../lib/markets/normalize";
import type { BusinessProfile, HedgeLeg, MarketContract, Risk } from "../lib/types";

const mc = (o: Partial<MarketContract> & { id: string }): MarketContract => ({
  venue: o.id.split(":")[0] as MarketContract["venue"], symbol: o.id.split(":")[1], eventTicker: o.id.split(":")[1], eventTitle: "", label: "", peril: "rain",
  status: "open", yesAsk: 0.5, noAsk: 0.5, yesBid: 0.49, noBid: 0.49, expiry: "2026-12-31T00:00:00Z", tradable: true, ...o,
} as MarketContract);
const biz = (name: string, city: string, description: string): BusinessProfile => ({ id: "b", name, city, description, avgDailyRevenueUsd: 3000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 300 } as BusinessProfile);
const risk = (o: Partial<Risk>): Risk => ({ id: "r1", peril: "rain", title: "t", trigger: "t", lossUsd: 1000, lossReasoning: "", confidence: 0.5, ...o } as Risk);
const leg = (contractId: string, side: "yes" | "no" = "yes"): HedgeLeg => ({ riskId: "r1", contractId, side, rationale: "r", basisRisk: "b" });

// ---------- 1. playbook keywords ----------
const MARKETS: MarketContract[] = JSON.parse(readFileSync(new URL("./fixtures/playbook-markets.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-19T09:00:00Z");

test("playbook: 'rooftop' / 'close the roof' is not roofing; a roofer gets no electrician copper idea", () => {
  const bar = biz("Skyline Rooftop Bar", "Brooklyn, NY", "Rooftop cocktail bar; when it gets below 40F we close the roof deck and lose the night.");
  assert.ok(!matchIndustries(bar).some((m) => m.industry.id === "construction"));
  assert.ok(!playbookIdeas(bar, MARKETS, { now: NOW }).some((s) => s.idea.id === "electrician-copper"));
  const roofer = biz("Trinity Ridge Roofing", "Dallas, TX", "Residential roofing, 3 crews. Rain stops tear-offs; asphalt shingles and diesel for the trucks.");
  assert.ok(matchIndustries(roofer).some((m) => m.industry.id === "construction"));
  assert.ok(!playbookIdeas(roofer, MARKETS, { now: NOW }).some((s) => s.idea.id === "electrician-copper"), "copper needs electric/wire/copper/bid in the owner's words");
  const sparky = biz("Volt Electric", "Austin, TX", "Electrician: fixed-price bids, we buy copper wire 60 days later.");
  assert.ok(playbookIdeas(sparky, MARKETS, { now: NOW }).some((s) => s.idea.id === "electrician-copper"));
});

test("playbook: 'Silver State' in a car dealer's name is not a jeweler", () => {
  const dealer = biz("Silver State Pre-Owned", "Las Vegas, NV", "Used-car dealer; floor plan loan; high gas prices push buyers off trucks.");
  assert.ok(!matchIndustries(dealer).some((m) => m.industry.id === "jeweler"));
  assert.ok(matchIndustries(biz("Studio", "Austin, TX", "We cast gold rings and silver chains to order")).some((m) => m.industry.id === "jeweler"));
});

// ---------- 2. side guard ----------
test("guardSide: a warm-night risk filed as 'cold' keeps NO on '31°F or below'", () => {
  const low = mc({ id: "kalshi:KXLOWTMIN-26NOV21-T32", peril: "cold", eventTitle: "Lowest temperature in Minneapolis on Nov 21?", label: "31°F or below", yesAsk: 0.3, noAsk: 0.72 });
  const warm = risk({ peril: "cold", title: "Warm night cuts heating calls", trigger: "Minneapolis lowest temperature stays above 32°F" });
  assert.equal(guardSide(warm, leg(low.id, "no"), low)?.side, "no");
  const cold = risk({ peril: "cold", title: "Cold snap", trigger: "Minneapolis low at or below 31°F" });
  assert.equal(guardSide(cold, leg(low.id, "no"), low)?.side, "yes", "a real cold risk is still corrected to YES");
});

test("guardSide: a strike 10+ degrees milder than the owner's own threshold is dropped", () => {
  assert.equal(ownTempThreshold("a cold night under 45F thins the crowd", false), 45);
  const hi = mc({ id: "kalshi:KXHIGHTNOLA-26NOV21-T68", peril: "cold", eventTitle: "Highest temperature in New Orleans on Nov 21?", label: "67°F or below", yesAsk: 0.03, noAsk: 0.98 });
  const r = risk({ peril: "cold", title: "Cold front thins the crowd", trigger: "New Orleans high at or below the low end of this week's range" });
  assert.equal(guardSide(r, leg(hi.id), hi, "Open-air venue; a cold night under 45F thins the crowd"), null);
  const near = mc({ ...hi, id: "kalshi:KXHIGHTNOLA-26NOV21-T50", label: "49°F or below" });
  assert.equal(guardSide(r, leg(near.id), near, "Open-air venue; a cold night under 45F thins the crowd")?.side, "yes");
});

// ---------- 3. ladders and prices ----------
test("undominated: a higher snow strike priced above a lower one is swapped for the lower one", () => {
  const S = (n: number, a: number) => mc({ id: `kalshi:KXNYCSNOWM-26DEC-${n}`, eventTicker: "KXNYCSNOWM-26DEC", peril: "snow", eventTitle: "Snow in New York City in Dec 2026?", label: `Above ${n} inches`, yesAsk: a, noAsk: 1 - a + 0.02 });
  const cands = [S(2, 0.55), S(4, 0.3), S(6, 0.41), S(8, 0.28), S(10, 0.18)];
  assert.equal(undominated(leg("kalshi:KXNYCSNOWM-26DEC-6"), cands).contractId, "kalshi:KXNYCSNOWM-26DEC-4");
  assert.equal(undominated(leg("kalshi:KXNYCSNOWM-26DEC-10"), cands).contractId, "kalshi:KXNYCSNOWM-26DEC-10", "a cheaper extreme strike is a fair tail");
  // NO on "above X": the paid region grows with X
  const no = [S(4, 0.3), S(6, 0.41)].map((c, i) => ({ ...c, noAsk: [0.75, 0.6][i] }));
  assert.equal(undominated(leg("kalshi:KXNYCSNOWM-26DEC-4", "no"), no).contractId, "kalshi:KXNYCSNOWM-26DEC-6");
});

test("insuranceFirst: a sole 60-75c pick is 'already likely', not a plan line", () => {
  const g = mc({ id: "kalshi:KXNCAAFGAME-26NOV21UCLAMICH-MICH", peril: "game", yesAsk: 0.4, noAsk: 0.62 });
  assert.deepEqual(insuranceFirst([{ ...leg(g.id, "no"), tier: "recommended" }], [g]), []);
});

// ---------- 4. one exposure ----------
test("sameExposureX / dedupeRisks: school name and mascot are one team", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const a = risk({ id: "r1", peril: "game", title: "Michigan misses the CFP", trigger: "Michigan fails to make the College Football Playoff", window: "through the College Football Playoff (2026-27)", horizon: "season" });
  const b = risk({ id: "r2", peril: "game", title: "Wolverines miss the CFP", trigger: "Wolverines fail to make the College Football Playoff", window: "through the College Football Playoff (2026-27)", horizon: "season" });
  assert.ok(sameExposureX(a, b));
  assert.equal(dedupeRisks([a, b], now).length, 1);
});

test("sameFamily: diesel / pump gas / Brent are one fuel bill; Fed / CPI one rate path; weather is not a family", () => {
  assert.ok(sameFamily(risk({ peril: "gas" }), risk({ peril: "oil" })));
  assert.ok(sameFamily(risk({ peril: "fed" }), risk({ peril: "cpi" })));
  assert.ok(!sameFamily(risk({ peril: "rain" }), risk({ peril: "snow" })));
  assert.ok(!sameFamily(risk({ peril: "gas" }), risk({ peril: "fed" })));
});

// ---------- 5. owner-facing text ----------
test("ownerBasis: venue talk never reaches the owner's basis-risk line", () => {
  assert.equal(ownerBasis("Same pricey NO, and Gemini is our primary venue."), "Pays on the market's official data, which may not match your exact loss.");
  assert.equal(ownerBasis("Pays on missing the playoffs, not on home games. The Gemini contract is close in price, so this one is mostly a backup."), "Pays on missing the playoffs, not on home games.");
});

test("futuresTrigger: a two-word city gets the nickname ('Kansas City Chiefs don't host a playoff game')", () => {
  const c = mc({ id: "kalshi:KXNFLPLAYOFFHOST-26-KC", peril: "game", eventTitle: "Teams To Host A Playoff Game", label: "Kansas City" });
  setMeta(c.id, { eventDate: "2026-09-09", eventEnd: "2027-01-10", futureKind: "round", league: "NFL", teams: ["Kansas City"] });
  assert.equal(futuresTrigger(c, "no"), "Kansas City Chiefs don't host a playoff game");
});

// ---------- 6. dates and regions ----------
test("pastDated: an event risk dated only before today (or today after 5 pm) is dropped; month/season risks stay", () => {
  assert.ok(pastDated({ title: "Cold Thursday night", trigger: "NYC low below 40F", window: "Thu Nov 19" }, "2026-11-20"));
  assert.ok(!pastDated({ title: "Rain Saturday", trigger: "rain", window: "Sat Nov 21" }, "2026-11-20"));
  assert.ok(pastDated({ title: "Rain tonight", trigger: "rain", window: "Nov 19" }, "2026-11-19", true));
  assert.ok(!pastDated({ title: "Snowy December", trigger: "snow", window: "Dec 1", horizon: "month" }, "2026-12-05"));
});

test("regionOk: ERCOT triggers only for Texas businesses", () => {
  const r = { peril: "power", title: "Electricity cost spike", trigger: "ERCOT North Hub average price above $45/MWh" };
  assert.ok(!regionOk(r, biz("Desert Shine", "Phoenix, AZ", "car wash")));
  assert.ok(regionOk(r, biz("Wash", "Dallas, TX", "car wash")));
});

test("gameFits: the contract's game day must be the risk's; a stadium lot only hedges home games", () => {
  const now = new Date("2026-11-20T03:00:00Z");
  const kcbuf = mc({ id: "kalshi:KXNFLGAME-26NOV26KCBUF-KC", eventTicker: "KXNFLGAME-26NOV26KCBUF", peril: "game", eventTitle: "Kansas City vs Buffalo", label: "Kansas City" });
  setMeta(kcbuf.id, { eventDate: "2026-11-26", league: "NFL", teams: ["Kansas City"], opponents: ["Buffalo"] });
  const arikc = mc({ id: "kalshi:KXNFLGAME-26NOV22ARIKC-KC", eventTicker: "KXNFLGAME-26NOV22ARIKC", peril: "game", eventTitle: "Arizona vs Kansas City", label: "Kansas City" });
  setMeta(arikc.id, { eventDate: "2026-11-22", league: "NFL", teams: ["Kansas City"], opponents: ["Arizona"] });
  const lot = biz("Red Lot Parking & Tailgate", "Kansas City, MO", "Parking and tailgate lot by Arrowhead for Chiefs home games.");
  const bar = biz("KC Pub", "Kansas City, MO", "Sports bar; Chiefs games pack the room.");
  const r29 = risk({ peril: "game", title: "Chiefs lose Sun Nov 29", trigger: "Chiefs lose on Sun Nov 29", window: "Nov 29" });
  assert.ok(!gameFits(r29, kcbuf, bar, now), "Nov 26 game is not the Nov 29 risk");
  const next = risk({ peril: "game", title: "Chiefs lose their next game", trigger: "Chiefs lose", window: "next 7 days" });
  assert.ok(!gameFits(next, kcbuf, lot, now), "away game: the lot sells nothing");
  assert.ok(gameFits(next, kcbuf, bar, now), "a bar shows away games");
  assert.ok(gameFits(next, arikc, lot, now));
});

// ---------- 7. candidates ----------
test("rankCandidates: 'Eagles' alone means the NFL, not a Philadelphia NBA game", () => {
  const nfl = mc({ id: "kalshi:KXNFLGAME-26NOV22PITPHI-PHI", eventTicker: "KXNFLGAME-26NOV22PITPHI", peril: "game", eventTitle: "Pittsburgh vs Philadelphia", label: "Philadelphia", yesAsk: 0.34, noAsk: 0.67, expiry: "2026-11-23T05:00:00Z" });
  setMeta(nfl.id, { eventDate: "2026-11-22", league: "NFL", teams: ["Philadelphia"], opponents: ["Pittsburgh"] });
  const nba = mc({ id: "gemini:GEMI-NBA-2611211800-MIL-PHI-M-PHI", eventTicker: "GEMI-NBA-2611211800-MIL-PHI", peril: "game", eventTitle: "Milwaukee vs Philadelphia", label: "Philadelphia", yesAsk: 0.45, noAsk: 0.57, expiry: "2026-11-22T05:00:00Z" });
  setMeta(nba.id, { eventDate: "2026-11-21", league: "NBA", teams: ["Philadelphia", "Philadelphia 76ers"], opponents: ["Milwaukee"] });
  const p = biz("Broad Street Taproom", "Philadelphia, PA", "Sports bar. Eagles Sundays and Sixers nights pack the place.");
  const r = risk({ peril: "game", title: "Eagles lose Sun Nov 22", trigger: "Eagles lose their home game on Sun Nov 22", location: "Philadelphia", window: "Nov 22" });
  assert.deepEqual(rankCandidates(r, p, [nfl, nba], 10, new Date("2026-11-20T03:00:00Z")).map((c) => c.id), [nfl.id]);
});

test("normLoc: satellite cities settle on their station city (Ann Arbor -> Detroit, Brooklyn -> New York)", () => {
  assert.equal(normLoc("Ann Arbor, MI"), "detroit");
  assert.equal(normLoc("Brooklyn"), "new york");
});

// ---------- 8. budget order ----------
test("sizeQuote: over budget, the big core loss is funded before a small high-ratio line", async () => {
  const core = mc({ id: "kalshi:CORE", peril: "game", yesAsk: 0.6, noAsk: 0.3 });
  const side = mc({ id: "kalshi:SIDE", peril: "snow", yesAsk: 0.2, noAsk: 0.82 });
  const risks = [risk({ id: "r1", peril: "game", lossUsd: 20000 }), risk({ id: "r2", peril: "snow", lossUsd: 1000 })];
  const out = await sizeQuote({ legs: [{ ...leg(core.id, "no"), riskId: "r1" }, { ...leg(side.id), riskId: "r2" }], risks, contracts: new Map([core, side].map((c) => [c.id, c])),
    coveragePct: 100, budgetUsd: 300, fetchBooks: false, crossCheck: false, route: false });
  const c = out.lines.find((l) => l.riskId === "r1")!, s = out.lines.find((l) => l.riskId === "r2");
  assert.ok(c && c.premiumUsd >= 0.6 * 300 - 1, `core gets the first (capped) share: ${c?.premiumUsd}`);
  assert.ok(!s || s.premiumUsd <= 300 - c.premiumUsd + 1e-6);
});
