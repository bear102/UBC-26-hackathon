"use client";
// Browser-side helpers: customer keypair in localStorage, spend/cash-out via merchant co-sign, Verify with Gemini.
import { Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { canonicalResolution, sha256Hex } from "./canon";

export type Config = { programId: string; usdcMint: string; rpc: string; publicUrl: string; merchant: string; hedgeMode: "live" | "paper"; cluster: string };

export async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && (j as { error?: string }).error && !(j as { ok?: boolean }).hasOwnProperty("ok")) throw new Error((j as { error: string }).error);
  return j as T;
}
export const post = <T,>(url: string, body: unknown) => getJSON<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const KP = "hh.kp";
export function getKeypair(): Keypair {
  try {
    const h = typeof location !== "undefined" ? location.hash : "";
    const m = h.match(/sk=([1-9A-HJ-NP-Za-km-z]+)/);
    if (m) { const kp = Keypair.fromSecretKey(bs58.decode(m[1])); localStorage.setItem(KP, m[1]); return kp; }
    const s = localStorage.getItem(KP);
    if (s) return Keypair.fromSecretKey(bs58.decode(s));
  } catch { /* fall through */ }
  const kp = Keypair.generate();
  try { localStorage.setItem(KP, bs58.encode(kp.secretKey)); } catch { /* private mode */ }
  return kp;
}
export const secretB58 = (kp: Keypair) => bs58.encode(kp.secretKey);

/** Spend (to the merchant) or cash out (any address). The merchant pays the fee via /api/cosign. */
export async function sendUsdc(cfg: Config, kp: Keypair, to: string, amountUsd: number): Promise<string> {
  const conn = new Connection(cfg.rpc, "confirmed");
  const mint = new PublicKey(cfg.usdcMint);
  const merchant = new PublicKey(cfg.merchant);
  const dest = new PublicKey(to);
  const toMerchant = dest.equals(merchant);
  const src = getAssociatedTokenAddressSync(mint, kp.publicKey, true);
  const dAta = getAssociatedTokenAddressSync(mint, dest, true);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: merchant, recentBlockhash: blockhash });
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }));
  if (!toMerchant) tx.add(createAssociatedTokenAccountIdempotentInstruction(merchant, dAta, dest, mint));
  tx.add(createTransferCheckedInstruction(src, mint, dAta, kp.publicKey, BigInt(Math.round(amountUsd * 1e6)), 6));
  tx.partialSign(kp);
  const r = await post<{ ok: boolean; sig?: string; error?: string }>("/api/cosign", { tx: tx.serialize({ requireAllSignatures: false }).toString("base64") });
  if (!r.ok) throw new Error(r.error || "co-sign failed");
  return r.sig!;
}

export type VerifyTick = { label: string; ok: boolean | null; detail?: string };
type Ev = { ticker: string; status: string; resolvedAt?: string | null; contracts: { instrumentSymbol: string; label?: string; resolutionSide?: string | null }[] };

/** Re-derive the outcome in the browser (§6.5): fetch Gemini, hash, compare to onchain fields. */
export async function verify(p: { id: string; card: { event_ticker: string; strip: string[] }; onchain: { status: string; outcomeHash: string; winningSymbol: string; strip: string[]; refunded: number } | null }): Promise<{ ticks: VerifyTick[]; source: string }> {
  let ev: Ev | null = null; let source = "Gemini (live, from your browser)";
  for (let i = 0; i < 3 && !ev; i++) {
    try {
      const r = await fetch(`https://api.gemini.com/v1/prediction-markets/events/${encodeURIComponent(p.card.event_ticker)}`, { cache: "no-store" });
      if (r.ok) ev = await r.json();
    } catch { /* retry */ }
  }
  if (!ev) {
    const r = await fetch(`/p/${p.id}/event.json`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); ev = j.event; source = `Gemini unreachable; checked against the copy fetched at ${new Date(j.fetchedAt).toLocaleString()}`; }
  }
  const ticks: VerifyTick[] = [];
  if (!ev) return { ticks: [{ label: "Could not reach Gemini", ok: false }], source };
  if (ev.status !== "settled") return { ticks: [{ label: `Gemini says: not settled yet (${ev.status})`, ok: null }], source };
  const yesC = ev.contracts.find((c) => c.resolutionSide === "yes");
  ticks.push({ label: `Gemini says: ${yesC ? `${yesC.label ?? yesC.instrumentSymbol} YES` : "no contract resolved YES"}`, ok: true, detail: yesC?.instrumentSymbol });
  const hash = await sha256Hex(canonicalResolution(ev));
  const oc = p.onchain;
  ticks.push({ label: `Hash matches onchain ${hash.slice(0, 4)}…${hash.slice(-4)}`, ok: !!oc && oc.outcomeHash === hash, detail: oc ? `onchain ${oc.outcomeHash}` : "no onchain account" });
  const geminiYes = p.card.strip.some((s) => ev!.contracts.find((c) => c.instrumentSymbol === s)?.resolutionSide === "yes");
  const chainYes = !!oc && (oc.status === "SETTLED_YES" || oc.refunded > 0 || (oc.status === "CLOSED" && !!oc.winningSymbol));
  ticks.push({ label: `Gemini's outcome matches the promise (${geminiYes ? "customers paid" : "no refund"})`, ok: geminiYes === chainYes });
  ticks.push({ label: "Your receipt's contract set is the promise strip", ok: !!oc && JSON.stringify(oc.strip) === JSON.stringify(p.card.strip) });
  return { ticks, source };
}

export const short = (s: string, n = 4) => (s && s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const ex = (sig: string, kind: "tx" | "address" = "tx") => `https://explorer.solana.com/${kind}/${sig}?cluster=devnet`;
export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
