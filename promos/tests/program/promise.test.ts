import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { H } from "./harness";
import * as P from "../../lib/hh/program";

const T0 = 1_795_000_000; // fixed clock
const TICKER = "NBA-2611200100-LAC-SAS-M";
const STRIP = [`GEMI-${TICKER}-LAC`];
const ONE = 1_000_000;

type Ctx = { h: H; m: Keypair; promise: PublicKey; id: number; vault: PublicKey; holders: Keypair[] };

async function setup(opts: { cap?: number; refund?: number; strip?: string[]; ticker?: string; close?: number; resolve?: number } = {}): Promise<Ctx> {
  const h = new H();
  h.setTime(T0);
  const m = Keypair.generate();
  h.fund(m.publicKey);
  h.setUsdc(m.publicKey, 1_000n * BigInt(ONE));
  const id = Date.now() + Math.floor(Math.random() * 1000);
  const cap = opts.cap ?? 20;
  const ix = await P.ixCreatePromise(m.publicKey, {
    promiseId: id, eventTicker: opts.ticker ?? TICKER, strip: opts.strip ?? STRIP, refundUnits: opts.refund ?? ONE, cap,
    salesCloseTs: T0 + (opts.close ?? 3600), expectedResolveTs: T0 + (opts.resolve ?? 4 * 3600), termsHash: new Uint8Array(32).fill(7),
  });
  const r = h.send([ix], [m]);
  assert.ok(r.ok, JSON.stringify(r));
  const promise = P.promisePda(m.publicKey, id);
  return { h, m, promise, id, vault: P.vaultPda(promise), holders: [] };
}
const pr = (c: Ctx) => P.decodePromise(c.h.data(c.promise)!);
const merch = (c: Ctx) => P.decodeMerchant(c.h.data(P.merchantPda(c.m.publicKey))!);

async function attest(c: Ctx, phase: number, qtyCenti: number[]) {
  return c.h.send([await P.ixAttestHedge(c.h.attestor.publicKey, c.promise, phase, qtyCenti, 140_000, new Uint8Array(32).fill(1), c.h.now())], [c.h.attestor]);
}
async function issue(c: Ctx) {
  const holder = Keypair.generate();
  const sold = pr(c).sold;
  const r = c.h.send([await P.ixIssueReceipt(c.m.publicKey, c.promise, sold, holder.publicKey, new Uint8Array(32).fill(sold))], [c.m]);
  if (r.ok) c.holders.push(holder);
  return r;
}
async function outcome(c: Ctx, winning: string, signer?: Keypair) {
  const s = signer ?? c.h.relayer;
  return c.h.send([await P.ixAttestOutcome(s.publicKey, c.promise, c.m.publicKey, winning, new Uint8Array(32).fill(9), c.h.now())], [s]);
}
async function crank(c: Ctx, from = 0, n = 5, createAtas = true) {
  const cr = Keypair.generate();
  c.h.fund(cr.publicKey);
  const hs = c.holders.slice(from, from + n).map((k, i) => ({ receipt: P.receiptPda(c.promise, from + i), holder: k.publicKey }));
  const ixs = createAtas
    ? await P.crankInstructions(cr.publicKey, c.promise, c.m.publicKey, hs)
    : [await P.ixRefundCrank(cr.publicKey, c.promise, c.m.publicKey, hs.map((x) => ({ receipt: x.receipt, holderAta: P.usdcAta(x.holder) })))];
  return c.h.send(ixs, [cr]);
}
async function release(c: Ctx) { return c.h.send([await P.ixRelease(c.m.publicKey, c.promise)], [c.m]); }
const bal = (c: Ctx, k: PublicKey) => c.h.usdc(P.usdcAta(k));

test("happy YES: create → OPEN 10 → issue 10 → CUTOFF → YES → crank → release", async () => {
  const c = await setup();
  assert.equal(c.h.usdc(c.vault), 20n * BigInt(ONE));
  assert.ok((await attest(c, 0, [1000])).ok);
  assert.equal(pr(c).hedgedCapacity, 10);
  for (let i = 0; i < 10; i++) assert.ok((await issue(c)).ok, `issue ${i}`);
  const r11 = await issue(c);
  assert.equal(r11.ok, false); assert.equal((r11 as any).name, "Unhedged");
  c.h.warp(3600);
  assert.ok((await attest(c, 1, [1000])).ok);
  assert.equal(pr(c).heldBpsMin, 10000);
  c.h.warp(3600);
  const o = await outcome(c, STRIP[0]);
  assert.ok(o.ok, JSON.stringify(o));
  assert.equal(pr(c).status, 1);
  assert.equal(merch(c).cutoffHeldFull, 1);
  const lr = await release(c);
  assert.equal((lr as any).name, "LiabilityLocked");
  const cr = await crank(c, 0, 5);
  assert.ok(cr.ok, JSON.stringify(cr));
  assert.ok((await crank(c, 5, 5)).ok);
  for (const k of c.holders) assert.equal(bal(c, k.publicKey), BigInt(ONE));
  assert.equal(pr(c).refunded, 10);
  assert.equal(c.h.usdc(c.vault), 10n * BigInt(ONE));
  const again = await crank(c, 0, 1);
  assert.equal((again as any).name, "AlreadyRefunded");
  assert.ok((await release(c)).ok);
  assert.equal(pr(c).status, 3);
  assert.equal(c.h.usdc(c.vault), 0n);
  // close receipts returns rent
  const before = c.h.svm.getBalance(c.m.publicKey)!;
  const rcpts = c.holders.map((_, i) => P.receiptPda(c.promise, i));
  assert.ok(c.h.send([await P.ixCloseReceipts(c.m.publicKey, c.promise, rcpts)], [c.m]).ok);
  assert.ok(c.h.svm.getBalance(c.m.publicKey)! > before);
  assert.equal(c.h.data(rcpts[0]), null);
});

