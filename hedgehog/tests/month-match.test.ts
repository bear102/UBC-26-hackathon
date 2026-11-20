import { test } from "node:test";
import assert from "node:assert/strict";
import { monthsNamed } from "../lib/ai/advisor";

test("monthsNamed reads month names (and not the word 'may')", () => {
  assert.deepEqual([...monthsNamed("Rainy December reduces sales")], [11]);
  assert.deepEqual([...monthsNamed("Rain in Austin above 4 inches in November 2026")], [10]);
  assert.deepEqual([...monthsNamed("Rain may cancel the market")], []);
  assert.deepEqual([...monthsNamed("Hot days in May 2027")], [4]);
  assert.deepEqual([...monthsNamed("Nov 21 - Nov 22")], [10]);
  assert.equal(monthsNamed("Nov 30 - Dec 1").size, 2); // two months: the filter is skipped
});
