// QA edge cases: intake details the API would reject (huge paste, bad ZIP, out-of-range numbers) are caught in the form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeError, MAX_DESC } from "../lib/client/intake";

const ok = { description: "We run a taco truck in East Austin.", name: "qa-Truck", zip: "78702", revenue: 1500, budget: 200 };

test("valid details pass", () => assert.equal(intakeError(ok), null));
test("huge paste is caught before the API rejects it", () => {
  assert.match(intakeError({ ...ok, description: "x".repeat(MAX_DESC + 1) }) ?? "", /under 2,000/);
  assert.equal(intakeError({ ...ok, description: "x".repeat(MAX_DESC) }), null);
});
test("ZIP must be 5 digits (blank no longer silently means Austin)", () => {
  for (const zip of ["", "1234", "M5V2T", "7870a"]) assert.match(intakeError({ ...ok, zip }) ?? "", /5-digit US ZIP/);
  assert.equal(intakeError({ ...ok, zip: " 77002 " }), null);
});
test("revenue and budget limits match /api/advise", () => {
  assert.match(intakeError({ ...ok, revenue: 0 }) ?? "", /positive/);
  assert.match(intakeError({ ...ok, revenue: 20_000_000 }) ?? "", /under \$10 million/);
  assert.match(intakeError({ ...ok, budget: 2_000_000 }) ?? "", /under \$1 million/);
  assert.equal(intakeError({ ...ok, revenue: 1_000_000, budget: 50_000 }), null);
});
