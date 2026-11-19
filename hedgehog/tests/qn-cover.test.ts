import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseQnPayload } from "../lib/venue/qnParse";

test("QuickNode filter output for a Hedgehog Cover BuyPolicy tx is recorded as policy_bought", () => {
  const payload = JSON.parse(fs.readFileSync("tests/fixtures/qn-cover-buy.json", "utf8"));
  const watch = { mints: new Set<string>(), accounts: new Set<string>(), programs: new Set(["4H7QHtz77V8oFuGSeXAEwCrSAph7VFNb667zk5SiRbNe"]) };
  const hits = parseQnPayload(payload, watch);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "policy_bought");
  assert.match(hits[0].text, /Hedgehog Cover policy bought/);
  assert.equal(parseQnPayload(payload, { mints: new Set(), accounts: new Set() }).length, 0); // not watched -> ignored
});
