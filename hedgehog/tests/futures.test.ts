// Long-dated markets (2026-11-19): sports futures on Gemini (fetched by ticker) and Kalshi (season series),
// plus long-dated macro series. Fixtures are trimmed real responses from 2026-11-19.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeKalshiEvent, seriesSpec, SERIES } from "../lib/markets/dflow";
import { contractMeta, normalizeGeminiEvents } from "../lib/markets/normalize";
import { rankCandidates, slotKey } from "../lib/markets/index";
import {
  FUTURES_KALSHI, futureKind, futureLeague, futureTeams, futureWindow, isFutureTicker, LONG_MACRO_KALSHI, ruleTeam, titleTeam,
} from "../lib/markets/futures";
import type { BusinessProfile, Risk } from "../lib/types";

const GNBA = JSON.parse(readFileSync("tests/fixtures/gemini-event-futures-nba.json", "utf8"));
const GWINS = JSON.parse(readFileSync("tests/fixtures/gemini-event-futures-nflwins.json", "utf8"));
const KWEST = JSON.parse(readFileSync("tests/fixtures/kalshi-event-futures-nbawest.json", "utf8"));
const NOW = new Date("2026-11-19T15:00:00Z");

test("futures tickers: league + kind; single games are not futures", () => {
  const cases: [string, string, string][] = [
    ["NBAF-2627CHAMP", "NBA", "title"], ["NBAF-2627CONF-WEST", "NBA", "conference"], ["NBAPLAYOFFS26-27", "NBA", "playoffs"],
    ["PROFB2027", "NFL", "title"], ["AFCCHAMP27", "NFL", "conference"], ["NFLPLAYOFF26-27", "NFL", "playoffs"],
    ["NFLAFCSOUTH26", "NFL", "division"], ["NFLHOUWINS26", "NFL", "wins"], ["NHLWCF27", "NHL", "conference"],
    ["NHLSTANLEYCUP27", "NHL", "title"], ["CFBPLAYOFF2627", "NCAAF", "playoffs"], ["CFBSEC26", "NCAAF", "conference"],
    ["CFBCHAMP2627", "NCAAF", "title"], ["NCAAMCHAMP27", "NCAAM", "title"],
    ["KXNBA-27-SAS", "NBA", "title"], ["KXNBAWEST-27", "NBA", "conference"], ["KXNBAWCFQUAL-27", "NBA", "round"],
    ["KXNBAWINS-27SAS", "NBA", "wins"], ["KXNFLPLAYOFFHOST-26", "NFL", "round"], ["KXNFLNFCEAST-27", "NFL", "division"],
    ["KXSB-27", "NFL", "title"], ["KXNHLPLAYOFF-27", "NHL", "playoffs"], ["KXNCAAFTOPSEED-27T4", "NCAAF", "round"],
    ["KXNCAAFSEC-26", "NCAAF", "conference"], ["KXNCAAF-27", "NCAAF", "title"],
  ];
  for (const [t, league, kind] of cases) {
    assert.equal(futureLeague(t), league, t);
    assert.equal(futureKind(t), kind, t);
  }
  for (const t of ["NBA-2611211900-SAS-NOP-M", "NFL-2611221200-IND-HOU-M", "KXNBAGAME-26NOV21SASNOP", "KXNFLGAME-26NOV22INDHOU", "KXNCAAFGAME-26NOV22", "KXHIGHAUS-26NOV19"])
    assert.equal(isFutureTicker(t), false, t);
  // every Kalshi futures series is a futures ticker, no series is listed twice
  for (const s of FUTURES_KALSHI) assert.ok(isFutureTicker(s.series), s.series);
  const ids = SERIES.map((s) => s.series);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of LONG_MACRO_KALSHI) assert.ok(seriesSpec(s.series), s.series);
});

test("rules text names the team; label/rules disagreement drops the contract", () => {
  assert.equal(ruleTeam("This market resolves to Yes if San Antonio Spurs wins the 2027 Pro Basketball Finals."), "San Antonio Spurs");
  assert.equal(ruleTeam("If Houston qualifies for the Pro Basketball Playoffs in the 2026-27 season"), "Houston");
  assert.equal(ruleTeam("This market resolves to YES if the Houston Texans win the Pro Football AFC South"), "Houston Texans");
  assert.equal(ruleTeam("Resolves Yes if the Dallas Pro Football team wins at least 9 games"), "Dallas");
  assert.equal(ruleTeam("If Ohio St. is selected as a top 4 seed"), "Ohio St.");
  assert.equal(titleTeam("Pro Basketball: Atlanta Total Wins"), "Atlanta");
  assert.deepEqual(futureTeams({ label: "San Antonio", rules: "If San Antonio Spurs wins", league: "NBA", kind: "title" }), ["San Antonio", "San Antonio Spurs"]);
  assert.equal(futureTeams({ label: "Sacramento", rules: "If San Antonio qualifies for", league: "NBA", kind: "playoffs" }), null);
  // college: "Texas" is not "Texas A&M"
  assert.equal(futureTeams({ label: "Texas", rules: "If Texas A&M wins the SEC", league: "NCAAF", kind: "conference" }), null);
  assert.deepEqual(futureTeams({ label: "Texas", rules: "If Texas is one of the teams to qualify", league: "NCAAF", kind: "playoffs" }), ["Texas"]);
});