test("happy NO: release needs CUTOFF; merchant gets all back", async () => {
  const c = await setup();
  await attest(c, 0, [1000]);
  for (let i = 0; i < 3; i++) await issue(c);
  c.h.warp(3601);
  // no cutoff attest yet
  assert.ok((await outcome(c, "")).ok);
  assert.equal(pr(c).status, 2);
  assert.equal(merch(c).hedgeBreaks, 1); // sold > 0 with no CUTOFF
  assert.equal((await release(c) as any).name, "LiabilityLocked");
  c.h.warp(4 * 3600 + 24 * 3600);
  const before = bal(c, c.m.publicKey)!;
  assert.ok((await release(c)).ok);
  assert.equal(bal(c, c.m.publicKey)! - before, 20n * BigInt(ONE));
});

test("NO with CUTOFF releases immediately; wrong-strip winner = NO", async () => {
  const c = await setup();
  await attest(c, 0, [1000]);
  await issue(c);
  c.h.warp(3601);
  assert.ok((await attest(c, 1, [1000])).ok);
  assert.ok((await outcome(c, `GEMI-${TICKER}-SAS`)).ok);
  assert.equal(pr(c).status, 2);
  assert.ok((await release(c)).ok);
});

test("SalesClosed, SoldOut, UnauthorizedAttestor, TooEarly", async () => {
  const c = await setup({ cap: 2 });
  assert.equal((await attest(c, 1, [1000]) as any).name, "TooEarly");
  // merchant signs attest_hedge → address constraint
  const bad = c.h.send([await P.ixAttestHedge(c.m.publicKey, c.promise, 0, [1000], 0, new Uint8Array(32), c.h.now())], [c.m]);
  assert.equal((bad as any).name, "UnauthorizedAttestor");
  await attest(c, 0, [1000]);
  assert.equal(pr(c).hedgedCapacity, 2); // min(capacity, cap)
  await issue(c); await issue(c);
  assert.equal((await issue(c) as any).name, "SoldOut");
  const badOut = await outcome(c, STRIP[0], c.m);
  assert.equal((badOut as any).name, "UnauthorizedAttestor");
  assert.equal((await outcome(c, STRIP[0]) as any).name, "TooEarly");
  c.h.warp(3600);
  const c2 = await setup();
  await attest(c2, 0, [1000]);
  c2.h.warp(3600);
  assert.equal((await issue(c2) as any).name, "SalesClosed");
  assert.equal((await attest(c2, 0, [1000]) as any).name, "SalesClosed");
});

test("stale attestation rejected", async () => {
  const c = await setup();
  const r = c.h.send([await P.ixAttestHedge(c.h.attestor.publicKey, c.promise, 0, [1000], 0, new Uint8Array(32), c.h.now() - 301)], [c.h.attestor]);
  assert.equal((r as any).name, "StaleAttestation");
});

test("held_bps_min only decreases; 95% re-attest → hedge break at outcome", async () => {
  const c = await setup();
  await attest(c, 0, [2000]);
  for (let i = 0; i < 20; i++) assert.ok((await issue(c)).ok);
  c.h.warp(3601);
  await attest(c, 1, [2000]);
  assert.equal(pr(c).heldBpsMin, 10000);
  await attest(c, 1, [1900]);
  assert.equal(pr(c).heldBpsMin, 9500);
  await attest(c, 2, [2000]);
  assert.equal(pr(c).heldBpsMin, 9500);
  assert.equal(pr(c).heldBpsCutoff, 10000);
  assert.equal(merch(c).hedgeBreaks, 0);
  await outcome(c, "");
  assert.equal(merch(c).hedgeBreaks, 1);
  assert.equal(merch(c).cutoffHeldFull, 0);
});

