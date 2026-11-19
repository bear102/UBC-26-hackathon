// hedgehog_policy program tests against a local validator with the program loaded.
// Run: cd programs && anchor test   (starts solana-test-validator, then runs this file)
// or:  COVER_TEST_RPC=http://127.0.0.1:8899 node --import tsx --test tests/cover.test.ts
import { test as nodeTest, before } from "node:test";
import assert from "node:assert/strict";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import { CoverClient, businessPda, fromUnits } from "../lib/solana/policyClient";

const RPC = process.env.COVER_TEST_RPC || process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
if (/devnet|mainnet/.test(RPC)) throw new Error("cover tests must run against a local validator");
const conn = new Connection(RPC, "confirmed");
// Skip (not fail) when no local validator is running, e.g. under plain `npm test`.
const validatorUp = await conn.getVersion().then(() => true, () => false);
const test = (validatorUp ? nodeTest : nodeTest.skip) as typeof nodeTest;
if (!validatorUp) console.log(`cover tests skipped: no validator at ${RPC} (run \`cd programs && anchor test\`)`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const admin = Keypair.generate();
const attestor = Keypair.generate();
let mint: PublicKey;
const GRACE = 2;

async function airdrop(pk: PublicKey, sol = 10) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function newOwner(usdc: number) {
  const kp = Keypair.generate();
  await airdrop(kp.publicKey, 2);
  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, mint, kp.publicKey);
  if (usdc > 0) await mintTo(conn, admin, mint, ata.address, admin, usdc * 1e6);
  return { kp, ata: ata.address };
}

async function usdcOf(ata: PublicKey) {
  return Number((await getAccount(conn, ata)).amount) / 1e6;
}

