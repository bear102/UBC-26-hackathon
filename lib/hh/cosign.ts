// Fee-payer co-sign for paid customers (§5.8): strict instruction allowlist + rate limits.
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, decodeTransferCheckedInstruction } from "@solana/spl-token";
import * as P from "./program";
import { conn, key, tokenBalance } from "./chain";
import { load, mutate, log } from "./store";

export type CosignResult = { ok: true; sig: string } | { ok: false; error: string };

export async function cosign(txB64: string): Promise<CosignResult> {
  let tx: Transaction;
  try { tx = Transaction.from(Buffer.from(txB64, "base64")); } catch { return { ok: false, error: "bad tx" }; }
  const merchant = key("merchant");
  if (!tx.feePayer || !tx.feePayer.equals(merchant.publicKey)) return { ok: false, error: "fee payer must be the merchant" };
  let transfer: ReturnType<typeof decodeTransferCheckedInstruction> | null = null;
  let createsAta = false;
  for (const ix of tx.instructions) {
    if (ix.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // createIdempotent: data [1]; keys payer, ata, owner, mint, system, token
      if (createsAta || ix.data.length !== 1 || ix.data[0] !== 1 || !ix.keys[0].pubkey.equals(merchant.publicKey) || !ix.keys[3].pubkey.equals(P.USDC_MINT)) return { ok: false, error: "ata create not allowed" };
      createsAta = true; continue;
    }
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (transfer) return { ok: false, error: "exactly one transfer" };
      try { transfer = decodeTransferCheckedInstruction(ix); } catch { return { ok: false, error: "only transferChecked" }; }
      continue;
    }
    return { ok: false, error: `program not allowed: ${ix.programId.toBase58()}` };
  }
  if (!transfer) return { ok: false, error: "no transfer" };
  const owner = transfer.keys.owner.pubkey;
  const amount = Number(transfer.data.amount);
  if (!transfer.keys.mint.pubkey.equals(P.USDC_MINT)) return { ok: false, error: "mint must be USDC" };
  if (!transfer.keys.source.pubkey.equals(P.usdcAta(owner))) return { ok: false, error: "source must be your USDC account" };
  if (!(amount > 0)) return { ok: false, error: "amount must be > 0" };
  const toMerchant = transfer.keys.destination.pubkey.equals(P.usdcAta(merchant.publicKey));
  if (createsAta && toMerchant) return { ok: false, error: "no ata create on the merchant path" };
  const s = load();
  const holderStr = owner.toBase58();
  const paid = s.receipts.some((r) => r.holder === holderStr && r.refunded);
  if (!paid) return { ok: false, error: "only paid customers get free gas" };
  const day = s.cosigns.filter((c) => c.holder === holderStr && Date.now() - c.ts < 86_400_000);
  if (day.length >= 2) return { ok: false, error: "daily co-sign limit reached" };
  if (createsAta && day.some((c) => c.createsAta)) return { ok: false, error: "one account creation per day" };
  if (s.cosigns.filter((c) => Date.now() - c.ts < 3_600_000).length >= 60) return { ok: false, error: "global co-sign limit" };
  const bal = await tokenBalance(P.usdcAta(owner));
  if (bal == null || amount > Math.round(bal * 1e6)) return { ok: false, error: "amount exceeds balance" };
  // signature by the owner must be present and valid
  const ownerSig = tx.signatures.find((x) => x.publicKey.equals(owner));
  if (!ownerSig?.signature) return { ok: false, error: "customer signature missing" };
  tx.partialSign(merchant);
  if (!tx.verifySignatures()) return { ok: false, error: "bad signatures" };
  try {
    const sig = await conn().sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    const bh = tx.recentBlockhash!;
    await conn().confirmTransaction({ signature: sig, blockhash: bh, lastValidBlockHeight: (await conn().getLatestBlockhash()).lastValidBlockHeight }, "confirmed");
    mutate((st) => { st.cosigns.push({ holder: holderStr, ts: Date.now(), createsAta, sig }); });
    log("info", "cosign", `co-signed ${amount / 1e6} USDC from ${holderStr} ${toMerchant ? "to merchant" : "cash-out"}`);
    return { ok: true, sig };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

export const merchantPubkey = () => key("merchant").publicKey.toBase58();
export { PublicKey };
