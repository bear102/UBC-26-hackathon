// End-to-end smoke test through the HTTP API (what the UI does), with keys/merchant.json as the wallet.
// Usage: dev server on :5390, then `npx tsx scripts/smoke-api.ts [presetId]`. DEVNET only.
import fs from "node:fs";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";

const BASE = process.env.BASE_URL || "http://localhost:5390";
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("keys/merchant.json", "utf8"))));
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const presetId = process.argv[2] || "rainey-patio-bar";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t) as T;
}

async function signSend(b64: string): Promise<string> {
  const raw = Buffer.from(b64, "base64");
  let sig: string;
  try {
    const vtx = VersionedTransaction.deserialize(raw);
    vtx.sign([owner]);
    sig = await conn.sendRawTransaction(vtx.serialize());
  } catch {
    const tx = Transaction.from(raw);
    tx.partialSign(owner);
    sig = await conn.sendRawTransaction(tx.serialize());
  }
  for (let i = 0; i < 40; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s?.err) throw new Error(`tx failed ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("confirm timeout " + sig);
}

const presets = await api<any[]>("/api/presets");
const preset = presets.find((p) => p.id === presetId)!;
console.log("owner", owner.publicKey.toBase58(), "preset", preset.name);
console.log("faucet", await api("/api/hedge/faucet", { owner: owner.publicKey.toBase58() }));

const t0 = Date.now();
const quote = await api<any>("/api/advise", { profile: preset, coveragePct: 25 });
console.log(`advise ${(Date.now() - t0) / 1000}s model=${quote.model} lines=${quote.lines.length} premium=$${quote.totalPremiumUsd} payout=$${quote.totalPayoutUsd}`);
for (const l of quote.lines) console.log("  ", l.action, l.contractId, l.side, "x" + l.contracts, "$" + l.premiumUsd, l.crossCheck ? `| Polymarket ${Math.round(l.crossCheck.prob * 100)}%` : "");

// Prefer a Gemini line ("sold on Solana, hedged on Gemini"); fall back to any buyable line.
const buyable = quote.lines.filter((l: any) => l.action === "buy-onchain" && l.contracts > 0);
const line = buyable.find((l: any) => l.contract.venue === "gemini") ?? buyable[0];
if (line) {
  const small = Math.max(1, Math.min(line.contracts, 5));
  const b = await api<any>("/api/hedge/buy", { owner: owner.publicKey.toBase58(), contractId: line.contractId, side: line.side, contracts: small, businessId: preset.id });
  const sig = await signSend(b.txBase64);
  const pos = await api<any>("/api/hedge/confirm", { positionId: b.positionId, signature: sig });
  console.log("hedge bought", line.contract.venue, pos.status, pos.contracts, "tokens, tx", sig);
  if (pos.backing) console.log("desk backing:", pos.backing.mode, pos.backing.status, pos.backing.symbol, pos.backing.outcome, "x" + pos.backing.quantity, "@", pos.backing.limitPrice);
} else console.log("no buy-onchain line in quote");

const any = line ?? quote.lines.find((l: any) => l.action !== "read-only");
if (any) {
  const c = await api<any>("/api/cover/buy", {
    owner: owner.publicKey.toBase58(), businessId: preset.id, peril: any.contract.peril, marketRef: any.contractId,
    trigger: quote.risks.find((r: any) => r.id === any.riskId)?.trigger ?? any.contract.label,
    premiumUsd: 1, payoutUsd: 3, expiry: any.contract.expiry, side: any.side,
  });
  if (c.warnings?.length) console.log("cover warnings", c.warnings);
  const sig = await signSend(c.txBase64);
  const conf = await api<any>("/api/cover/confirm", { policyPda: c.policyPda, signature: sig });
  console.log("cover bought", c.policyPda, "tx", sig);
  if (conf.backing) console.log("cover backing:", conf.backing.mode, conf.backing.status, conf.backing.symbol, conf.backing.outcome, "x" + conf.backing.quantity, "@", conf.backing.limitPrice);
}
const pols = await api<any>(`/api/cover/policies?owner=${owner.publicKey.toBase58()}`);
console.log("policies", (pols.policies ?? pols).length, "positions", (await api<any[]>(`/api/positions?owner=${owner.publicKey.toBase58()}`)).length);
console.log("backing", (await api<any>(`/api/hedge/backing?owner=${owner.publicKey.toBase58()}`)).hedges.length);
console.log("feed tail", (await api<any[]>("/api/feed")).slice(-6).map((e) => `${e.source}:${e.kind} ${e.text}`));
