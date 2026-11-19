import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteBin, quoteStrip, walkBook, guardReason, trancheTarget, needPerBin, capacityOf } from "../../lib/hh/pricing";

const L = (p: number, q: number) => ({ price: String(p), amount: String(q) });
const clippers = { bids: [L(0.13, 388), L(0.12, 350)], asks: [L(0.14, 750), L(0.15, 2520), L(0.32, 10)] };

test("1500 Clippers contracts on the 19:21Z book cost $217.50", () => {
  const w = walkBook(clippers, 1500);
  assert.equal(w.cost, 217.5);
  assert.ok(w.fillable);
});
test("strip sums and depth", () => {
  const a = quoteBin("A", { bids: [L(0.01, 100)], asks: [L(0.03, 100), L(0.09, 10)] });
  const b = quoteBin("B", { bids: [L(0.05, 100)], asks: [L(0.1, 100), L(0.15, 10)] });
  const c = quoteBin("C", { bids: [L(0.27, 100)], asks: [L(0.32, 100), L(0.37, 1)] });
  const q = quoteStrip([a, b, c]);
  assert.equal(q.costPerReceipt, 0.45);
  assert.equal(q.maxReceipts, 100);
  assert.ok(q.hedgeable);
});
test("empty book disables", () => {
  const q = quoteStrip([quoteBin("X", { bids: [], asks: [] })]);
  assert.equal(q.hedgeable, false);
  assert.match(q.reason!, /No Gemini book/);
});
const base = { k: 1, targetReceipts: 10, cap: 20, premiumToday: 0, dailyBudget: 25, priceCeiling: 0.75, now: 0, salesCloseTs: 10_000, halted: false };
test("Σask 0.65 strip passes the 0.75 ceiling; 0.80 is rejected", () => {
  const bins = [0.53, 0.11, 0.01].map((a, i) => quoteBin("s" + i, { bids: [], asks: [L(a, 100)] }));
  assert.equal(guardReason({ ...base, bins, needContracts: [10, 10, 10] }), null);
  const bins2 = [0.6, 0.2].map((a, i) => quoteBin("s" + i, { bids: [], asks: [L(a, 100)] }));
  assert.match(guardReason({ ...base, bins: bins2, needContracts: [10, 10] })!, /ceiling/);
});
test("budget guard", () => {
  const bins = [quoteBin("s", { bids: [], asks: [L(0.5, 1000)] })];
  assert.match(guardReason({ ...base, bins, needContracts: [100], targetReceipts: 10 })!, /budget/);
});
test("threshold -1 never pre-buys on timer; a revert triggers", () => {
  assert.equal(trancheTarget({ hedgedCapacity: 10, sold: 10, cap: 20, threshold: -1, revertSeen: false }), null);
  assert.equal(trancheTarget({ hedgedCapacity: 10, sold: 10, cap: 20, threshold: -1, revertSeen: true }), 20);
  assert.equal(trancheTarget({ hedgedCapacity: 10, sold: 7, cap: 20, threshold: 3, revertSeen: false }), 20);
  assert.equal(trancheTarget({ hedgedCapacity: 20, sold: 20, cap: 20, threshold: 3, revertSeen: true }), null);
});
test("need and capacity math", () => {
  assert.deepEqual(needPerBin(20, 1, [10, 12.5]), [10, 7.5]);
  assert.equal(capacityOf([100, 100], 100_000), 10);
  assert.equal(capacityOf([500_000], 10_000), 500_000);
  assert.equal(capacityOf([1000, 950], 1_000_000), 9);
});
test("ceiling is per $1, not scaled by refund size", () => {
  const bins = [quoteBin("s", { bids: [], asks: [L(0.51, 100)] })];
  assert.equal(guardReason({ ...base, k: 0.1, bins, needContracts: [1] }), null);
});
