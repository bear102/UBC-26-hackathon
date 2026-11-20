import { test } from "node:test";
import assert from "node:assert/strict";
import { teamCities } from "../lib/markets/teams";
import { setMeta } from "../lib/markets/normalize";
import type { MarketContract } from "../lib/types";

const g = (id: string, venue: MarketContract["venue"], symbol: string, eventTitle: string, label: string, league?: string): MarketContract => {
  if (league) setMeta(id, { league });
  return { id, venue, symbol, eventTicker: symbol, eventTitle, label, peril: "game", expiry: "2026-11-21T03:00:00Z", yesAsk: 0.5, yesBid: 0.48, noAsk: 0.52, noBid: 0.5, tradable: true, status: "open" };
};

test("pro games map both teams to cities (abbr, city label, nickname)", () => {
  assert.deepEqual(teamCities(g("gemini:GEMI-NBA-2611200100-IND-CLE-M-CLE", "gemini", "GEMI-NBA-2611200100-IND-CLE-M-CLE", "Indiana vs Cleveland", "Cleveland")).sort(), ["Cleveland", "Indianapolis"]);
  assert.ok(teamCities(g("polymarket:nba-cle-chi", "polymarket", "x", "Cavaliers vs. Bulls", "Cavaliers", "NBA")).includes("Cleveland"));
});

test("college names that contain a city or state are not filed under it", () => {
  assert.deepEqual(teamCities(g("kalshi:A", "kalshi", "A", "Northwestern St. vs Stephen F. Austin", "Stephen F. Austin", "NCAAF")), []);
  assert.ok(!teamCities(g("kalshi:B", "kalshi", "B", "Indiana State vs Stephen F. Austin", "Indiana State", "NCAAM")).includes("Indianapolis"));
  assert.ok(teamCities(g("kalshi:C", "kalshi", "C", "Texas vs Texas A&M", "Texas A&M", "NCAAF")).includes("College Station"));
});

test("season futures (many teams) belong to no single city", () => {
  assert.deepEqual(teamCities(g("kalshi:F", "kalshi", "F", "2027 Pro Basketball Champion: Cleveland, San Antonio, Boston", "Cleveland", "NBA")), []);
});
