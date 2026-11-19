import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { config, DATA_DIR, CIRCLE_DEVNET_USDC } from "./config";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const KEY_DIR = path.join(DATA_DIR, "keys");

let _conn: Connection | null = null;
export const connection = () => (_conn ??= new Connection(config.rpcUrl, "confirmed"));

export type Role = "facilitator" | "agent" | `seller-${string}`;

/** Load a local devnet keypair, creating it on first use (devnet only; never use for real funds). */
export function keypair(role: Role): Keypair {
  const envKey = process.env[`KEY_${role.toUpperCase().replace(/-/g, "_")}`];
  if (envKey) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(envKey)));
  const f = path.join(KEY_DIR, `${role}.json`);
  if (fs.existsSync(f)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
  fs.mkdirSync(KEY_DIR, { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

export function usdcMint(): PublicKey {
  if (config.usdcMintSetting === "self") {
    const f = path.join(DATA_DIR, "mint.json");
    if (!fs.existsSync(f)) throw new Error("USDC_MINT=self but no mint created yet: run `npm run setup`");
    return new PublicKey(JSON.parse(fs.readFileSync(f, "utf8")).mint);
  }
  return new PublicKey(config.usdcMintSetting || CIRCLE_DEVNET_USDC);
}
export const isCircleUsdc = () => usdcMint().toBase58() === CIRCLE_DEVNET_USDC;

export const ata = (owner: PublicKey, mint = usdcMint()) => getAssociatedTokenAddressSync(mint, owner, true);

export async function usdcBalance(owner: PublicKey): Promise<number | null> {
  try {
    const a = await getAccount(connection(), ata(owner));
    return Number(a.amount) / 10 ** config.usdcDecimals;
  } catch { return null; }
}
export async function solBalance(owner: PublicKey) {
  return (await connection().getBalance(owner)) / 1e9;
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Commit a decision fingerprint onchain via the SPL Memo program.
 * The agent signs (so the commitment is attributable to the agent key); the facilitator pays the fee,
 * so the agent wallet never needs SOL.
 */
export async function commitMemo(text: string): Promise<string> {
  const agent = keypair("agent");
  const payer = keypair("facilitator");
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const ix = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID, keys: [{ pubkey: agent.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, agent]);
  const sig = await conn.sendTransaction(tx, { maxRetries: 3 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}
