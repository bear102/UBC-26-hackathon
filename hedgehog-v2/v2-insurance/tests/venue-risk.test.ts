// Money-flow hardening from docs/FLOW-AUDIT.md: fee, quote/price guards, desk exposure ledger + caps, backing circuit
// breaker, voided markets, Cover policy crank, single backing order under concurrent confirms. Offline (temp .data dir).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { centsUp, priceBuy, withFee } from "../lib/venue/pricing";
import { checkBacking, checkCapacity, checkPriceMoved, deskExposure, PENDING_TTL_MS } from "../lib/venue/risk";
import { isVoided, runCrank, VOID_AFTER_MS, type CoverCrank } from "../lib/venue/crank";
import { backOnGemini } from "../lib/venue/geminiHedge";
import { store } from "../lib/store";
import { VenueError, type Venue } from "../lib/venue/types";
import type { MarketContract, Position } from "../lib/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-risk-"));
process.chdir(tmp);

const c = (o: Partial<MarketContract> = {}): MarketContract => ({
  id: "gemini:T", venue: "gemini", eventTitle: "E", label: "L", symbol: "T", eventTicker: "E", peril: "heat",
  expiry: "2099-01-01T00:00:00Z", yesAsk: 0.07, yesBid: 0.05, noAsk: 0.95, noBid: 0.93, tradable: true, status: "open", resolution: null, ...o,
});
const pos = (o: Partial<Position> = {}): Position => ({
  id: `p${Math.random().toString(36).slice(2)}`, businessId: "b", owner: "O".repeat(44), contractId: "gemini:T", side: "yes", contracts: 10,
  costUsd: 0.7, mint: "M", txSig: "sig", network: "devnet", status: "open", createdAt: new Date().toISOString(), ...o,
});

test("fee: default 0; HEDGEHOG_FEE_BPS adds a visible fee rounded up to cents", () => {
  delete process.env.HEDGEHOG_FEE_BPS;
  const p0 = priceBuy(c(), "yes", 3);
  assert.deepEqual([p0.marketCostUsd, p0.feeUsd, p0.costUsd, p0.raw], [0.21, 0, 0.21, 210_000n]);
  const p = priceBuy(c(), "yes", 3, 6, 250);           // 0.21 * 2.5% = 0.00525 -> 1 cent
  assert.deepEqual([p.marketCostUsd, p.feeUsd, p.costUsd, p.raw], [0.21, 0.01, 0.22, 220_000n]);
  process.env.HEDGEHOG_FEE_BPS = "300";
  assert.equal(priceBuy(c(), "yes", 100).costUsd, 7.21);  // 7.00 + 0.21
  process.env.HEDGEHOG_FEE_BPS = "999999";
  assert.equal(withFee(10).feeBps, 2000);               // clamped
  delete process.env.HEDGEHOG_FEE_BPS;
  assert.equal(centsUp(0.07 * 3), 21);
});

test("no sales after a market's expiry, even if the venue still says open", () => {
  assert.throws(() => priceBuy(c({ expiry: new Date(Date.now() - 1000).toISOString() }), "yes", 1), /expired/);
  assert.throws(() => priceBuy(c({ status: "settled", resolution: "yes" }), "yes", 1), /not open/);
});

test("price-moved guard: 1% + 1 cent tolerance over what the owner saw", () => {
  assert.doesNotThrow(() => checkPriceMoved(1.02, 1.0));
  assert.throws(() => checkPriceMoved(1.03, 1.0), (e: VenueError) => e.code === "price_moved" && e.status === 409);
  assert.doesNotThrow(() => checkPriceMoved(5, undefined));
});

test("exposure ledger: confirmed + fresh pending buys count; stale unsigned, settled and mainnet do not", () => {
  const now = Date.now();
  const rows = [
    pos({ contracts: 10 }),
    pos({ contracts: 5, status: "won" }),
    pos({ contracts: 7, txSig: "" }),                                                          // just built, may land
    pos({ contracts: 50, txSig: "", createdAt: new Date(now - PENDING_TTL_MS - 1).toISOString() }), // blockhash dead
    pos({ contracts: 9, status: "lost" }), pos({ contracts: 9, status: "redeemed" }),
    pos({ contracts: 40, network: "mainnet" }),
    pos({ contracts: 3, contractId: "kalshi:K" }),
  ];
  const e = deskExposure(rows, now);
  assert.equal(e.totalUsd, 25);
  assert.deepEqual(e.byContract, { "gemini:T": 22, "kalshi:K": 3 });
  assert.equal(e.pendingPositions, 1);
});

test("caps: per-market and total payout limits", () => {
  const e = deskExposure([pos({ contracts: 90 }), pos({ contracts: 300, contractId: "gemini:U" })]);
  const lim = { maxPerMarketUsd: 100, maxTotalUsd: 400 };
  assert.doesNotThrow(() => checkCapacity("gemini:T", 10, e, lim));
  assert.throws(() => checkCapacity("gemini:T", 11, e, lim), /10 contracts left/);
  assert.throws(() => checkCapacity("gemini:V", 11, e, lim), /in total \(10 contracts left\)/);
});

