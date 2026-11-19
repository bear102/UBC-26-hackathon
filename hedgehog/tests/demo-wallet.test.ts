import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { DemoWalletAdapter } from "../lib/client/demoWallet";

test("demo wallet connects and signs while keeping an existing co-signature", async () => {
  const w = new DemoWalletAdapter();
  await w.connect();
  assert.ok(w.publicKey);
  const desk = Keypair.generate();
  const tx = new Transaction({ feePayer: w.publicKey!, recentBlockhash: "11111111111111111111111111111111" });
  tx.add(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: w.publicKey!, lamports: 1 }));
  tx.add(SystemProgram.transfer({ fromPubkey: w.publicKey!, toPubkey: desk.publicKey, lamports: 1 }));
  tx.partialSign(desk);                       // server co-signs first (desk / quoter)
  const signed = await w.signTransaction(tx);
  assert.ok(signed.verifySignatures(), "both signatures present and valid");
  await w.disconnect();
  assert.equal(w.publicKey, null);
});