/** Owner signs the server-built unsigned tx and sends it (what Phantom does). */
async function signAndSend(txBase64: string, owner: Keypair) {
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(owner);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const bh = await conn.getLatestBlockhash();
  const res = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (res.value.err) throw new Error(`tx failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; logs?: string[]; transactionLogs?: string[] };
    const text = `${err.message ?? ""}\n${(err.logs ?? err.transactionLogs ?? []).join("\n")}\n${String(e)}`;
    assert.match(text, new RegExp(code), `expected ${code}, got: ${text.slice(0, 600)}`);
    return;
  }
  assert.fail(`expected ${code} but call succeeded`);
}

const inSecs = (s: number) => Math.floor(Date.now() / 1000) + s;
let client: CoverClient;

const buy = (owner: PublicKey, o: Partial<{ premiumUsd: number; payoutUsd: number; expiry: number; monthlyBudgetUsd: number }> = {}) =>
  client.buildBuyTx({
    owner,
    peril: "heat",
    marketRef: "gemini:AUSTIN-HIGH-98F-20261122",
    trigger: "Austin high >= 98F on Sat",
    premiumUsd: o.premiumUsd ?? 10,
    payoutUsd: o.payoutUsd ?? 40,
    expiry: o.expiry ?? inSecs(3600),
    monthlyBudgetUsd: o.monthlyBudgetUsd,
  });

before(async () => {
  if (!validatorUp) return;
  await airdrop(admin.publicKey, 20);
  await airdrop(attestor.publicKey, 2);
  mint = await createMint(conn, admin, admin.publicKey, null, 6);
  client = new CoverClient({ connection: conn, mint });
  const adminClient = client.withSigner(admin);
  await adminClient.initUnderwriter({ attestor: attestor.publicKey, maxExposureUsd: 1000, graceSecs: GRACE });
  const adminAta = await getOrCreateAssociatedTokenAccount(conn, admin, mint, admin.publicKey);
  await mintTo(conn, admin, mint, adminAta.address, admin, 500 * 1e6);
  await adminClient.fundVault(500);
});

test("underwriter initialized and funded", async () => {
  const info = await client.info();
  assert.equal(info.initialized, true);
  assert.equal(info.mint, mint.toBase58());
  assert.equal(info.attestor, attestor.publicKey.toBase58());
  assert.equal(info.vaultBalance, 500);
  assert.equal(info.exposure, 0);
  assert.equal(info.maxExposure, 1000);
});

test("happy path: register+buy in one tx, settle YES pays out", async () => {
  const { kp, ata } = await newOwner(100);
  const r = await buy(kp.publicKey, { premiumUsd: 10, payoutUsd: 40, monthlyBudgetUsd: 200 });
  assert.deepEqual(r.instructions, ["register_business", "buy_policy"]);
  assert.equal(r.policyId, 0);
  assert.deepEqual(r.warnings, []);
  await signAndSend(r.txBase64, kp);

  assert.equal(await usdcOf(ata), 90);
  let info = await client.info();
  assert.equal(info.vaultBalance, 510);
  assert.equal(info.exposure, 40);
  const biz = await client.fetchBusiness(kp.publicKey);
  assert.equal(fromUnits(biz!.spentThisPeriod), 10);
  assert.equal(Number(biz!.policyCount), 1);

  const list = await client.listPolicies(kp.publicKey);
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "open");
  assert.equal(list[0].peril, "heat");
  assert.equal(list[0].payoutUsd, 40);

  // second buy reuses the business (no register) and gets id 1
  const r2 = await buy(kp.publicKey, { premiumUsd: 5, payoutUsd: 20 });
  assert.deepEqual(r2.instructions, ["buy_policy"]);
  assert.equal(r2.policyId, 1);
  await signAndSend(r2.txBase64, kp);

  await client.settlePolicy(r.policyPda, true, attestor);
  assert.equal(await usdcOf(ata), 85 + 40);
  assert.equal((await client.getPolicy(r.policyPda))!.status, "paidOut");

  await client.settlePolicy(r2.policyPda, false, attestor);
  assert.equal((await client.getPolicy(r2.policyPda))!.status, "expired");
  assert.equal(await usdcOf(ata), 125);
  info = await client.info();
  assert.equal(info.exposure, 0);
  assert.equal(info.vaultBalance, 500 + 10 + 5 - 40);
});

test("budget exceeded", async () => {
  const { kp } = await newOwner(100);
  await signAndSend((await buy(kp.publicKey, { premiumUsd: 40, payoutUsd: 80, monthlyBudgetUsd: 50 })).txBase64, kp);
  const r = await buy(kp.publicKey, { premiumUsd: 20, payoutUsd: 40 });
  await expectErr(signAndSend(r.txBase64, kp), "BudgetExceeded");
  // raising the budget (set_budget prepended) lets it through
  const r2 = await buy(kp.publicKey, { premiumUsd: 20, payoutUsd: 40, monthlyBudgetUsd: 100 });
  assert.deepEqual(r2.instructions, ["set_budget", "buy_policy"]);
  await signAndSend(r2.txBase64, kp);
});

test("capacity exceeded", async () => {
  const { kp } = await newOwner(100);
  const info = await client.info();
  const r = await buy(kp.publicKey, { premiumUsd: 10, payoutUsd: info.freeCapacity! + 1, monthlyBudgetUsd: 100 });
  assert.ok(r.warnings.some((w) => w.includes("InsufficientCapacity")));
  await expectErr(signAndSend(r.txBase64, kp), "InsufficientCapacity");
});

test("non-attestor cannot settle; double settle rejected", async () => {
  const { kp } = await newOwner(100);
  const r = await buy(kp.publicKey, { monthlyBudgetUsd: 100 });
  await signAndSend(r.txBase64, kp);
  const mallory = Keypair.generate();
  await airdrop(mallory.publicKey, 1);
  await expectErr(client.settlePolicy(r.policyPda, true, mallory), "NotAttestor");
  await client.settlePolicy(r.policyPda, false, attestor);
  await expectErr(client.settlePolicy(r.policyPda, true, attestor), "AlreadySettled");
});

test("expire after expiry+grace refunds premium", async () => {
  const { kp, ata } = await newOwner(100);
  const before = (await client.info()).exposure!;
  const r = await buy(kp.publicKey, { premiumUsd: 10, payoutUsd: 30, expiry: inSecs(3), monthlyBudgetUsd: 100 });
  await signAndSend(r.txBase64, kp);
  assert.equal(await usdcOf(ata), 90);
  const anyone = Keypair.generate();
  await airdrop(anyone.publicKey, 1);
  await expectErr(client.expirePolicy(r.policyPda, anyone), "NotExpired");

  const expiry = Date.parse((await client.getPolicy(r.policyPda))!.expiry);
  // wait until the validator clock passes expiry + grace
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const slot = await conn.getSlot();
    const t = await conn.getBlockTime(slot).catch(() => null);
    if (t && t * 1000 > expiry + (GRACE + 1) * 1000) break;
  }
  await client.expirePolicy(r.policyPda, anyone);
  const p = (await client.getPolicy(r.policyPda))!;
  assert.equal(p.status, "refunded");
  assert.equal(await usdcOf(ata), 100);
  assert.equal((await client.info()).exposure, before);
  await expectErr(client.settlePolicy(r.policyPda, true, attestor), "AlreadySettled");
});

test("buildBuyTx rejects bad params client-side", async () => {
  const owner = Keypair.generate().publicKey;
  await assert.rejects(buy(owner, { premiumUsd: 10, payoutUsd: 5 }), /payout/);
  await assert.rejects(buy(owner, { expiry: inSecs(-10) }), /expiry/);
  // businessPda is deterministic
  assert.ok(businessPda(owner) instanceof PublicKey);
});
