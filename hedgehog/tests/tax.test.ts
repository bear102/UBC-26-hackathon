// Tax record extraction from REAL devnet transactions saved in tests/fixtures/tax/ (wallet J4Fo…, mint FBa3PR7p…).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { CSV_HEADER, filterYear, programLogs, summarizeTx, toCsv, toRows, totals, type PolicyMeta, type TaxRow } from "../lib/tax/extract";

const OWNER = "J4FoVwkNE55ormL59fEnfEFwh8PzXekgg9AFnZMPA81p";
const MINT = "FBa3PR7p418SfViu9e6NR1th5MnhpdwYfC2HFt8ed1iJ";
const HAIL = "2PjQvnjUvxUMv8jRy3rRVM3kyEap1PbpofKhUzxkDC7G";
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/tax", `${n}.json`), "utf8")) as { signature: string; tx: ParsedTransactionWithMeta };
const sum = (n: string) => { const f = load(n); return summarizeTx(f.signature, f.tx, OWNER, MINT); };

test("BuyPolicy (with RegisterBusiness in the same tx): premium = -$1, matches the owner's token delta", () => {
  const s = sum("buy-single");
  assert.deepEqual(programLogs(load("buy-single").tx.meta!.logMessages!).instructions, ["BuyPolicy"]);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].type, "premium");
  assert.equal(s.events[0].policy, "9Z4sJW33mH6qPHdPQghQkgCHZAmagJWUvv1QVievzmW5");
  assert.equal(s.events[0].amountUsd, -1);
  assert.equal(s.ownerDeltaUsd, -1);
  assert.equal(s.mint, MINT);
  assert.ok(s.verified);
});

test("batch BuyPolicy tx: one premium per policy from events, summing to the token delta", () => {
  const s = sum("buy-batch");
  assert.deepEqual(s.events.map((e) => e.amountUsd), [-0.15, -0.54, -0.3]);
  assert.ok(Math.abs(s.ownerDeltaUsd - -0.99) < 1e-9);
  assert.ok(s.verified);
  assert.equal(new Set(s.events.map((e) => e.policy)).size, 3);
});

test("SettlePolicy YES: payout +$20 to the owner", () => {
  const s = sum("settle-hail");
  assert.equal(s.events.length, 1);
  assert.deepEqual({ ...s.events[0] }, { instruction: "SettlePolicy", type: "payout", policy: HAIL, amountUsd: 20, outcome: true });
  assert.equal(s.ownerDeltaUsd, 20);
  assert.ok(s.verified);
});

test("someone else's view of the tx yields nothing", () => {
  const f = load("settle-hail");
  const s = summarizeTx(f.signature, f.tx, "11111111111111111111111111111111", MINT);
  assert.equal(s.events.length, 0);
  assert.equal(s.ownerDeltaUsd, 0);
});

test("fallback without events: single instruction gets the whole owner delta", () => {
  const f = load("buy-hail");
  const tx = structuredClone(f.tx);
  tx.meta!.logMessages = tx.meta!.logMessages!.filter((l) => !l.startsWith("Program data:"));
  const s = summarizeTx(f.signature, tx, OWNER, MINT);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].type, "premium");
  assert.equal(s.events[0].policy, null);
  assert.ok(Math.abs(s.events[0].amountUsd - -0.4) < 1e-9);
});

const meta = new Map<string, PolicyMeta>([[HAIL, { pda: HAIL, policyId: 7, marketRef: "hedgehog:hail:austin-tx:25:20261119-20261123", peril: "hail", side: "yes" }]]);
const hailRows = () => toRows([
  { summary: sum("settle-hail"), policyPda: HAIL },
  { summary: sum("buy-hail"), policyPda: HAIL },
  { summary: sum("buy-hail"), policyPda: HAIL }, // duplicate listing (e.g. found under two PDAs) is deduped
], meta, "America/Chicago");

test("rows: oldest first, deduped, local date, explorer link, totals", () => {
  const rows = hailRows();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.type, r.amountUsd, r.policyId, r.side]), [["premium", -0.4, 7, "yes"], ["payout", 20, 7, "yes"]]);
  assert.equal(rows[0].date, "2026-11-19");
  assert.match(rows[1].explorer, /^https:\/\/explorer\.solana\.com\/tx\/3q3tBG5.*\?cluster=devnet$/);
  assert.deepEqual(totals(rows, 2026), { year: 2026, premiumsPaid: 0.4, payoutsReceived: 20, refunds: 0, net: 19.6, count: 2 });
});

test("year filter and local-date year boundary", () => {
  const rows = hailRows();
  assert.equal(filterYear(rows, 2026).length, 2);
  assert.equal(filterYear(rows, 2025).length, 0);
  assert.equal(filterYear(rows, null).length, 2);
  // 2027-01-01T03:00Z is still 2026 in Chicago
  const nye: TaxRow = { ...rows[0], time: "2027-01-01T03:00:00.000Z", date: "2026-12-31" };
  assert.equal(filterYear([nye], 2026).length, 1);
  assert.equal(totals([nye], 2027).count, 0);
});

test("CSV: header row, signed 2-dp amounts, quoting", () => {
  const rows = hailRows();
  rows[0] = { ...rows[0], marketRef: 'odd, "quoted" ref' };
  const csv = toCsv(rows);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], CSV_HEADER.join(","));
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith("2026-11-19,2026-11-19T"));
  assert.ok(lines[1].includes(',Premium paid,-0.40,7,"odd, ""quoted"" ref",hail,yes,'));
  assert.ok(lines[2].includes(",Payout received,20.00,7,"));
  assert.ok(lines[2].endsWith(",yes"));
});
