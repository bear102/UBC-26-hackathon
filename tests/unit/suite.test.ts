// Suite (SPEC §14): Hedge Desk sizing, market shape, text cleanup. Pure functions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeTicket } from "../../lib/hh/hedgeDesk";
import { shapeOf } from "../../lib/hh/exposure";
import { cleanText } from "../../lib/hh/llm";
import type { GEvent } from "../../lib/hh/gemini";

const bk = (asks: [number, number][], bids: [number, number][] = []) => ({
  asks: asks.map(([p, a]) => ({ price: String(p), amount: String(a) })), bids: bids.map(([p, a]) => ({ price: String(p), amount: String(a) })),
});

test("single ladder threshold: qty = payout, premium = book walk", () => {
  const z = sizeTicket([{ symbol: "NG-HI4", label: "$4 or above", book: bk([[0.35, 0.76], [0.36, 250]], [[0.31, 250]]) }], 100);
  assert.equal(z.legs[0].qty, 100);
  assert.equal(z.premium, 35.99); // 0.76*0.35 + 99.24*0.36
  assert.equal(z.fillable, true);
  assert.equal(z.p_bad, 0.33);
  assert.equal(z.expected_payout, 33);
});

test("exclusive strip: buy payout of each bin, p = sum of mids", () => {
  const z = sizeTicket([
    { symbol: "A", label: "a", book: bk([[0.2, 100]], [[0.18, 100]]) },
    { symbol: "B", label: "b", book: bk([[0.3, 100]], [[0.28, 100]]) },
  ], 50);
  assert.equal(z.premium, 25);
  assert.equal(z.fair, 24);
  assert.equal(z.p_bad, 0.48);
});

test("not enough depth → not fillable; empty book → no premium", () => {
  assert.equal(sizeTicket([{ symbol: "A", label: "a", book: bk([[0.5, 250]]) }], 300).fillable, false);
  const z = sizeTicket([{ symbol: "A", label: "a", book: bk([]) }], 10);
  assert.equal(z.premium, null);
  assert.equal(z.fillable, false);
});

test("shapeOf: weather/sports/Fed exclusive, '$X or above' ladders", () => {
  const ev = (category: string, ticker: string, labels: string[]) => ({ category, ticker, contracts: labels.map((l, i) => ({ label: l, instrumentSymbol: `${ticker}-X${i}` })) }) as unknown as GEvent;
  assert.equal(shapeOf(ev("Weather", "WXHIGH-AUS-1", ["74°F or above", "72°F to 73°F"])), "exclusive");
  assert.equal(shapeOf(ev("Economics", "FED261211", ["Hike 25bps", "Maintain"])), "exclusive");
  assert.equal(shapeOf(ev("Commodities", "NGAS2611302200", ["$3.8 or above", "$4 or above"])), "ladder");
  assert.equal(shapeOf(ev("Crypto", "BTC2611192200", ["$63,000 or above"])), "ladder");
});

test("cleanText fixes garbled arrows and drops replacement chars", () => {
  assert.equal(cleanText("Spurs lose â†’ $1 back"), "Spurs lose → $1 back");
  assert.equal(cleanText("Under 72°F -> $1 back"), "Under 72°F → $1 back");
  assert.equal(cleanText("odd� text"), "odd text");
});
