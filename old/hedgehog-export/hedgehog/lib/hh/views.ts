// Read models for pages and APIs: store + onchain state merged, secrets never included.
import { PublicKey } from "@solana/web3.js";
import { load } from "./store";
import { readPromise, readMerchant, tokenBalance, key, explorer } from "./chain";
import * as P from "./program";
import { hedgeMode } from "./engine";
import { env } from "./env";

export async function promiseView(id: string, opts: { admin?: boolean } = {}) {
  const s = load();
  const rec = s.promises[id];
  if (!rec) return null;
  const pda = new PublicKey(rec.pda);
  const [onchain, vaultBal, merchantRec] = await Promise.all([
    readPromise(pda).catch(() => null),
    tokenBalance(new PublicKey(rec.vault)).catch(() => null),
    readMerchant(key("merchant").publicKey).catch(() => null),
  ]);
  const orders = s.orders.filter((o) => o.promiseId === id).map(({ raw, ...o }) => (opts.admin ? { ...o, raw } : o));
  const attestations = s.attestations.filter((a) => a.promiseId === id);
  const receipts = s.receipts.filter((r) => r.promiseId === id).map((r) => ({ index: r.index, holder: r.holder, sig: r.sig, ts: r.ts, refunded: !!r.refunded, refundSig: r.refundSig }));
  const { eventSnapshot, ...pub } = rec;
  return {
    ...pub,
    hasEventSnapshot: !!eventSnapshot,
    mode: rec.id && orders.some((o) => o.orderId.startsWith("PAPER-")) ? "paper" : orders.length ? "live" : hedgeMode(),
    onchain: onchain ? { ...onchain, merchant: onchain.merchant.toBase58(), vault: onchain.vault.toBase58(), promiseId: onchain.promiseId.toString(), status: P.STATUS[onchain.status] } : null,
    vaultBalance: vaultBal,
    merchantRecord: merchantRec ? { ...merchantRec, authority: merchantRec.authority.toBase58() } : null,
    orders, attestations, receipts,
    links: { promise: explorer(rec.pda, "address"), vault: explorer(rec.vault, "address"), create: rec.createSig ? explorer(rec.createSig) : null, program: explorer(P.PROGRAM_ID.toBase58(), "address") },
  };
}
export type PromiseView = NonNullable<Awaited<ReturnType<typeof promiseView>>>;

export function config() {
  return {
    programId: P.PROGRAM_ID.toBase58(), usdcMint: P.USDC_MINT.toBase58(), rpc: env.rpc(), publicUrl: env.publicUrl(),
    merchant: key("merchant").publicKey.toBase58(), hedgeMode: hedgeMode(), cluster: "devnet",
  };
}
