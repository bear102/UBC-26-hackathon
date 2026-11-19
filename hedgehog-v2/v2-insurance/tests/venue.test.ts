import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MarketContract } from "../lib/types";
import { centsUp, markFor, priceBuy, usdToRaw, rawToUsd, MAX_ASK } from "../lib/venue/pricing";
import { MintRegistry, mintKey } from "../lib/venue/mints";
import { parseQnPayload, extractTransactions, tokenDeltas } from "../lib/venue/qnParse";
import { outcomeMintsFromMarket } from "../lib/venue/dflow";
import { VenueError } from "../lib/venue/types";

const c = (o: Partial<MarketContract> = {}): MarketContract => ({
  id: "gemini:TEST", venue: "gemini", eventTitle: "Austin high", label: "95°F or above", symbol: "TEST", eventTicker: "EV",
  peril: "heat", expiry: "2099-11-20T00:00:00Z", yesAsk: 0.07, yesBid: 0.05, noAsk: 0.95, noBid: 0.93, tradable: true, status: "open", ...o,
});

test("priceBuy rounds premium up to whole cents and converts to base units", () => {
  const p = priceBuy(c(), "yes", 3);
  assert.equal(p.costUsd, 0.21);                    // 0.07*3 = 0.21000000000000002 -> 21 cents, not 22
  assert.equal(p.raw, 210_000n);
  const q = priceBuy(c({ yesAsk: 0.333 }), "yes", 10); // 3.33 exactly
  assert.equal(q.costUsd, 3.33);
  const r = priceBuy(c({ yesAsk: 0.3333 }), "yes", 10); // 3.333 -> 3.34
  assert.equal(r.costUsd, 3.34);
  assert.equal(r.raw, 3_340_000n);
});

test("priceBuy refuses expensive, missing, closed and bad sizes", () => {
  assert.throws(() => priceBuy(c(), "no", 1), VenueError);                 // 0.95 > 0.85
  assert.throws(() => priceBuy(c({ yesAsk: null }), "yes", 1), /no yes ask/);
  assert.throws(() => priceBuy(c({ status: "closed" }), "yes", 1), /not open/);
  assert.throws(() => priceBuy(c(), "yes", 0), /contracts/);
  assert.throws(() => priceBuy(c(), "yes", 1.5), /contracts/);
  assert.doesNotThrow(() => priceBuy(c({ yesAsk: MAX_ASK }), "yes", 1));
});

test("cents/raw helpers", () => {
  assert.equal(centsUp(0.1 + 0.2), 30);
  assert.equal(centsUp(1.001), 101);
  assert.equal(usdToRaw(12.34, 6), 12_340_000n);
  assert.equal(usdToRaw(1, 0), 1n);
  assert.equal(rawToUsd(2_500_000n, 6), 2.5);
});

test("markFor uses bid, then ask, then resolution", () => {
  assert.equal(markFor(c(), "yes"), 0.05);
  assert.equal(markFor(c({ yesBid: null }), "yes"), 0.07);
  assert.equal(markFor(c({ status: "settled", resolution: "yes" }), "yes"), 1);
  assert.equal(markFor(c({ status: "settled", resolution: "yes" }), "no"), 0);
});

test("MintRegistry persists per (contract, side) and filters by authority", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mints-"));
  const reg = new MintRegistry(path.join(dir, "m.json"));
  assert.equal(reg.get("kalshi:X", "yes"), undefined);
  reg.set({ contractId: "kalshi:X", side: "yes", mint: "MintYes", authority: "Desk1", createdAt: "t" });
  reg.set({ contractId: "kalshi:X", side: "no", mint: "MintNo", authority: "Desk1", createdAt: "t" });
  const again = new MintRegistry(path.join(dir, "m.json"));
  assert.equal(again.get("kalshi:X", "yes")?.mint, "MintYes");
  assert.equal(again.get("kalshi:X", "no", "Desk1")?.mint, "MintNo");
  assert.equal(again.get("kalshi:X", "no", "OtherDesk"), undefined); // desk rotated -> new mint
  assert.equal(again.byMint("MintNo")?.side, "no");
  assert.deepEqual([...again.mintSet()].sort(), ["MintNo", "MintYes"]);
  assert.equal(mintKey("a", "yes"), "a|yes");
});

const watch = { mints: new Set(["OutcomeMintYes11111111111111111111111111111"]), accounts: new Set(["DeskPubkey111111111111111111111111111111111"]) };

test("QuickNode block payload: fill + redeem picked, unrelated and failed txs skipped", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("./fixtures/qn-solana-block.json", import.meta.url), "utf8"));
  assert.equal(extractTransactions(payload).length, 4);
  const hits = parseQnPayload(payload, watch);
  assert.equal(hits.length, 2);
  const [fill, redeem] = hits;
  assert.equal(fill.kind, "fill");
  assert.equal(fill.positionId, "pos_mi5abcde1x2y3z");
  assert.ok(fill.signature.startsWith("5xFillSig"));
  assert.equal(fill.slot, 415002114);
  assert.match(fill.text, /3 outcome tokens minted to J4Fo…A81p/);
  assert.equal(redeem.kind, "transfer");
  assert.equal(redeem.redeem, true);
  assert.match(redeem.text, /payout tx for pos_mi5abcde1x2y3z \(3 outcome tokens burned\)/);
});

test("QuickNode filtered batch payload + dedupe by signature", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("./fixtures/qn-filtered-batch.json", import.meta.url), "utf8"));
  const hits = parseQnPayload([payload, payload], watch);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].kind, "transfer");
  assert.match(hits[1].text, /2 outcome tokens moved to Frie…1111/);
  assert.deepEqual(parseQnPayload({ nothing: true }, watch), []);
  assert.deepEqual(parseQnPayload(null, watch), []);
  assert.deepEqual(parseQnPayload("garbage", watch), []);
});

test("tokenDeltas nets pre/post by account", () => {
  const d = tokenDeltas({ meta: {
    preTokenBalances: [{ accountIndex: 1, mint: "M", owner: "A", uiTokenAmount: { amount: "5", decimals: 0 } }],
    postTokenBalances: [{ accountIndex: 1, mint: "M", owner: "A", uiTokenAmount: { amount: "2", decimals: 0 } }],
  } });
  assert.deepEqual(d, [{ mint: "M", owner: "A", delta: -3 }]);
});

test("DFlow metadata market -> outcome mints", () => {
  const usdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.deepEqual(outcomeMintsFromMarket({ ticker: "T", accounts: { [usdc]: { yesMint: "Y", noMint: "N", marketLedger: "L" } } }), { yesMint: "Y", noMint: "N" });
  assert.deepEqual(outcomeMintsFromMarket({ market: { yesMint: "Y2", noMint: "N2" } }), { yesMint: "Y2", noMint: "N2" });
  assert.equal(outcomeMintsFromMarket({ ticker: "T" }), null);
});

test("memo-only matches require a known position when positionIds is given", () => {
  const payload = JSON.parse(fs.readFileSync(new URL("./fixtures/qn-solana-block.json", import.meta.url), "utf8"));
  const empty = { mints: new Set<string>(), accounts: new Set<string>() };
  assert.equal(parseQnPayload(payload, empty).length, 2);                                   // memo alone matches
  assert.equal(parseQnPayload(payload, { ...empty, positionIds: new Set(["pos_other"]) }).length, 0);
  assert.equal(parseQnPayload(payload, { ...empty, positionIds: new Set(["pos_mi5abcde1x2y3z"]) }).length, 2);
});
