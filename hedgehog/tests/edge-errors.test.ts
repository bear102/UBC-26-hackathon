// QA edge cases: server refusals a real owner hits (a market closed while the quote sat open; a second tab already
// bought the cover) read as plain next steps, not raw venue errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError } from "../lib/client/errors";

test("closed or expired market -> plain words + refresh", () => {
  for (const m of [
    "market kalshi:KXRAIN-26NOV19-AUS is closed, not open",
    "line 2 (kalshi:KXHIGHAUS-26NOV19-B76.5): market kalshi:KXHIGHAUS-26NOV19-B76.5 is settled, not open",
    "market gemini:GEMI-X expired at 2026-11-20T06:00:00Z",
  ]) assert.match(friendlyError(new Error(m)) ?? "", /market has closed.*Refresh prices/);
});

test("already covered (other tab) -> reload", () => {
  assert.equal(friendlyError(new Error("line 1 (kalshi:KXRAINAUSM-26NOV-5): You already have an open policy on this market (#3).")),
    "You already have this cover. Reload the page to see it.");
});

test("unrelated messages are left alone", () => {
  assert.equal(friendlyError(new Error("Transaction rejected by user")), null);
});

test("a Polymarket slug too long for the on-chain marketRef is never offered as buyable", async () => {
  const { isCoverable, fitsOnchain } = await import("../lib/markets/quote");
  const long = "polymarket:lowest-temperature-in-austin-on-november-20-2026-43forbelow"; // 71 bytes
  const base = { venue: "polymarket", status: "open", tradable: false } as never as Parameters<typeof isCoverable>[0];
  assert.equal(fitsOnchain(long), false);
  assert.equal(isCoverable({ ...base, id: long }), false);
  assert.equal(isCoverable({ ...base, id: "polymarket:nba-gsw-mem-2026-11-19" }), true);
  assert.match(friendlyError(new Error("lines.2.marketRef: marketRef must be <= 64 bytes")) ?? "", /can't be covered on Hedgehog/);
});
