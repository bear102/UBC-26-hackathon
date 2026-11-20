// Regressions from the TXFanShop quote (Nov 20): deep-run wording, cross-league dedupe, futures triggers, venue compare, if-clauses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageWanted } from "../lib/ai/horizon";
import { futuresTrigger, sameExposureX } from "../lib/ai/advisor";
import { findEquivalent } from "../lib/markets/compare";
import { setMeta } from "../lib/markets/normalize";
import { eventClause } from "../lib/client/explain";
import type { MarketContract, Risk } from "../lib/types";

const fut = (id: string, eventTitle: string, label: string, yesAsk: number, noAsk: number, futureKind: any, league: string, teams: string[]): MarketContract => {
  setMeta(id, { eventDate: "2026-10-20", eventEnd: "2027-05-31", futureKind, league, teams });
  return { id, venue: id.startsWith("gemini") ? "gemini" : "kalshi", symbol: id.split(":")[1], eventTicker: id.split(":")[1].replace(/-HOU$/, ""), eventTitle, label, peril: "game",
    status: "open", yesAsk, noAsk, yesBid: yesAsk - 0.01, noBid: noAsk - 0.01, expiry: "2027-06-01T00:00:00Z", tradable: true } as unknown as MarketContract;
};
const PLAYOFF = fut("kalshi:KXNBAPLAYOFF-27-HOU", "Pro Basketball Playoff Qualifiers", "Houston", 0.96, 0.05, "playoffs", "NBA", ["Houston"]);
const WCF = fut("kalshi:KXNBAWCFQUAL-27-HOU", "Pro Basketball Western Conference Finals Qualifiers", "Houston", 0.42, 0.76, "round", "NBA", ["Houston"]);
const G_WEST = fut("gemini:GEMI-NBAF-2627CONF-WEST-HOU", "2027 Pro Basketball Western Conference Champion", "Houston", 0.12, 0.92, "conference", "NBA", ["Houston", "Houston Rockets"]);
const G_PLAYOFF = fut("gemini:GEMI-NBAPLAYOFFS26-27-HOU", "Pro Basketball Playoff Qualifiers", "Houston", 0.96, 0.05, "playoffs", "NBA", ["Houston"]);

test("stageWanted: 'miss deep playoff run' is a conference-finals risk, not a miss-the-playoffs one", () => {
  assert.deepEqual(stageWanted("Rockets miss deep playoff run Rockets fail to reach the Western Conference finals"), ["round", "conference"]);
  assert.deepEqual(stageWanted("Spurs miss the playoffs"), ["playoffs", "wins", "division"]);
});

test("sameExposureX: Texans (NFL) and Rockets (NBA) share a city, not an exposure", () => {
  const r = (title: string, trigger: string): Risk => ({ id: title, peril: "game", title, trigger, lossUsd: 1000, lossReasoning: "", confidence: 0.5, horizon: "season" } as Risk);
  assert.equal(sameExposureX(r("Texans miss the NFL playoffs", "Houston Texans miss the playoffs"), r("Rockets miss the Western Conference finals", "Houston Rockets fail to reach the WCF")), false);
  assert.equal(sameExposureX(r("Texans miss the playoffs", "Texans fail to make the playoffs"), r("Texans miss the playoffs, merch stalls", "Texans out of the playoffs")), true);
});

test("futuresTrigger names the stage the contract pays on", () => {
  assert.equal(futuresTrigger(PLAYOFF, "no"), "Houston Rockets miss the NBA playoffs");
  assert.equal(futuresTrigger(WCF, "no"), "Houston Rockets don't reach the Western Conference Finals");
  assert.equal(futuresTrigger(G_WEST, "yes"), "Houston Rockets win the Western Conference title");
});

test("venue compare: a playoffs future is only compared with the same stage on another venue", () => {
  const eq = findEquivalent(PLAYOFF, "no", [G_WEST, WCF, G_PLAYOFF]);
  assert.equal(eq?.contract.id, G_PLAYOFF.id);
  assert.equal(findEquivalent(PLAYOFF, "no", [G_WEST, WCF]), null);
});

test("eventClause: a NO hedge never reads 'If Houston wins'; names keep their capital", () => {
  const long = { peril: "game", title: "Rockets miss the conference finals", trigger: "Houston Rockets fail to reach the Western Conference finals in the 2027 NBA playoffs" } as Risk;
  assert.equal(eventClause(long, PLAYOFF, "no"), "Rockets miss the conference finals");
  assert.equal(eventClause(null, PLAYOFF, "no"), "Houston doesn't win");
  assert.equal(eventClause({ peril: "game", title: "x", trigger: "Denver beats our team" } as Risk, null, "yes"), "Denver beats our team");
  assert.equal(eventClause({ peril: "rain", title: "x", trigger: "Rain hits" } as Risk, null), eventClause({ peril: "rain" } as Risk, null));
});

