// Exposure horizons (lib/ai/horizon.ts): window parsing, horizon fit, futures side, stage wording, fallback season risks.
// No network: futures meta comes from trimmed real contracts (tests/fixtures/long-horizon-markets.json, markets-v3 snapshot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  futuresFallbackRisks, futuresSide, horizonFit, horizonKind, monthsOfCover, ownTeamsIn, parseHorizon, periodFallbackRisks, riskHorizon, stageWanted,
} from "../lib/ai/horizon";
import { setMeta } from "../lib/markets/normalize";
import { coverMonths, sizeQuote } from "../lib/markets/quote";
import type { BusinessProfile, MarketContract, Risk } from "../lib/types";

const NOW = new Date("2026-11-19T20:00:00Z");
const LONG: MarketContract[] = JSON.parse(readFileSync(new URL("./fixtures/long-horizon-markets.json", import.meta.url), "utf8"));
const biz = (description: string, over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: "t", name: "Test Co", description, city: "Austin, TX", avgDailyRevenueUsd: 4000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 300, ...over,
});
// futures meta as the normalizers set it (lib/markets/futures.ts futureMeta)
setMeta("gemini:GEMI-NBAF-2627CONF-WEST-SAS", { eventDate: "2026-10-20", eventEnd: "2027-05-31", league: "NBA", teams: ["San Antonio", "San Antonio Spurs"], futureKind: "conference" });
setMeta("kalshi:KXNBAWEST-27-SAS", { eventDate: "2026-10-20", eventEnd: "2027-05-31", league: "NBA", teams: ["San Antonio"], futureKind: "conference" });
setMeta("gemini:GEMI-NFLHOUWINS26-8PLUS", { eventDate: "2026-09-09", eventEnd: "2027-01-10", league: "NFL", teams: ["Houston"], futureKind: "wins" });
setMeta("kalshi:KXNBAPLAYOFF-27-SAS", { eventDate: "2026-10-20", eventEnd: "2027-04-17", league: "NBA", teams: ["San Antonio"], futureKind: "playoffs" });
setMeta("kalshi:KXNBAWCFQUAL-27-SAS", { eventDate: "2026-10-20", eventEnd: "2027-05-17", league: "NBA", teams: ["San Antonio"], futureKind: "round" });
setMeta("gemini:GEMI-NFLPLAYOFF26-27-HOU", { eventDate: "2026-09-09", eventEnd: "2027-01-10", league: "NFL", teams: ["Houston", "Houston Texans"], futureKind: "playoffs" });
setMeta("gemini:GEMI-CFBPLAYOFF2627-TEXAS", { eventDate: "2026-08-29", eventEnd: "2026-12-06", league: "NCAAF", teams: ["Texas"], futureKind: "playoffs" });

test("parseHorizon: months, quarters, seasons, 'through <date>'; short windows stay null", () => {
  assert.deepEqual(parseHorizon("through the NBA playoffs", NOW), { start: "2026-11-19", end: "2027-06-20", kind: "season" });
  assert.deepEqual(parseHorizon("December", NOW), { start: "2026-12-01", end: "2026-12-31", kind: "month" });
  assert.deepEqual(parseHorizon("November", NOW), { start: "2026-11-19", end: "2026-11-30", kind: "month" });
  assert.equal(parseHorizon("this winter", NOW)?.end, "2027-03-31");
  assert.deepEqual(parseHorizon("Q1", NOW), { start: "2027-01-01", end: "2027-03-31", kind: "season" });
  assert.equal(parseHorizon("next 3 months", NOW)?.end, "2027-02-18");
  assert.equal(parseHorizon("by March", NOW)?.end, "2027-03-31");
  assert.equal(parseHorizon("through May 31, 2027", NOW)?.end, "2027-05-31");
  assert.equal(parseHorizon("through the end of the 2026 NFL regular season", NOW)?.end, "2027-01-10");
  assert.equal(parseHorizon("through the College Football Playoff (2026-27)", NOW)?.end, "2027-01-25");
  for (const w of ["next 7 days", "Nov 30", "Nov 21-22", "this weekend", "Saturday", "next FOMC meeting", "until Nov 23", "rain may come", "2026-11-21"]) assert.equal(parseHorizon(w, NOW), null, w);
  assert.equal(horizonKind("2026-11-19", "2026-11-26"), "event");
  assert.equal(riskHorizon({ window: "through the NBA playoffs" }, NOW), "season");
  assert.equal(riskHorizon({ window: "next 7 days" }, NOW), "event");
});

test("horizonFit: full cover scores 1, a day scores ~0, a far-longer contract is diluted", () => {
  const exp = { start: "2026-11-19", end: "2026-11-30" };
  assert.equal(horizonFit({ start: "2026-11-01", end: "2026-11-30" }, exp), 1);
  assert.ok(horizonFit({ start: "2026-11-21", end: "2026-11-21" }, exp) < 0.1);
  assert.ok(horizonFit({ start: "2026-10-20", end: "2027-06-20" }, exp) <= 0.5);
});

