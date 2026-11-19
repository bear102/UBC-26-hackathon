// lib/visibility.ts: one rule for what the product shows (no test / e2e / parametric rows) on every read path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedIndex, isHiddenFeedEvent, isHiddenMarketRef, isTestRecord, summarizeTestPolicies, visibleRecords } from "../lib/visibility";
import type { FeedEvent } from "../lib/types";

const MERCHANT = "J4FoVwkNE55ormL59fEnfEFwh8PzXekgg9AFnZMPA81p";
const ATTESTOR = "5LQKRaTS8nkd1ag37huyKVNBc5iaFDRG1LnCYTvCu5Es";
const REAL = "Q6csE2s3gEZxP24Ge7juzCR9KKh82MdymzsBT5rX8PD";

function withEnv(vars: Record<string, string | undefined>, f: () => void) {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { f(); } finally { for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
const clean = { HEDGEHOG_SHOW_TEST: undefined, HEDGEHOG_PARAMETRIC: undefined, HEDGEHOG_TEST_OWNERS: undefined };

test("market refs: e2e and hedgehog:* hidden; parametric flag and SHOW_TEST bring them back; real venues never hidden", () => {
  withEnv(clean, () => {
    assert.equal(isHiddenMarketRef("hedgehog:hail:austin-tx:25:20261119-20261123"), true);
    assert.equal(isHiddenMarketRef("e2e:devnet-smoke"), true);
    assert.equal(isHiddenMarketRef("gemini:GEMI-BTC2611192200-HI63250#e2e-coinflip"), true);
    for (const r of ["gemini:GEMI-NBA-2611200100-LAC-SAS-M-LAC", "kalshi:KXNBAGAME-26NOV19GSWMEM-GSW", "polymarket:nba-gsw-mem-2026-11-19", null, undefined])
      assert.equal(isHiddenMarketRef(r), false, String(r));
  });
  withEnv({ ...clean, HEDGEHOG_PARAMETRIC: "1" }, () => {
    assert.equal(isHiddenMarketRef("hedgehog:hail:austin-tx:25:20261119-20261123"), false);
    assert.equal(isHiddenMarketRef("e2e:devnet-smoke"), true);
  });
  withEnv({ ...clean, HEDGEHOG_SHOW_TEST: "1" }, () => assert.equal(isHiddenMarketRef("e2e:devnet-smoke"), false));
});

test("records: test owners, test businessIds, #e2e ids and hidden refs; the owner always sees their own", () => {
  withEnv(clean, () => {
    assert.equal(isTestRecord({ owner: MERCHANT, businessId: "rainey-patio-bar", marketRef: "kalshi:KXRAINWKND-26NOV21-AUS" }), true);
    assert.equal(isTestRecord({ owner: ATTESTOR, marketRef: "e2e:devnet-smoke" }), true);
    for (const b of ["parametric-demo", "flow-audit", "qn-check", "e2e-test", "smoke-cover-all"]) assert.equal(isTestRecord({ owner: REAL, businessId: b }), true, b);
    assert.equal(isTestRecord({ owner: REAL, businessId: "rainey-patio-bar", contractId: "gemini:X#e2e-void" }), true);
    assert.equal(isTestRecord({ owner: REAL, businessId: "b", marketRef: "hedgehog:hail:x" }), true);
    assert.equal(isTestRecord({ owner: REAL, businessId: "rainey-patio-bar", contractId: "kalshi:KXRAINWKND-26NOV21-AUS" }), false);
    // owner-scoped: a test wallet still sees its own records, and only its own
    assert.equal(isTestRecord({ owner: MERCHANT, businessId: "flow-audit", marketRef: "hedgehog:hail:x" }, MERCHANT), false);
    assert.equal(isTestRecord({ owner: MERCHANT, businessId: "flow-audit" }, REAL), true);
    const rows = [{ id: "a", owner: MERCHANT }, { id: "b", owner: REAL, businessId: "cafe" }];
    assert.deepEqual(visibleRecords(rows).map((r) => r.id), ["b"]);
    assert.deepEqual(visibleRecords(rows, MERCHANT).map((r) => r.id), ["a", "b"]);
  });
  withEnv({ ...clean, HEDGEHOG_TEST_OWNERS: REAL }, () => assert.equal(isTestRecord({ owner: REAL, businessId: "cafe" }), true));
  withEnv({ ...clean, HEDGEHOG_SHOW_TEST: "1" }, () => assert.equal(isTestRecord({ owner: MERCHANT, businessId: "e2e-test", marketRef: "e2e:x" }), false));
});

test("feed: events traced to hidden records (position id, policy PDA in the event id, tx signature, owner in text) are hidden", () => {
  withEnv(clean, () => {
    const positions = [
      { id: "pos_test", owner: MERCHANT, businessId: "e2e-test", contractId: "gemini:G", txSig: "TX_TEST", redeemTxSig: "TX_REDEEM" },
      { id: "pos_real", owner: REAL, businessId: "cafe", contractId: "kalshi:K", txSig: "TX_REAL" },
    ];
    const policies = [{ id: "PDA_TEST", owner: MERCHANT, businessId: "parametric-demo", marketRef: "hedgehog:hail:x", txSig: "TX_POL", settleTxSig: "TX_SETTLE" }];
    const ev = (o: Partial<FeedEvent>): FeedEvent => ({ id: "x", at: "2026-11-19T00:00:00Z", source: "app", kind: "info", text: "", ...o } as FeedEvent);
    const idx = feedIndex({ positions, policies, hedges: [] });
    const hidden = (e: FeedEvent) => isHiddenFeedEvent(e, idx);
    assert.equal(hidden(ev({ id: "fill:TX_TEST", positionId: "pos_test", text: "Hedge filled" })), true);
    assert.equal(hidden(ev({ id: "policy_settled:PDA_TEST", text: "Cover #7 triggered" })), true);
    assert.equal(hidden(ev({ id: "desk_hedge:hedge:policy:PDA_TEST", text: "Desk hedge" })), true);
    assert.equal(hidden(ev({ id: "qn:TX_SETTLE", source: "quicknode", txSig: "TX_SETTLE", text: "QuickNode: policy settled" })), true);
    assert.equal(hidden(ev({ id: "qn:TX_REDEEM", source: "quicknode", txSig: "TX_REDEEM", text: "QuickNode: redeemed" })), true);
    assert.equal(hidden(ev({ id: "qn:Z", source: "quicknode", text: "QuickNode: 2 outcome tokens minted to J4Fo…A81p" })), true);
    assert.equal(hidden(ev({ id: "policy_bought:OTHER", text: "Hedgehog Cover #7 (hail, hedgehog:hail:austin-tx)" })), true);
    // real records and untraceable events stay
    assert.equal(hidden(ev({ id: "fill:TX_REAL", positionId: "pos_real", txSig: "TX_REAL", text: "Hedge filled: 420 YES" })), false);
    assert.equal(hidden(ev({ id: "qn:Q", source: "quicknode", txSig: "UNKNOWN", text: "QuickNode: tx touched the Hedgehog desk" })), false);
    // the test wallet itself sees its events
    const own = feedIndex({ positions, policies, hedges: [] }, MERCHANT);
    assert.equal(isHiddenFeedEvent(ev({ id: "policy_settled:PDA_TEST", text: "paid 20 USDC to J4Fo…" }), own), false);
  });
});

test("onchain totals: test policies are counted beside the total, never subtracted from it", () => {
  withEnv(clean, () => {
    const s = summarizeTestPolicies([
      { pda: "A", owner: MERCHANT, marketRef: "kalshi:K", status: "open", payoutUsd: 400 },
      { pda: "B", owner: ATTESTOR, marketRef: "e2e:devnet-smoke", status: "paidOut", payoutUsd: 2 },
      { pda: "C", owner: REAL, marketRef: "gemini:G", status: "open", payoutUsd: 3 },
      { pda: "D", owner: REAL, marketRef: "gemini:G", status: "open", payoutUsd: 5 },
    ], (pda) => (pda === "D" ? "smoke-cover-all" : "cafe"));
    assert.deepEqual(s, { policies: 4, testPolicies: 3, openTestPolicies: 2, openTestExposureUsd: 405, label: "4 policies (3 test)" });
  });
});
