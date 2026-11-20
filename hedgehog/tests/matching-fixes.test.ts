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
