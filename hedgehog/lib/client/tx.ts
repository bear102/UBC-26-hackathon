"use client";
// Sign a server-built (possibly desk-partially-signed) tx with the wallet and broadcast it, keeping existing signatures.
import { Connection, Transaction, VersionedTransaction, clusterApiUrl } from "@solana/web3.js";

export type Network = "devnet" | "mainnet";
type Signer = <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;

export const DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
export const MAINNET_RPC = process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL || clusterApiUrl("mainnet-beta");
export const connectionFor = (n: Network) => new Connection(n === "mainnet" ? MAINNET_RPC : DEVNET_RPC, "confirmed");

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeTx(b64: string): Transaction | VersionedTransaction {
  const bytes = b64ToBytes(b64);
  try {
    const v = VersionedTransaction.deserialize(bytes);
    if (v.version !== "legacy") return v;
  } catch { /* fall through to legacy */ }
  return Transaction.from(bytes);
}

export async function signAndSend(
  signTransaction: Signer | undefined, txBase64: string, network: Network,
  onStage?: (s: "signing" | "sending" | "confirming") => void,
): Promise<string> {
  if (!signTransaction) throw new Error("This wallet can't sign transactions. Try Phantom.");
  const tx = decodeTx(txBase64);
  onStage?.("signing");
  const signed = await signTransaction(tx);
  onStage?.("sending");
  const raw = signed instanceof VersionedTransaction ? signed.serialize() : signed.serialize({ requireAllSignatures: true, verifySignatures: false });
  const conn = connectionFor(network);
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
  onStage?.("confirming");
  await waitForConfirm(conn, sig);
  return sig;
}

type SignAll = <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;

/** "Cover all": one wallet approval for several server-built txs (signAllTransactions when the wallet has it,
 *  else one prompt each), then send them IN ORDER, waiting for each (later txs depend on accounts the first creates). */
export async function signAllAndSend(
  signAll: SignAll | undefined, signOne: Signer | undefined, txsBase64: string[], network: Network,
  onStage?: (s: "signing" | "sending" | "confirming", i: number, n: number) => void,
): Promise<string[]> {
  if (!signAll && !signOne) throw new Error("This wallet can't sign transactions. Try Phantom.");
  const txs = txsBase64.map(decodeTx);
  onStage?.("signing", 0, txs.length);
  const signed = signAll ? await signAll(txs) : await (async () => { const out = []; for (const t of txs) out.push(await signOne!(t)); return out; })();
  const conn = connectionFor(network);
  const sigs: string[] = [];
  for (let i = 0; i < signed.length; i++) {
    const t = signed[i];
    onStage?.("sending", i, signed.length);
    const raw = t instanceof VersionedTransaction ? t.serialize() : t.serialize({ requireAllSignatures: true, verifySignatures: false });
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    onStage?.("confirming", i, signed.length);
    await waitForConfirm(conn, sig);
    sigs.push(sig);
  }
  return sigs;
}

async function waitForConfirm(conn: Connection, sig: string, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new Error(`Transaction failed onchain: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for confirmation — check the explorer link.");
}

export function walletErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(m)) return "You cancelled the signature in your wallet.";
  if (/insufficient|0x1\b|lamports/i.test(m)) return `Not enough devnet funds. Hedgehog tops up test dollars automatically; if SOL for fees is short, get some at faucet.solana.com. (${m})`;
  if (/unexpected error|WalletConnectionError|not connected|connection/i.test(m)) return "Your wallet couldn't connect. Unlock Phantom, switch it to Solana Devnet (Settings → Developer Settings → Testnet Mode), close any open Phantom popups, then refresh this page and try again.";
  if (/WalletNotReady|not installed|not found/i.test(m)) return "No Solana wallet found. Install Phantom (phantom.com) or another Solana wallet, then refresh.";
  return m;
}