test("backing circuit breaker: a failed/partial Gemini backing pauses that contract only", () => {
  const h = (status: string, contractId = "gemini:T") => ({ id: `h${status}`, contractId, status, error: "no YES ask on Gemini" }) as never;
  assert.doesNotThrow(() => checkBacking("gemini:T", [h("error")]));   // dry-run: not armed
  process.env.DESK_BACKING_BREAKER = "1";
  assert.throws(() => checkBacking("gemini:T", [h("error")]), (e: VenueError) => e.code === "backing_failed");
  assert.throws(() => checkBacking("gemini:T", [h("partial")]), /paused/);
  assert.doesNotThrow(() => checkBacking("gemini:T", [h("dry-run"), h("filled"), h("error", "gemini:U")]));
  assert.doesNotThrow(() => checkBacking("kalshi:K", [h("error", "kalshi:K")]));
  process.env.DESK_IGNORE_BACKING = "1";
  assert.doesNotThrow(() => checkBacking("gemini:T", [h("error")]));
  delete process.env.DESK_IGNORE_BACKING; delete process.env.DESK_BACKING_BREAKER;
});

test("isVoided: settled without YES/NO, a day past expiry", () => {
  const exp = "2026-01-01T00:00:00Z", t = Date.parse(exp);
  assert.equal(isVoided(c({ status: "settled", resolution: null, expiry: exp }), t + VOID_AFTER_MS + 1), true);
  assert.equal(isVoided(c({ status: "settled", resolution: null, expiry: exp }), t + 1000), false); // may still resolve
  assert.equal(isVoided(c({ status: "settled", resolution: "no", expiry: exp }), t + VOID_AFTER_MS + 1), false);
  assert.equal(isVoided(c({ status: "closed", resolution: null, expiry: exp }), t + VOID_AFTER_MS + 1), false);
});

test("crank: voided market refunds the premium; Cover policies settle by side, expire after grace; idempotent", async () => {
  const now = Date.parse("2026-02-01T00:00:00Z");
  const voidedC = c({ id: "gemini:VOID", status: "settled", resolution: null, expiry: "2026-01-01T00:00:00Z" });
  const yesC = c({ id: "gemini:YES", status: "settled", resolution: "yes" });
  const p = store.upsert("positions", pos({ id: "pv", contractId: "gemini:VOID", costUsd: 0.7 }));
  const refunds: string[] = [];
  const venue = { id: "mock", network: "devnet",
    refund: async (x: Position) => { refunds.push(x.id); return { txSig: "REFUND", payoutUsd: x.costUsd }; },
    redeem: async () => { throw new Error("must not redeem a voided market"); } } as unknown as Venue;

  const policies = [
    { pda: "POL_NO", marketRef: "gemini:YES", expiry: "2099-01-01T00:00:00Z", policyId: 1, payoutUsd: 5, premiumUsd: 1, owner: "O".repeat(44) },
    { pda: "POL_YES", marketRef: "gemini:YES", expiry: "2099-01-01T00:00:00Z", policyId: 2, payoutUsd: 5, premiumUsd: 1, owner: "O".repeat(44) },
    { pda: "POL_OLD", marketRef: "gemini:OPEN", expiry: "2026-01-01T00:00:00Z", policyId: 3, payoutUsd: 5, premiumUsd: 1, owner: "O".repeat(44) },
    { pda: "POL_LIVE", marketRef: "gemini:OPEN", expiry: "2099-01-01T00:00:00Z", policyId: 4, payoutUsd: 5, premiumUsd: 1, owner: "O".repeat(44) },
  ];
  store.upsert("policies", { id: "POL_NO", side: "no" });
  store.upsert("policies", { id: "POL_YES", side: "yes" });
  const calls: string[] = [];
  const open = new Set(policies.map((x) => x.pda));
  const cover: CoverCrank = {
    graceSecs: 3600,
    listOpen: async () => policies.filter((x) => open.has(x.pda)),
    settle: async (pda, outcome) => { calls.push(`settle ${pda} ${outcome}`); open.delete(pda); return `S_${pda}`; },
    expire: async (pda) => { calls.push(`expire ${pda}`); open.delete(pda); return `E_${pda}`; },
  };
  const getContract = async (id: string) => (id === "gemini:VOID" ? voidedC : id === "gemini:YES" ? yesC : c({ id }));
  const r = await runCrank({ getContract, venueFor: () => venue, cover, now: () => now });
  assert.deepEqual(r.errors, []);
  assert.equal(r.voided, 1);
  const after = store.get("positions", p.id)!;
  assert.equal(after.status, "redeemed"); assert.equal(after.voided, true); assert.equal(after.payoutUsd, 0.7);
  assert.deepEqual(calls.sort(), ["expire POL_OLD", "settle POL_NO false", "settle POL_YES true"]);
  assert.equal(r.policiesSettled, 2); assert.equal(r.policiesExpired, 1);

  const r2 = await runCrank({ getContract, venueFor: () => venue, cover, now: () => now });
  assert.equal(r2.voided + r2.policiesSettled + r2.policiesExpired, 0);
  assert.deepEqual(refunds, ["pv"]);
});

test("backOnGemini: concurrent confirms place ONE order (order fn injected; no network)", async () => {
  process.env.HEDGE_LIVE = "1"; process.env.GEMINI_TRADE_KEY = "k"; process.env.GEMINI_TRADE_SECRET = "s";
  try {
    let orders = 0;
    const place = async () => { orders++; await new Promise((r) => setTimeout(r, 30)); return { orderId: 1, filledQuantity: "3" }; };
    const args = { kind: "position" as const, refId: "race1", contract: c({ id: "gemini:R", symbol: "R" }), outcome: "yes" as const, quantity: 3 };
    const [a, b] = await Promise.all([backOnGemini(args, { place }), backOnGemini(args, { place })]);
    assert.equal(orders, 1);
    assert.equal(a?.id, b?.id);
    assert.equal(a?.status, "filled");
  } finally {
    delete process.env.HEDGE_LIVE; delete process.env.GEMINI_TRADE_KEY; delete process.env.GEMINI_TRADE_SECRET;
  }
});
