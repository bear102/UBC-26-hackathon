// Devnet plumbing: connection, keys, tx send with priority fee, account reads.
import fs from "node:fs";
import path from "node:path";
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction, type Commitment,
} from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { env } from "./env";
import * as P from "./program";

let _conn: Connection | null = null;
export const conn = () => (_conn ??= new Connection(env.rpc(), "confirmed" as Commitment));

const keyCache = new Map<string, Keypair>();
export function key(name: "deployer" | "merchant" | "attestor" | "relayer" | "crank" | "attacker"): Keypair {
  if (keyCache.has(name)) return keyCache.get(name)!;
  const envv = process.env[`KEY_${name.toUpperCase()}`];
  const file = path.resolve(process.cwd(), "keys", `${name}.json`);
  if (!envv && !fs.existsSync(file)) throw new Error(`Missing Solana key ${file}. Run \`npm run keys\` in the project folder (where package.json is), then restart the app.`);
  const raw = envv ? envv : fs.readFileSync(file, "utf8");
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  keyCache.set(name, kp);
  return kp;
}

export const explorer = (sig: string, kind: "tx" | "address" = "tx") => `https://explorer.solana.com/${kind}/${sig}?cluster=devnet`;

export type SendResult = { ok: true; sig: string; ms: number } | { ok: false; sig?: string; code?: number; name?: string; message: string; logs?: string[]; ms: number };

/** Send ixs signed by signers[0] (fee payer) + others. Priority fee included. */
export async function send(ixs: TransactionInstruction[], signers: Keypair[], opts: { skipPreflight?: boolean; cu?: number } = {}): Promise<SendResult> {
  const t0 = Date.now();
  const c = conn();
  const all = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ...(opts.cu ? [ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu })] : []), ...ixs];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let sig: string | undefined;
    try {
      const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight });
      tx.add(...all);
      tx.sign(...signers);
      sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: !!opts.skipPreflight, maxRetries: 3, preflightCommitment: "confirmed" });
      const conf = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (conf.value.err) {
        const t = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
        const logs = t?.meta?.logMessages ?? [];
        const pe = P.parseError(conf.value.err, logs) ?? P.parseError(JSON.stringify(conf.value.err), logs);
        return { ok: false, sig, code: pe?.code, name: pe?.name, message: JSON.stringify(conf.value.err), logs, ms: Date.now() - t0 };
      }
      return { ok: true, sig, ms: Date.now() - t0 };
    } catch (e) {
      lastErr = e;
      const logs = (e as { logs?: string[] }).logs;
      const pe = P.parseError(e, logs);
      if (pe) return { ok: false, sig, code: pe.code, name: pe.name, message: String((e as Error).message ?? e).slice(0, 500), logs, ms: Date.now() - t0 };
      if (!/blockhash|expired|timeout|429|fetch failed|ECONN/i.test(String(e))) break;
    }
  }
  return { ok: false, message: String((lastErr as Error)?.message ?? lastErr).slice(0, 500), ms: Date.now() - t0 };
}

export async function readPromise(pda: PublicKey | string) {
  const a = await conn().getAccountInfo(new PublicKey(pda), "confirmed");
  return a ? P.decodePromise(a.data) : null;
}
export async function readMerchant(authority: PublicKey) {
  const a = await conn().getAccountInfo(P.merchantPda(authority), "confirmed");
  return a ? P.decodeMerchant(a.data) : null;
}
export async function usdcBalance(owner: PublicKey): Promise<number | null> {
  try { return Number((await getAccount(conn(), P.usdcAta(owner), "confirmed")).amount) / 1e6; } catch { return null; }
}
export async function tokenBalance(ata: PublicKey): Promise<number | null> {
  try { return Number((await getAccount(conn(), ata, "confirmed")).amount) / 1e6; } catch { return null; }
}
/** All receipts of a promise (memcmp on promise at offset 8). */
export async function receiptsOf(promise: PublicKey) {
  const accs = await conn().getProgramAccounts(P.PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: P.RECEIPT_SIZE }, { memcmp: { offset: 8, bytes: promise.toBase58() } }],
  });
  return accs.map((a) => ({ pubkey: a.pubkey, ...P.decodeReceipt(a.account.data) })).sort((x, y) => x.index - y.index);
}