test("futuresSide: own-team future -> NO for a revenue risk, YES for a win-funded promo; other teams -> null", () => {
  const owns = ownTeamsIn("Spurs bar");
  const west = { league: "NBA", teams: ["San Antonio"], futureKind: "conference" as const };
  assert.equal(futuresSide({ title: "Spurs playoff run ends early", trigger: "Spurs fail to reach the West finals" }, west, owns), "no");
  assert.equal(futuresSide({ title: "Free wings if the Spurs win the West", trigger: "promo pays out if they win" }, west, owns), "yes");
  assert.equal(futuresSide({ title: "x", trigger: "y" }, { ...west, teams: ["Houston"] }, owns), null);
  // league-aware: "Houston" is the Texans in the NFL, not the Rockets
  assert.equal(futuresSide({ title: "Texans miss the playoffs", trigger: "Texans fail to make the playoffs" }, { league: "NBA", teams: ["Houston"], futureKind: "playoffs" }, ownTeamsIn("Texans")), null);
  assert.deepEqual(stageWanted("Spurs miss the playoffs"), ["playoffs", "wins", "division"]);
  assert.deepEqual(stageWanted("Spurs playoff run ends before the Western finals"), ["round", "conference"]);
});

test("futuresFallbackRisks: a contender gets a deep-run risk, a bubble team a miss-the-playoffs risk; crews get a month total", () => {
  const spurs = futuresFallbackRisks(biz("Sports bar by the Frost Bank Center; Spurs playoff nights are double a normal night."), LONG, NOW);
  assert.equal(spurs.length, 1);
  assert.match(spurs[0].title, /Spurs playoff run ends before the Western finals/);
  assert.equal(spurs[0].horizon, "season");
  assert.equal(parseHorizon(spurs[0].window, NOW)?.end, "2027-06-20");
  const tex = futuresFallbackRisks(biz("Wing shop and sports bar: Texans Sundays are half our sales."), LONG, NOW);
  assert.match(tex[0].title, /Texans miss the playoffs/);
  assert.equal(futuresFallbackRisks(biz("Accounting firm; partners are Spurs fans."), LONG, NOW).length, 0); // not a crowd business
  const land = periodFallbackRisks(biz("Landscaping crews; a soaked month kills billable days."), NOW);
  assert.equal(land[0].window, "November");
  assert.equal(riskHorizon(land[0], NOW), "month");
});

test("sizing: a season hedge is charged its full up-front premium against the budget (no per-month spreading)", async () => {
  const west = LONG.find((c) => c.id === "kalshi:KXNBAWEST-27-SAS")!;
  assert.equal(monthsOfCover("2027-05-31", NOW), 6);
  assert.equal(coverMonths(west, NOW), 6);
  const risk: Risk = { id: "r1", peril: "game", title: "Spurs playoff run ends early", trigger: "x", lossUsd: 1000, lossReasoning: "x", confidence: 0.5, horizon: "season" };
  const r = await sizeQuote({ legs: [{ riskId: "r1", contractId: west.id, side: "no", rationale: "x", basisRisk: "y" }], risks: [risk], contracts: new Map([[west.id, west]]),
    coveragePct: 100, budgetUsd: 150, fetchBooks: false, crossCheck: false, route: false, now: NOW });
  const l = r.lines[0];
  assert.ok(l.premiumUsd <= 150 + 1e-9, `premium ${l.premiumUsd} fits the $150 budget`); // was $660 for 1000 contracts
  assert.ok(l.contracts < 1000 && l.contracts > 0);
  assert.equal(l.premiumPerMonth, undefined);
  assert.ok(r.totalPremiumUsd <= 150 + 1e-9);
});

test("verifier: day-named windows stay short; 'through the <date> FOMC' is long; loss wording beats weak promo cues", () => {
  const now = new Date("2026-11-19T18:00:00Z");
  for (const w of ["Super Bowl Sunday", "next 7 days (NBA season)", "this week during the season", "March Madness weekend"]) assert.equal(parseHorizon(w, now), null, w);
  assert.equal(parseHorizon("through the Jan 27 2027 FOMC", now)?.end, "2027-01-27");
  assert.equal(parseHorizon("holiday season", now)?.end, "2026-12-31");
  const meta = { teams: ["San Antonio"], league: "NBA", futureKind: "playoffs" as const };
  const t = "Spurs miss the playoffs and we can't fund our payroll";
  assert.equal(futuresSide({ title: t, trigger: t }, meta, ownTeamsIn(t)), "no");
  const p = "Free drinks promo if the Spurs make the playoffs";
  assert.equal(futuresSide({ title: p, trigger: p }, meta, ownTeamsIn(p)), "yes");
  assert.deepEqual(stageWanted("Spurs bounced in the first round"), ["round", "conference"]);
});
