import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicate } from "../lib/venue/dupes";

const pol = (pda: string, marketRef: string, status: "open" | "paidOut" | "expired" | "refunded" = "open") => ({ pda, policyId: 1, marketRef, status });

test("findDuplicate: open policy for the same business + market blocks a second buy", () => {
  const biz = new Map([["A", "rainey-patio-bar"], ["B", "other-biz"]]);
  const on = [pol("A", "kalshi:KXRAINHOUM-26NOV-4"), pol("B", "kalshi:X")];
  const of = (pda: string) => biz.get(pda);
  assert.equal(findDuplicate(on, of, { businessId: "rainey-patio-bar", marketRef: "kalshi:KXRAINHOUM-26NOV-4" })?.pda, "A");
  assert.equal(findDuplicate(on, of, { businessId: "other-biz", marketRef: "kalshi:KXRAINHOUM-26NOV-4" }), undefined); // other business
  assert.equal(findDuplicate(on, of, { businessId: "rainey-patio-bar", marketRef: "kalshi:Y" }), undefined); // other market
  assert.equal(findDuplicate([pol("A", "kalshi:KXRAINHOUM-26NOV-4", "paidOut")], of, { businessId: "rainey-patio-bar", marketRef: "kalshi:KXRAINHOUM-26NOV-4" }), undefined); // settled
  assert.equal(findDuplicate([pol("Z", "kalshi:X")], () => undefined, { marketRef: "kalshi:X" })?.pda, "Z"); // no business on either side
});
