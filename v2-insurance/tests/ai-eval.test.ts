// Regression tests for fixes found by the AI eval loop (scripts/eval-ai.ts, docs/AI-EVAL.md). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates, underlyings } from "../lib/markets/index";
import type { BusinessProfile, MarketContract, Risk } from "../lib/types";

const profile: BusinessProfile = { id: "t", name: "T", description: "roofer", city: "Austin, TX", avgDailyRevenueUsd: 1000, busyDays: ["Mon"], monthlyBudgetUsd: 100 };
const mk = (id: string, eventTitle: string, label: string, peril: MarketContract["peril"], yesAsk = 0.3): MarketContract => ({
  id, venue: "gemini", eventTitle, label, symbol: id, eventTicker: id, peril, expiry: "2026-11-30T22:00:00Z",
  yesAsk, yesBid: yesAsk - 0.02, noAsk: 1 - yesAsk + 0.02, noBid: 1 - yesAsk - 0.02, tradable: true, status: "open",
});
const risk = (over: Partial<Risk>): Risk => ({ id: "r1", peril: "other", title: "", trigger: "", window: "Nov 30", lossUsd: 100, lossReasoning: "x", confidence: 0.5, ...over });
const now = new Date("2026-11-19T15:00:00Z");

test("iter1: underlyings() names coins/metals/energy and keeps natural gas apart from pump gas", () => {
  assert.deepEqual(underlyings("Natural Gas price on November 30?").map((u) => u.key), ["natgas"]);
  assert.deepEqual(underlyings("US gas prices this week").map((u) => u.key), ["gasoline"]);
  assert.deepEqual(underlyings("Oil (WTI) price on November 20?").map((u) => u.group), ["crude", "crude"]);
});

test("iter1: rankCandidates never offers gold for a copper risk or SOL for a BTC risk", () => {
  const u = [mk("g:XAU", "Gold price on November 30?", "$3,725 or above", "other"), mk("g:CU", "Copper price on November 30?", "$6 or above", "other"),
    mk("g:SOL", "SOL price on November 30", "$73 or above", "crypto"), mk("g:BTC", "BTC price on November 30", "$63,500 or above", "crypto")];
  const cu = rankCandidates(risk({ title: "Copper price spike", trigger: "Copper above $6 on Nov 30" }), profile, u, 10, now).map((c) => c.id);
  assert.deepEqual(cu, ["g:CU"]);
  const btc = rankCandidates(risk({ peril: "crypto", title: "Bitcoin drop", trigger: "BTC below $63,000 on Nov 30" }), profile, u, 10, now).map((c) => c.id);
  assert.deepEqual(btc, ["g:BTC"]);
  // a risk that names no underlying still sees every series
  assert.equal(rankCandidates(risk({ title: "Metal costs", trigger: "metal prices rise" }), profile, u, 10, now).length, 2);
});