test("tempMeasureOf: daily high vs overnight low wording", async () => {
  const { tempMeasureOf } = await import("../lib/markets/index");
  assert.equal(tempMeasureOf("Cold snap empties the patio: Austin daily high <= 55F"), "high");
  assert.equal(tempMeasureOf("Nights below 40F empty the deck"), "low");
  assert.equal(tempMeasureOf("Freeze overnight bursts pipes"), "low");
  assert.equal(tempMeasureOf("Heat wave cuts lunch traffic"), "high");
  assert.equal(tempMeasureOf("Cold weekend"), null);
  assert.equal(tempMeasureOf("High demand season with low sales"), null);
});

test("game contracts: away team first on Kalshi/Gemini 'vs' titles; Gemini ticker time shown in CT; home-game risk rejects a road game", async () => {
  const { gameSides, gameStartCT, gameFits } = await import("../lib/ai/advisor");
  const g = { id: "gemini:GEMI-NBA-2611220100-NOP-SAS-M-SAS", venue: "gemini", symbol: "GEMI-NBA-2611220100-NOP-SAS-M-SAS", eventTicker: "GEMI-NBA-2611220100-NOP-SAS", eventTitle: "New Orleans vs San Antonio", label: "San Antonio", peril: "game", status: "open", yesAsk: 0.9, noAsk: 0.11, expiry: "2026-11-23T13:00:00Z" } as unknown as MarketContract;
  assert.deepEqual(gameSides(g), { away: "New Orleans", home: "San Antonio" });
  assert.equal(gameStartCT(g), "Sat, Nov 21, 7:00 PM CT");
  const k = { id: "kalshi:KXNBAGAME-26NOV23SASSAC-SAC", venue: "kalshi", symbol: "KXNBAGAME-26NOV23SASSAC-SAC", eventTicker: "KXNBAGAME-26NOV23SASSAC", eventTitle: "San Antonio vs Sacramento", label: "Sacramento", peril: "game", status: "open", yesAsk: 0.5, noAsk: 0.5, expiry: "2026-11-24T05:00:00Z" } as unknown as MarketContract;
  assert.deepEqual(gameSides(k), { away: "San Antonio", home: "Sacramento" });
  const risk = { id: "r", peril: "game", title: "Spurs lose home game vs Sacramento", trigger: "Sacramento beats the Spurs", lossUsd: 1000, lossReasoning: "", confidence: 0.5 } as Risk;
  const bar = { id: "b", name: "Bar", description: "Sports bar in San Antonio", city: "San Antonio, TX", avgDailyRevenueUsd: 3000, busyDays: ["Fri"], monthlyBudgetUsd: 200 } as any;
  assert.equal(gameFits(risk, k, bar, new Date("2026-11-20T12:00:00Z")), false); // Spurs are away: not a home game
  assert.equal(gameFits({ ...risk, title: "Spurs lose Saturday home game vs New Orleans", trigger: "Pelicans beat the Spurs" } as Risk, g, bar, new Date("2026-11-20T12:00:00Z")), true);
});

test("season line whose stage differs from the title gets the contract's wording as its title", async () => {
  const { stageWanted } = await import("../lib/ai/horizon");
  assert.equal(stageWanted("Spurs miss the playoffs")[0], "playoffs");
  assert.notEqual(stageWanted("Spurs miss the playoffs")[0], "wins"); // so a wins-ladder line retitles to "... win fewer than 50 games"
});

test("gameTrigger: title/trigger from the contract (who loses, home, real game day)", async () => {
  const { gameLineWording: gameTrigger } = await import("../lib/ai/advisor");
  const g = { id: "gemini:GEMI-NBA-2611220100-NOP-SAS-M-NOP", venue: "gemini", symbol: "GEMI-NBA-2611220100-NOP-SAS-M-NOP", eventTicker: "GEMI-NBA-2611220100-NOP-SAS", eventTitle: "New Orleans vs San Antonio", label: "New Orleans", peril: "game", status: "open", yesAsk: 0.11, noAsk: 0.9, expiry: "2026-11-23T13:00:00Z" } as unknown as MarketContract;
  assert.deepEqual(gameTrigger(g, "yes"), { title: "The Spurs lose at home to the Pelicans (Sat, Nov 21)", trigger: "New Orleans beats San Antonio at San Antonio, Sat, Nov 21, 7:00 PM CT" });
  const sas = { ...g, id: "gemini:GEMI-NBA-2611220100-NOP-SAS-M-SAS", symbol: "GEMI-NBA-2611220100-NOP-SAS-M-SAS", label: "San Antonio" } as MarketContract;
  assert.equal(gameTrigger(sas, "no")!.title, "The Spurs lose at home to the Pelicans (Sat, Nov 21)");
});
