import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolutionHash, canonicalResolution, termsHash, RISK_NOTE } from "../../lib/hh/canon";

const ev = JSON.parse(fs.readFileSync("tests/fixtures/WXHIGH-AUS-2611170459.json", "utf8"));

test("canonical hash test vector", async () => {
  assert.equal(await resolutionHash(ev), "4c0985315ecd2b18bf22532d8da14eb4a423a4756ca2a7dfa5242084d46dee82");
});
test("volume / order / extra fields do not change the hash", async () => {
  const e2 = { ...ev, volume: "999", contracts: [...ev.contracts].reverse().map((c: any) => ({ ...c, prices: {} })) };
  assert.equal(canonicalResolution(e2), canonicalResolution(ev));
});
test("terms hash is key-order independent", async () => {
  const t = { sentence: "s", applies_to: "a", event_ticker: "E", strip: ["x"], rules_doc: { b: 1, a: [{ d: 1, c: 2 }] }, refund_usd: 1, sales_close_iso: "z", merchant_name: "m", risk_note: RISK_NOTE };
  const t2 = JSON.parse(JSON.stringify({ risk_note: RISK_NOTE, merchant_name: "m", sales_close_iso: "z", refund_usd: 1, rules_doc: { a: [{ c: 2, d: 1 }], b: 1 }, strip: ["x"], event_ticker: "E", applies_to: "a", sentence: "s" }));
  assert.equal(await termsHash(t), await termsHash(t2));
});
