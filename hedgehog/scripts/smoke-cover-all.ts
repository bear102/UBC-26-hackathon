// "Cover all" smoke test on DEVNET through the HTTP API, with keys/merchant.json as the wallet.
// Picks N live coverable contracts, calls POST /api/cover/buy-plan, signs ALL returned txs with one key (what
// signAllTransactions does in a wallet), sends them in order, then POST /api/cover/confirm for every policy.
// Usage: dev server on :5390, then `npx tsx scripts/smoke-cover-all.ts [n=3] [contracts=3]`.
import fs from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";

const BASE = process.env.BASE_URL || "http://localhost:5390";
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("keys/merchant.json", "utf8"))));
const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const N = Number(process.argv[2] || 3);
const CONTRACTS = Number(process.argv[3] || 3);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 400)}`);
  return JSON.parse(t) as T;
}

type M = { id: string; venue: string; status: string; yesAsk: number | null; expiry: string; peril: string; label: string; eventTitle: string };
const ms = await api<M[]>("/api/markets?venue=gemini,kalshi");
const soon = Date.now() + 2 * 3600_000;
const picks: M[] = [];
const seenEvents = new Set<string>();
for (const m of ms) {
  if (m.status !== "open" || m.yesAsk == null || m.yesAsk < 0.05 || m.yesAsk > 0.6 || Date.parse(m.expiry) < soon) continue;
  if (Buffer.byteLength(m.id) > 64 || seenEvents.has(m.eventTitle)) continue;
  seenEvents.add(m.eventTitle); picks.push(m);
  if (picks.length >= N) break;
}
console.log("owner", owner.publicKey.toBase58());
console.log("picked", picks.map((m) => `${m.venue}:${m.id} @${m.yesAsk}`));

await api("/api/hedge/faucet", { owner: owner.publicKey.toBase58(), needUsd: 50 }).catch((e) => console.warn("faucet:", e.message));

type Plan = { txs: string[]; policies: { index: number; policyId: number; policyPda: string; tx: number; premiumUsd: number; payoutUsd: number }[]; warnings: string[] };
const plan = await api<Plan>("/api/cover/buy-plan", {
  owner: owner.publicKey.toBase58(), businessId: "smoke-cover-all", monthlyBudgetUsd: 500,
  lines: picks.map((m) => ({ marketRef: m.id, side: "yes", contracts: CONTRACTS, trigger: `${m.eventTitle}: ${m.label}`, peril: m.peril })),
});
console.log(`built ${plan.txs.length} tx(s) for ${plan.policies.length} policies; sizes:`, plan.txs.map((b) => Buffer.from(b, "base64").length), "warnings:", plan.warnings);

// sign all first (one approval), then send in order
const signed = plan.txs.map((b64) => { const tx = Transaction.from(Buffer.from(b64, "base64")); tx.partialSign(owner); return tx; });
const sigs: string[] = [];
for (const tx of signed) {
  const sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  await conn.confirmTransaction(sig, "confirmed");
  sigs.push(sig);
  console.log("sent", sig);
}
for (const p of plan.policies) {
  const r = await api<{ policyId: number; status?: string; premiumUsd: number; payoutUsd: number }>("/api/cover/confirm", { policyPda: p.policyPda, signature: sigs[p.tx] });
  console.log(`confirmed policy #${r.policyId} ${p.policyPda} premium ${r.premiumUsd} payout ${r.payoutUsd} (tx ${p.tx + 1})`);
}
console.log("OK: one approval,", plan.txs.length, "tx(s),", plan.policies.length, "policies onchain");
