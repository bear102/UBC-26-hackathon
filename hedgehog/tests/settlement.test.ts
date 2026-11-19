// Settlement: the crank waits for a slow venue instead of refunding, never refunds on an API blip, and each venue's
// resolution is read correctly (Polymarket closed markets, Gemini resolutionSide). No network: fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { awaitingResult, RESULT_WAIT_MS, runCrank, type CoverCrank } from "../lib/venue/crank";
import { store } from "../lib/store";
import { getPolymarket, type PMarket } from "../lib/markets/polymarket";
import { normalizeGeminiEvents } from "../lib/markets/normalize";
import type { Venue } from "../lib/venue/types";
import type { MarketContract } from "../lib/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-settle-"));
process.chdir(tmp);

const c = (o: Partial<MarketContract> = {}): MarketContract => ({
  id: "kalshi:K", venue: "kalshi", eventTitle: "Rain this weekend", label: "Austin", symbol: "K", eventTicker: "E", peril: "rain",
  expiry: "2026-11-23T06:00:00Z", yesAsk: null, yesBid: null, noAsk: null, noBid: null, tradable: true, status: "closed", resolution: null, ...o,
});

test("awaitingResult: closed / open market past the deadline waits up to RESULT_WAIT; settled-without-result does not", () => {
  const exp = "2026-11-23T06:00:00Z", t = Date.parse(exp);
  assert.equal(awaitingResult(c(), exp, t + 3600_000), true);
  assert.equal(awaitingResult(c({ status: "open" }), exp, t + 3600_000), true);
  assert.equal(awaitingResult(c(), exp, t + RESULT_WAIT_MS() + 1), false);
  assert.equal(awaitingResult(c({ status: "settled", resolution: null }), exp, t + 3600_000), false); // voided -> refund
});

test("crank: a slow venue result pays the policy instead of refunding it; API errors never trigger a refund", async () => {
  const policyExpiry = "2026-11-23T06:00:00Z"; // e.g. Kalshi weekend rain: closes Mon 06:00Z, settles ~7.5 h later
  const pol = { pda: "POL_RAIN", marketRef: "kalshi:K", expiry: policyExpiry, policyId: 1, payoutUsd: 3, premiumUsd: 1, owner: "O".repeat(44) };
  store.upsert("policies", { id: "POL_RAIN", side: "yes" });
  const calls: string[] = [];
  let open = true;
  const cover: CoverCrank = {
    graceSecs: 3600,
    listOpen: async () => (open ? [pol] : []),
    settle: async (pda, outcome) => { calls.push(`settle ${pda} ${outcome}`); open = false; return "S"; },
    expire: async (pda) => { calls.push(`expire ${pda}`); open = false; return "E"; },
  };
  const venue = {} as Venue;
  const t0 = Date.parse(policyExpiry) + 2 * 3600_000; // past expiry + grace

  let market = c();
  let r = await runCrank({ getContract: async () => market, venueFor: () => venue, cover, now: () => t0 });
  assert.deepEqual(calls, []); assert.equal(r.policiesAwaiting, 1);

  r = await runCrank({ getContract: async () => { throw new Error("502"); }, venueFor: () => venue, cover, now: () => t0 });
  assert.deepEqual(calls, []); assert.equal(r.errors.length, 1);

  market = c({ status: "settled", resolution: "yes" });
  r = await runCrank({ getContract: async () => market, venueFor: () => venue, cover, now: () => t0 + 6 * 3600_000 });
  assert.deepEqual(calls, ["settle POL_RAIN true"]); assert.equal(r.policiesSettled, 1);

  // never resolved: refund once the wait runs out
  open = true; calls.length = 0; market = c();
  r = await runCrank({ getContract: async () => market, venueFor: () => venue, cover, now: () => Date.parse(policyExpiry) + RESULT_WAIT_MS() + 1 });
  assert.deepEqual(calls, ["expire POL_RAIN"]); assert.equal(r.policiesExpired, 1);
});

test("Polymarket: a resolved (closed) market is found by slug with closed=true and reads as settled", async () => {
  const closed: PMarket = {
    slug: "nba-uta-lal-2026-11-18", question: "Jazz vs. Lakers", outcomes: '["Jazz", "Lakers"]', outcomePrices: '["1", "0"]',
    active: true, closed: true, acceptingOrders: false, endDate: "2026-11-19T03:00:00Z", sportsMarketType: "moneyline", gameStartTime: "2026-11-19 03:00:00+00",
  } as PMarket;
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u); seen.push(url);
    const body = url.includes("slug=nba-uta-lal-2026-11-18") ? (url.includes("closed=true") ? [closed] : []) : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const m = await getPolymarket("polymarket:nba-uta-lal-2026-11-18");
    assert.ok(m, "closed market must be found");
    assert.equal(m!.status, "settled"); assert.equal(m!.resolution, "yes"); assert.equal(m!.label, "Jazz");
    assert.ok(seen.some((u) => u.includes("slug=nba-uta-lal-2026-11-18&closed=true")));
  } finally { globalThis.fetch = realFetch; }
});

test("Gemini: resolutionSide is read case-insensitively", () => {
  const ev = (side: string) => ({
    ticker: "BTC2611192200", title: "BTC price on November 19", category: "Crypto", status: "settled", expiryDate: "2026-11-19T22:00:00.000Z",
    contracts: [{ instrumentSymbol: "GEMI-BTC2611192200-HI63250", label: "$63,250 or above", status: "settled", resolutionSide: side, expiryDate: "2026-11-19T22:00:00.000Z" }],
  });
  for (const [side, want] of [["no", "no"], ["YES", "yes"], ["", null]] as const) {
    const [m] = normalizeGeminiEvents([ev(side) as never]);
    assert.ok(m); assert.equal(m.resolution, want, side);
    assert.equal(m.status, "settled");
  }
});
