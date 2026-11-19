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

test("QuickNode filter output for an outcome-token hedge buy is recorded as a fill for its position", () => {
  const payload = JSON.parse(fs.readFileSync("tests/fixtures/qn-filter-hedge-buy.json", "utf8"));
  const watch = { mints: new Set(["FTjNqUE2jFvEFYfkJh2LbjzdN9a4F5pRyezRVRen1As6"]), accounts: new Set(["B53kF14Dch9fvqTfZBcYGSmQ42SmxAGYHkf2sL6UDCer"]) };
  const [hit] = parseQnPayload(payload, watch);
  assert.equal(hit.kind, "fill");
  assert.equal(hit.positionId, "pos_mwnbggbkqf3gy2");
  assert.match(hit.text, /2 outcome tokens minted/);
});

test("QuickNode HMAC signature check: valid, tampered and stale", async () => {
  const { quicknodeSignatureOk } = await import("../lib/venue/qnAuth");
  const { createHmac } = await import("node:crypto");
  const token = "qnsec_test", nonce = "n".repeat(32), ts = String(Math.floor(Date.now() / 1000)), body = Buffer.from('{"matchedTransactions":[]}');
  const sig = createHmac("sha256", Buffer.from(token)).update(nonce + ts + body.toString()).digest("hex");
  assert.equal(quicknodeSignatureOk(token, nonce, ts, sig, body), true);
  assert.equal(quicknodeSignatureOk(token, nonce, ts, sig, Buffer.from("{}")), false);
  assert.equal(quicknodeSignatureOk(token, nonce, String(Number(ts) - 3600), sig, body), false);
});
