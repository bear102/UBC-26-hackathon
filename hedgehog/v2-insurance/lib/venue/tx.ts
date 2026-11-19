// Send + confirm by polling signature status (devnet websockets are flaky; blockheight-based confirm misreports).
import type { Connection, Keypair, Transaction } from "@solana/web3.js";

export async function waitForSignature(conn: Connection, sig: string, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
    if (st?.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    if (Date.now() > until) throw new Error(`tx ${sig} not confirmed after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Signs with `signers` (first = fee payer unless set), sends with resends until confirmed; returns the signature. */
export async function sendAndPoll(conn: Connection, tx: Transaction, signers: Keypair[]): Promise<string> {
  if (!signers.length) throw new Error("no signers");
  if (!tx.recentBlockhash) {
    const bh = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash; tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  }
  tx.feePayer ??= signers[0].publicKey;
  tx.partialSign(...signers);
  return sendRawAndPoll(conn, tx.serialize());
}

export async function sendRawAndPoll(conn: Connection, raw: Buffer | Uint8Array, timeoutMs = 75_000): Promise<string> {
  const sig = await conn.sendRawTransaction(raw, { preflightCommitment: "confirmed", maxRetries: 0 });
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { await waitForSignature(conn, sig, 2_000); return sig; } catch (e) {
      if (/failed:/.test((e as Error).message) || Date.now() > until) throw e;
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
  }
}
