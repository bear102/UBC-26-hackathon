// Live devnet demo of Hedgehog parametric cover, through the HTTP API (what the UI does), keys/merchant.json as wallet:
//   1. buy a small Cover policy on a hedgehog:* contract (default: hail >= 1" within 25 mi of Austin, next 5 days)
//   2. force the resolution with the dev override (.data/parametric-overrides.json)
//   3. run one settlement crank pass (same code as `npm run worker`) -> settle_policy pays the owner from the vault
// Usage: dev server on :5390, then `npx tsx scripts/demo-parametric.ts [contractId] [contracts]`. DEVNET only.
import "../lib/env";
import fs from "node:fs";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { addDaysYmd, todayCentral, parseParametricId } from "../lib/markets/parametric/common";
import { writeOverride } from "../lib/markets/parametric/settle";
import { coverCrank, runOnce } from "./worker";

const BASE = process.env.BASE_URL || "http://localhost:5390";
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("keys/merchant.json", "utf8"))));
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const t = todayCentral();
const id = process.argv[2] || `hedgehog:hail:austin-tx:25:${t.replace(/-/g, "")}-${addDaysYmd(t, 4).replace(/-/g, "")}`;
const contracts = Number(process.argv[3]) || 20;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const txt = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${txt.slice(0, 300)}`);
  return JSON.parse(txt) as T;
}

async function signSend(b64: string): Promise<string> {
  const raw = Buffer.from(b64, "base64");
  let sig: string;
  try { const v = VersionedTransaction.deserialize(raw); v.sign([owner]); sig = await conn.sendRawTransaction(v.serialize()); }
  catch { const tx = Transaction.from(raw); tx.partialSign(owner); sig = await conn.sendRawTransaction(tx.serialize()); }
  for (let i = 0; i < 40; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s?.err) throw new Error(`tx failed ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`confirm timeout ${sig}`);
}

async function main() {
  if (!parseParametricId(id)) throw new Error(`not a hedgehog:* id: ${id}`);
  const peril = ({ flood: "flood", aqi: "smoke", hail: "hail", wildfire: "wildfire" } as const)[parseParametricId(id)!.kind];
  console.log(`contract ${id} (${peril}), ${contracts} contracts, owner ${owner.publicKey.toBase58()}`);
  const q = await api<any>("/api/cover/buy", { owner: owner.publicKey.toBase58(), businessId: "parametric-demo", peril, marketRef: id, side: "yes", trigger: `Hedgehog parametric: ${id}`, contracts });
  console.log(`quoted: $${q.premiumUsd} premium for $${q.payoutUsd} payout (ask ${q.pricing.ask})${q.warnings?.length ? ` warnings: ${q.warnings.join("; ")}` : ""}`);
  const buySig = await signSend(q.txBase64);
  const conf = await api<any>("/api/cover/confirm", { policyPda: q.policyPda, signature: buySig });
  console.log(`bought policy #${conf.policyId} ${q.policyPda} tx ${buySig} | backing: ${conf.backing ? JSON.stringify(conf.backing) : "none (Hedgehog pool)"}`);

  writeOverride(id, "yes");
  console.log("dev override: forced YES");
  // one crank pass (same code as `npm run worker`), Cover side limited to this demo policy
  const cc = await coverCrank();
  if (!cc) throw new Error("cover crank unavailable (underwriter not initialized?)");
  const cover = { ...cc, listOpen: async () => (await cc.listOpen()).filter((p) => p.pda === q.policyPda) };
  const r = await runOnce({ cover, log: (s) => console.log(`[crank] ${s}`) });
  console.log(`crank: policies settled=${r.policiesSettled} errors=${r.errors.length}${r.errors.length ? ` ${r.errors.join(" | ")}` : ""}`);
  writeOverride(id, null); // keep the shared contract quotable for everyone else
  const pols = await api<any>(`/api/cover/policies?owner=${owner.publicKey.toBase58()}`);
  const mine = (pols.policies ?? pols).find?.((p: any) => (p.pda ?? p.id) === q.policyPda);
  console.log("policy now:", JSON.stringify(mine ? { status: mine.status, payoutUsd: mine.payoutUsd, settleTxSig: mine.settleTxSig } : mine));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