test("Gemini NBAPLAYOFFS26-27: the swapped SA/SAC rows are dropped, Houston/Dallas keep real prices + season dates", () => {
  const cs = normalizeGeminiEvents([GNBA]);
  const labels = cs.map((c) => c.label).sort();
  assert.deepEqual(labels, ["Dallas", "Houston"]); // "Sacramento" (rules: San Antonio) and "San Antonio" (rules: Sacramento) are gone
  const hou = cs.find((c) => c.label === "Houston")!;
  const m = contractMeta(hou.id)!;
  assert.equal(m.league, "NBA");
  assert.equal(m.futureKind, "playoffs");
  assert.deepEqual(m.opponents, []);
  assert.equal(m.eventDate, "2026-10-20");
  assert.equal(m.eventEnd, "2027-04-17");
  assert.equal(hou.noAsk, 0.05); // Gemini buy.no: "Rockets miss the playoffs" costs 5c
  assert.equal(hou.tradable, true);
  assert.equal(hou.status, "open");
  // the category feed (includeProps false) would have dropped every non "-M" sports event before
  assert.ok(cs.every((c) => c.peril === "game"));
});

test("Gemini wins ladder: bounds from '9+ wins', a broken rung (14+ priced above 12+) is dropped", () => {
  const cs = normalizeGeminiEvents([GWINS]);
  const byLabel = new Map(cs.map((c) => [c.label, c]));
  assert.ok(!byLabel.has("14+ wins"), "14+ wins YES 0.12 > 12+ wins YES 0.05: stale ask, must not be sold");
  const nine = byLabel.get("9+ wins")!;
  const m = contractMeta(nine.id)!;
  assert.equal(m.futureKind, "wins");
  assert.equal(m.bounds?.lo, 9);
  assert.equal(m.bounds?.text, "≥9 wins");
  assert.deepEqual(m.teams, ["Houston"]);
  assert.equal(m.league, "NFL");
  assert.equal(m.eventEnd, "2027-01-10");
  assert.equal(nine.noAsk, 0.6);
  assert.equal(contractMeta(byLabel.get("17 wins")!.id)!.bounds?.hi, 17);
});

test("Kalshi KXNBAWEST: placeholder 2029 close never becomes eventEnd; NO ask = 1 - YES bid", () => {
  const cs = normalizeKalshiEvent(KWEST, seriesSpec("KXNBAWEST")!);
  const sas = cs.find((c) => c.label === "San Antonio")!;
  const m = contractMeta(sas.id)!;
  assert.ok(sas.expiry.startsWith("2029"), "fixture is the real placeholder close");
  assert.equal(m.eventEnd, "2027-05-31");
  assert.equal(m.eventDate, "2026-10-20");
  assert.equal(m.futureKind, "conference");
  assert.equal(m.league, "NBA");
  assert.ok(m.teams?.includes("San Antonio"));
  assert.equal(sas.noAsk, 0.66);
  assert.equal(sas.noAsk, Math.round((1 - sas.yesBid!) * 100) / 100);
  assert.ok(cs.every((c) => !(contractMeta(c.id)!.eventEnd ?? "").startsWith("2029")));
  assert.equal(futureWindow("NBA", "title", "2029-07-30T14:00:00Z")?.eventEnd, "2027-06-20");
});

test("rankCandidates: 'Houston' resolves by league; futures rank below this week's game for a short window but serve a season risk", () => {
  const hou = normalizeGeminiEvents([GNBA]).find((c) => c.label === "Houston")!;
  const texans = normalizeGeminiEvents([GWINS]).find((c) => c.label === "9+ wins")!;
  const profile: BusinessProfile = { id: "t", name: "Rockets bar", type: "bar", city: "Houston, TX", description: "Sports bar packed for Rockets games", monthlyBudgetUsd: 300, avgDailyRevenueUsd: 4000, busyDays: ["Fri", "Sat"] } as unknown as BusinessProfile;
  const season: Risk = { id: "r1", kind: "direct", peril: "game", title: "Rockets miss the playoffs", trigger: "Rockets miss the playoffs", location: "Houston", window: "2026-11-19 to 2027-04-20", lossUsd: 5000, lossReasoning: "", confidence: 0.6 } as unknown as Risk;
  const got = rankCandidates(season, profile, [hou, texans], 5, NOW);
  assert.deepEqual(got.map((c) => c.id), [hou.id], "NFL Houston (Texans) is not the Rockets");
  // a this-week risk still sees the future, but with the short-window penalty
  const week: Risk = { ...season, title: "Rockets lose this week", trigger: "Rockets lose", window: "next 7 days" };
  assert.equal(rankCandidates(week, profile, [hou], 5, NOW).length, 1);
  // slots: a playoffs future and a title future for the same team are different insured events
  assert.match(slotKey(hou), /\|playoffs$/);
});