test("dead ATA is skipped, others paid; worker path recreates it", async () => {
  const c = await setup();
  await attest(c, 0, [1000]);
  for (let i = 0; i < 3; i++) await issue(c);
  c.h.warp(3601);
  await attest(c, 1, [1000]);
  await outcome(c, STRIP[0]);
  // create ATAs for holders 0 and 2 only, then crank without ATA creates
  c.h.setUsdc(c.holders[0].publicKey, 0n);
  c.h.setUsdc(c.holders[2].publicKey, 0n);
  const r = await crank(c, 0, 3, false);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.logs.some((l) => l.includes("Program data:")));
  assert.equal(pr(c).refunded, 2);
  assert.equal(bal(c, c.holders[1].publicKey), null);
  // worker path: ATA create + crank for the skipped one
  const r2 = await crank(c, 1, 1, true);
  assert.ok(r2.ok, JSON.stringify(r2));
  assert.equal(pr(c).refunded, 3);
  assert.ok((await release(c)).ok);
});

test("relayer timeout pays customers; cancel path with sold 0", async () => {
  const c = await setup();
  await attest(c, 0, [1000]);
  await issue(c);
  c.h.warp(4 * 3600 + 72 * 3600 + 1);
  const r = await crank(c, 0, 1);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(pr(c).status, 1);
  const c2 = await setup();
  assert.ok((await release(c2)).ok);
  assert.equal(pr(c2).status, 3);
  assert.equal((await release(c2) as any).name, "LiabilityLocked");
});

test("YES release escape after grace with unrefunded receipts", async () => {
  const c = await setup();
  await attest(c, 0, [1000]);
  await issue(c);
  c.h.warp(3601);
  await outcome(c, STRIP[0]);
  assert.equal((await release(c) as any).name, "LiabilityLocked");
  c.h.warp(7 * 86400 + 60);
  assert.ok((await release(c)).ok);
});

test("strip / amount / time validation", async () => {
  const h = new H(); h.setTime(T0);
  const m = Keypair.generate(); h.fund(m.publicKey); h.setUsdc(m.publicKey, 10_000n * BigInt(ONE));
  const base = { promiseId: 1, eventTicker: TICKER, strip: STRIP, refundUnits: ONE, cap: 5, salesCloseTs: T0 + 60, expectedResolveTs: T0 + 3600, termsHash: new Uint8Array(32) };
  const bad: [Partial<typeof base>, string][] = [
    [{ strip: ["GEMI-OTHER-X"] }, "InvalidStrip"],
    [{ strip: [STRIP[0], STRIP[0]] }, "InvalidStrip"],
    [{ strip: Array.from({ length: 7 }, (_, i) => `GEMI-${TICKER}-${i}`) }, "InvalidStrip"],
    [{ refundUnits: 15_000 }, "InvalidAmount"],
    [{ cap: 501 }, "InvalidAmount"],
    [{ salesCloseTs: T0 - 1 }, "InvalidTimes"],
    [{ expectedResolveTs: T0 + 73 * 3600 }, "InvalidTimes"],
  ];
  for (const [o, name] of bad) {
    const r = h.send([await P.ixCreatePromise(m.publicKey, { ...base, ...o, promiseId: Math.floor(Math.random() * 1e9) })], [m]);
    assert.equal((r as any).name, name, JSON.stringify(o));
  }
});

test("overflow: 500,000 centi at $0.01 refunds does not panic; capacity capped at cap", async () => {
  const c = await setup({ refund: 10_000, cap: 500 });
  assert.ok((await attest(c, 0, [500_000])).ok);
  assert.equal(pr(c).hedgedCapacity, 500);
});

test("settled vector replay: WXHIGH-AUS-2611170459, all bins, $0.10 refunds, 10 receipts in two crank txs (5 ATA-creates each)", async () => {
  const T = "WXHIGH-AUS-2611170459";
  const bins = ["LO49", "50TO51", "52TO53", "54TO55", "56TO57", "HI58"].map((b) => `GEMI-${T}-${b}`);
  const c = await setup({ ticker: T, strip: bins, refund: 100_000, cap: 10 });
  assert.ok((await attest(c, 0, [100, 100, 100, 100, 100, 100])).ok);
  assert.equal(pr(c).hedgedCapacity, 10);
  for (let i = 0; i < 10; i++) assert.ok((await issue(c)).ok);
  c.h.warp(3601);
  await attest(c, 1, [100, 100, 100, 100, 100, 100]);
  assert.ok((await outcome(c, `GEMI-${T}-HI58`)).ok);
  // measure: how many ATA-create pairs fit in one legacy tx
  const r = await crank(c, 0, 5);
  assert.ok(r.ok, JSON.stringify(r).slice(0, 2000));
  assert.ok((await crank(c, 5, 5)).ok);
  assert.equal(pr(c).refunded, 10);
});

test("receipt from another promise / wrong ATA rejected", async () => {
  const c = await setup();
  await attest(c, 0, [1000]);
  await issue(c);
  c.h.warp(3601);
  await outcome(c, STRIP[0]);
  const cr = Keypair.generate(); c.h.fund(cr.publicKey);
  const wrong = c.h.setUsdc(Keypair.generate().publicKey, 0n);
  const r = c.h.send([await P.ixRefundCrank(cr.publicKey, c.promise, c.m.publicKey, [{ receipt: P.receiptPda(c.promise, 0), holderAta: wrong }])], [cr]);
  assert.equal((r as any).name, "ReceiptMismatch");
});
