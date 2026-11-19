// The mock venue's "desk" keypair (devnet market maker + outcome mint authority). keys/desk.json, created if missing.
import fs from "node:fs";
import path from "node:path";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction, type Connection } from "@solana/web3.js";
import { env } from "../env";

let cached: Keypair | null = null;

export function loadKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export function deskKeypair(): Keypair {
  if (cached) return cached;
  const file = process.env.DESK_KEYPAIR || path.join(env.keysDir(), "desk.json");
  if (!fs.existsSync(file)) {
    const kp = Keypair.generate();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  }
  cached = loadKeypair(file);
  return cached;
}

/** Devnet only: top up `to` from `from` if its balance is below minSol. Returns tx sig or null. */
export async function topUp(conn: Connection, from: Keypair, to: Keypair["publicKey"], minSol: number, amountSol: number): Promise<string | null> {
  const bal = await conn.getBalance(to);
  if (bal >= minSol * LAMPORTS_PER_SOL) return null;
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(amountSol * LAMPORTS_PER_SOL) }));
  return sendAndConfirmTransaction(conn, tx, [from], { commitment: "confirmed" });
}
