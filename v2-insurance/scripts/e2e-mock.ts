// End-to-end DEVNET test of the mock venue: buy -> owner signs -> confirm -> forced settlement -> crank -> payout.
// Test owner = keys/merchant.json (stands in for Phantom). Settlement token = our own devnet test dollar (desk is mint
// authority), overriding USDC_MINT for this run only, so nothing depends on the Circle faucet.
// Run: npx tsx scripts/e2e-mock.ts
import fs from "node:fs";
import path from "node:path";
import { Transaction } from "@solana/web3.js";
import { createMint, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import { env } from "../lib/env";
import { store } from "../lib/store";
import type { MarketContract } from "../lib/types";
import { getConnection } from "../lib/solana/connection";
import { deskKeypair, loadKeypair, topUp } from "../lib/venue/desk";
import { MockDflowVenue } from "../lib/venue/mock";
import { priceBuy } from "../lib/venue/pricing";
import { parseQnPayload } from "../lib/venue/qnParse";
import { currentWatch } from "../lib/venue/watch";
import { sendRawAndPoll } from "../lib/venue/tx";
import { runOnce } from "./worker";

const conn = getConnection("devnet");
const ex = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sigs: Record<string, string> = {};
function assert(cond: unknown, msg: string): asserts cond { if (!cond) { console.error("FAIL:", msg); process.exit(1); } console.log("  ok -", msg); }

async function liveContract(): Promise<MarketContract> {
  // Prefer a real live market with real prices (Gemini PM public API).
  try {
    const { activeEvents } = await import("../lib/markets/geminiPm");
    const evs = await activeEvents(300);
    for (const e of evs) for (const k of e.contracts ?? []) {
      const ask = Number(k.prices?.buy?.yes ?? k.prices?.bestAsk);
      const bid = Number(k.prices?.sell?.yes ?? k.prices?.bestBid);
      if (k.status === "active" && ask >= 0.05 && ask <= 0.6) {
        return { id: `gemini:${k.instrumentSymbol}`, venue: "gemini", eventTitle: e.title, label: k.label, symbol: k.instrumentSymbol,
          eventTicker: e.ticker, peril: "other", expiry: k.expiryDate ?? e.expiryDate ?? new Date().toISOString(),
          yesAsk: ask, yesBid: Number.isFinite(bid) ? bid : null, noAsk: Number.isFinite(bid) ? Math.round((1 - bid) * 100) / 100 : null,
          noBid: Math.round((1 - ask) * 100) / 100, tradable: true, status: "open", resolution: null };
      }
    }
  } catch (e) { console.warn("live market fetch failed, using stub:", (e as Error).message); }
  return { id: "e2e:stub-heat", venue: "kalshi", eventTitle: "Austin high >= 98F (stub)", label: "Yes", symbol: "STUB", eventTicker: "STUB",
    peril: "heat", expiry: new Date(Date.now() + 86400e3).toISOString(), yesAsk: 0.12, yesBid: 0.1, noAsk: 0.9, noBid: 0.88, tradable: true, status: "open" };
}

async function main() {
  console.log("RPC", env.rpc());
  const deployer = loadKeypair(path.join(env.keysDir(), "deployer.json"));
  const owner = loadKeypair(path.join(env.keysDir(), "merchant.json"));
  const desk = deskKeypair();
  console.log("desk ", desk.publicKey.toBase58());
  console.log("owner", owner.publicKey.toBase58());

  // 1. SOL funding (devnet) from the deployer; leaves the rest for program deployment.
  const f1 = await topUp(conn, deployer, desk.publicKey, 0.1, 0.3); if (f1) sigs.fundDesk = f1;
  const f2 = await topUp(conn, deployer, owner.publicKey, 0.02, 0.05); if (f2) sigs.fundOwner = f2;

  // 2. Test settlement mint (6 decimals, desk authority), persisted for reuse.
  const tmFile = path.join(env.dataDir(), "e2e-test-usdc.json");
  let testMint = fs.existsSync(tmFile) ? JSON.parse(fs.readFileSync(tmFile, "utf8")).mint as string : "";
  if (!testMint) {
    testMint = (await createMint(conn, desk, desk.publicKey, null, 6, undefined, { commitment: "confirmed" })).toBase58();
    fs.mkdirSync(env.dataDir(), { recursive: true });
    fs.writeFileSync(tmFile, JSON.stringify({ mint: testMint, authority: desk.publicKey.toBase58(), createdAt: new Date().toISOString() }, null, 2));
  }
  process.env.USDC_MINT = testMint; // run-only override
  console.log("test USD mint", testMint);
  const { PublicKey } = await import("@solana/web3.js");
  const mintPk = new PublicKey(testMint);
  const ownerUsd = await getOrCreateAssociatedTokenAccount(conn, desk, mintPk, owner.publicKey, false, "confirmed");
  if (ownerUsd.amount < 20_000_000n) sigs.mintTestUsd = await mintTo(conn, desk, mintPk, ownerUsd.address, desk, 100_000_000n, [], { commitment: "confirmed" });

  const venue = new MockDflowVenue({ conn, desk });
  const contract = await liveContract();
  const coinflip: MarketContract = { ...contract, id: `${contract.id}#e2e-coinflip`, yesAsk: 0.5, noAsk: 0.5, yesBid: 0.49, noBid: 0.49 };
  console.log(`contract ${contract.id} "${contract.eventTitle} / ${contract.label}" yesAsk=${contract.yesAsk}`);

  // 3. Guard rails (pure).
  let refused = false; try { priceBuy({ ...contract, yesAsk: 0.9 }, "yes", 1); } catch { refused = true; }
  assert(refused, "refuses ask > 0.85");

  const usdBal = async () => (await getAccount(conn, ownerUsd.address, "confirmed")).amount;
  const usd0 = await usdBal();

  // 4. Buy YES (winner) and NO on a coinflip (loser). Owner signs + sends like Phantom would.
  async function buyAndConfirm(c: MarketContract, side: "yes" | "no", n: number, label: string) {
    const { position, txBase64 } = await venue.buildBuyTx({ owner: owner.publicKey.toBase58(), contract: c, side, contracts: n, businessId: "e2e-test" });
    const tx = Transaction.from(Buffer.from(txBase64, "base64"));
    tx.partialSign(owner);
    const sig = await sendRawAndPoll(conn, tx.serialize());
    sigs[label] = sig;
    const p = await venue.confirmBuy(position.id, sig);
    assert(p.txSig === sig && p.status === "open", `${label}: ${n} ${side.toUpperCase()} for $${p.costUsd} confirmed (${p.id})`);
    return p;
  }
  const win = await buyAndConfirm(contract, "yes", 3, "buyYes");
  const lose = await buyAndConfirm(coinflip, "no", 2, "buyNo");
  const usd1 = await usdBal();
  assert(usd0 - usd1 === BigInt(Math.round((win.costUsd + lose.costUsd) * 1e6)), `premium debited: $${Number(usd0 - usd1) / 1e6}`);
  const outAta = getAssociatedTokenAddressSync(new PublicKey(win.mint), owner.publicKey);
  const outBefore = (await getAccount(conn, outAta, "confirmed")).amount;
  assert(outBefore >= 3n, `owner holds ${outBefore} YES outcome tokens (3 from this run)`);

  // 5. QuickNode parser against the real devnet tx shape.
  const raw = await conn.getTransaction(sigs.buyYes, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const hits = parseQnPayload([{ parentSlot: (raw?.slot ?? 1) - 1, transactions: [JSON.parse(JSON.stringify(raw))] }], currentWatch());
  assert(hits.length === 1 && hits[0].kind === "fill" && hits[0].positionId === win.id, `qn parser on real tx: "${hits[0]?.text}"`);

  // 6. Force resolution: both markets settle YES.
  const settled = (c: MarketContract): MarketContract => ({ ...c, status: "settled", resolution: "yes", yesAsk: null, noAsk: null });
  const stub = async (id: string) => (id === contract.id ? settled(contract) : id === coinflip.id ? settled(coinflip) : null);
  const before = new Map(store.list("positions").map((p) => [p.id, p.status]));
  const r = await runOnce({ getContract: stub, venueFor: () => venue });
  console.log("  crank:", JSON.stringify(r));
  const w = store.get("positions", win.id)!, l = store.get("positions", lose.id)!;
  sigs.redeem = w.redeemTxSig ?? "";
  assert(w.status === "redeemed" && w.payoutUsd === 3 && !!w.redeemTxSig, `winner redeemed $${w.payoutUsd}`);
  assert(l.status === "lost", "loser marked lost");
  const usd2 = await usdBal();
  // Earlier stranded e2e buys (signed but never confirmed) are recovered by the crank's memo lookup and paid too.
  const extra = store.list("positions").filter((p) => p.id !== win.id && p.owner === w.owner && p.status === "redeemed" && before.get(p.id) !== "redeemed");
  const expected = 3 + extra.reduce((s, p) => s + (p.payoutUsd ?? 0), 0);
  if (extra.length) console.log(`  (crank also recovered + redeemed ${extra.map((p) => p.id).join(", ")})`);
  assert(usd2 - usd1 === BigInt(expected) * 1_000_000n, `owner received $${Number(usd2 - usd1) / 1e6} test USD (expected $${expected})`);
  const burnedExpected = 3n + BigInt(extra.filter((p) => p.mint === w.mint).reduce((s, p) => s + (p.payoutUsd ?? 0), 0));
  const outAfter = (await getAccount(conn, outAta, "confirmed")).amount;
  assert(outBefore - outAfter === burnedExpected, `winning outcome tokens burned (${outBefore} -> ${outAfter})`);

  // 7. Idempotency: second crank pass and a direct re-redeem must not pay twice.
  const r2 = await runOnce({ getContract: stub, venueFor: () => venue, log: () => {} });
  const again = await venue.redeem(w);
  assert(again.txSig === w.redeemTxSig && (await usdBal()) === usd2, `no double payout (crank redeemed=${r2.redeemed}, memo lookup -> same sig)`);

  console.log("\nPASS. devnet txs:");
  for (const [k, v] of Object.entries(sigs)) console.log(`  ${k.padEnd(12)} ${v}\n               ${ex(v)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
