// Cross-venue comparison + explorer merge (offline, synthetic contracts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setMeta } from "../lib/markets/normalize";
import { buildComparison, findEquivalent, sameGame } from "../lib/markets/compare";
import { buildExplorer } from "../lib/markets/explorer";
import type { MarketContract } from "../lib/types";

const mk = (o: Partial<MarketContract> & Pick<MarketContract, "id" | "venue" | "eventTitle" | "label" | "peril">): MarketContract => ({
  symbol: o.id.split(":")[1], eventTicker: o.id.split(":")[1], expiry: "2026-11-20T01:00:00Z",
  yesAsk: null, yesBid: null, noAsk: null, noBid: null, tradable: o.venue !== "polymarket", status: "open", ...o,
});

const gSas = mk({ id: "gemini:GEMI-NBA-2611200100-LAC-SAS-M-SAS", venue: "gemini", eventTitle: "Los Angeles C vs San Antonio", label: "San Antonio", peril: "game", yesAsk: 0.91, yesBid: 0.89, noAsk: 0.11, noBid: 0.09 });
const kLac = mk({ id: "kalshi:KXNBAGAME-26NOV19LACSAS-LAC", venue: "kalshi", eventTitle: "Los Angeles C vs San Antonio", label: "Los Angeles C", peril: "game", yesAsk: 0.12, yesBid: 0.1, noAsk: 0.9, noBid: 0.88, depthYes: 5000 });
const pLac = mk({ id: "polymarket:nba-lac-sas-2026-11-19", eventTicker: "nba-lac-sas-2026-11-19", venue: "polymarket", eventTitle: "Clippers vs. Spurs", label: "Clippers", peril: "game", yesAsk: 0.2, yesBid: 0.18, noAsk: 0.82, noBid: 0.8 });
setMeta(gSas.id, { eventDate: "2026-11-19", league: "NBA", teams: ["San Antonio", "San Antonio Spurs"], opponents: ["Los Angeles C", "Los Angeles Clippers"] });
setMeta(kLac.id, { eventDate: "2026-11-19", league: "NBA", teams: ["Los Angeles C"], opponents: ["San Antonio"] });
setMeta(pLac.id, { eventDate: "2026-11-19", teams: ["Clippers"], opponents: ["Spurs"] });

test("games: same game across venues, side flips when the other venue lists the opponent", () => {
  assert.equal(sameGame(gSas, kLac), false);
  assert.equal(sameGame(gSas, pLac), false);
  const eq = findEquivalent(gSas, "no", [kLac]);
  assert.equal(eq?.contract.id, kLac.id);
  assert.equal(eq?.side, "yes"); // "Spurs don't win" == "Clippers win"
});

test("comparison: best price, what we use, disagreement flag", () => {
  const cmp = buildComparison(gSas, "no", [kLac, pLac]);
  assert.deepEqual(cmp.rows.map((r) => r.venue), ["gemini", "kalshi", "polymarket"]);
  const [g, k, p] = cmp.rows;
  assert.equal(g.used, true);
  assert.equal(g.ask, 0.11);
  assert.equal(k.ask, 0.12);
  assert.equal(g.best, true);           // Gemini 11¢ < Kalshi 12¢; Polymarket is reference only
  assert.equal(p.role, "reference");
  assert.equal(p.prob, 0.19);
  assert.equal(cmp.verdict, "differ");  // 10% vs 11% vs 19%
  assert.match(cmp.flags.join(" "), /Polymarket is 9 pts higher than Gemini/);
  assert.match(cmp.headline, /^Gemini 10% · Kalshi 11% · Polymarket 19% — markets disagree by 9 pts$/);
});

test("thresholds: identical bounds are 'same', nearby ones 'similar', Brent never matches WTI", () => {
  const g = mk({ id: "gemini:GEMI-WXHIGH-AUS-2611200459-HI78", venue: "gemini", eventTitle: "Highest temperature in Austin on November 19, 2026?", label: "78°F or above", peril: "heat", location: "Austin", yesAsk: 0.02, yesBid: 0.01 });
  const k = mk({ id: "kalshi:KXHIGHAUS-26NOV19-T77", venue: "kalshi", eventTitle: "Highest temperature in Austin on Nov 19, 2026?", label: "78° or above", peril: "heat", location: "Austin", yesAsk: 0.02, yesBid: 0.01 });
  const k2 = mk({ id: "kalshi:KXHIGHAUS-26NOV19-T79", venue: "kalshi", eventTitle: "Highest temperature in Austin on Nov 19, 2026?", label: "80° or above", peril: "heat", location: "Austin", yesAsk: 0.01, yesBid: null });
  const low = mk({ id: "kalshi:KXLOWTAUS-26NOV19-T77", venue: "kalshi", eventTitle: "Lowest temperature in Austin on Nov 19, 2026?", label: "78° or above", peril: "heat", location: "Austin", yesAsk: 0.01, yesBid: null });
  for (const c of [g, k, k2, low]) setMeta(c.id, { eventDate: "2026-11-19", bounds: undefined });
  assert.equal(findEquivalent(g, "yes", [k2, low, k])?.contract.id, k.id);
  const sim = findEquivalent(g, "yes", [k2, low]);
  assert.equal(sim?.contract.id, k2.id);
  assert.equal(sim?.match, "similar");
  const brent = mk({ id: "gemini:GEMI-BRENT2611192200-HI87", venue: "gemini", eventTitle: "Oil (Brent) price on November 19?", label: "$87 or above", peril: "oil" });
  const wti = mk({ id: "kalshi:KXWTI-26NOV19-T86.99", venue: "kalshi", eventTitle: "Oil Price (WTI) on Nov 19, 2026?", label: "$87 or above", peril: "oil" });
  setMeta(brent.id, { eventDate: "2026-11-19" }); setMeta(wti.id, { eventDate: "2026-11-19" });
  assert.equal(findEquivalent(brent, "yes", [wti]), null);
});

test("explorer: one row per game across three venues, outcomes aligned by team", () => {
  const gLac = mk({ ...gSas, id: "gemini:GEMI-NBA-2611200100-LAC-SAS-M-LAC", symbol: "GEMI-NBA-2611200100-LAC-SAS-M-LAC", label: "Los Angeles C", yesAsk: 0.11, yesBid: 0.09 });
  setMeta(gLac.id, { eventDate: "2026-11-19", league: "NBA", teams: ["Los Angeles C"], opponents: ["San Antonio"] });
  const d = buildExplorer([gSas, gLac, kLac, pLac], Date.parse("2026-11-19T12:00:00Z"));
  assert.equal(d.events.length, 1);
  const e = d.events[0];
  assert.deepEqual(e.venues.map((v) => v.venue), ["gemini", "kalshi", "polymarket"]);
  const lac = e.outcomes.find((o) => o.key === "LAC")!;
  assert.deepEqual(Object.keys(lac.cells).sort(), ["gemini", "kalshi", "polymarket"]);
  const sas = e.outcomes.find((o) => o.key === "SAS")!;
  assert.equal(sas.cells.polymarket?.s, "no");
  assert.equal(e.spreadPts, 9);
});
