// End-to-end driver against a running app (BASE): create a promise, open the counter, issue receipts (incl. Unhedged hero),
// run attacks, then (optionally) wait for settlement and payout. Usage: BASE=http://localhost:5390 npx tsx scripts/e2e.ts [ticker] [symbol...]
import { Keypair } from "@solana/web3.js";
const BASE = process.env.BASE || "http://localhost:5390";
const jars: Record<string, string> = { a: "", b: "" };
async function call<T = any>(path: string, body?: unknown, jar = "a"): Promise<T> {
  const r = await fetch(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie: jars[jar] }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const sc = r.headers.getSetCookie?.() ?? [];
  for (const c of sc) jars[jar] = [jars[jar], c.split(";")[0]].filter(Boolean).join("; ");
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t as any; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(); const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const [ticker, ...strip] = process.argv.slice(2);
const N = Number(process.env.N || 3), CAP = Number(process.env.CAP || 5), TRANCHE = Number(process.env.TRANCHE || 2), REFUND = Number(process.env.REFUND || 0.1);
const card = { event_ticker: ticker, event_title: ticker, strip, sentence: process.env.SENTENCE || "Test promo → $0.10 back", why: "e2e", applies_to: "test" };
const c = await call("/api/promises", { card, cap: CAP, refundUsd: REFUND, topupThreshold: -1, tranche: TRANCHE, testLabel: "E2E TEST", adopt: process.env.ADOPT ? JSON.parse(process.env.ADOPT) : undefined, salesCloseTs: process.env.CLOSE ? Number(process.env.CLOSE) : undefined });
console.log(ts(), "create", c);
if (!c.id) process.exit(1);
for (let i = 0; i < 30; i++) { const v = await call(`/api/promises/${c.id}`); if (v.status === "SELLING") { console.log(ts(), "SELLING, hedged", v.onchain.hedgedCapacity, v.agentNote); break; } if (v.status === "HEDGE_FAILED") { console.log("HEDGE_FAILED", v.agentNote); process.exit(1); } await sleep(1000); }
console.log(ts(), "counters", await call(`/api/promises/${c.id}/action`, { action: "counter" }, "a"), await call(`/api/promises/${c.id}/action`, { action: "counter" }, "b"));
async function scan(holder: Keypair, jar = "a") {
  const code = await call("/api/counter/code", { promiseId: c.id }, jar);
  const tq = Date.now();
  for (let i = 0; i < 30; i++) {
    const r = await call("/api/receipts", { code: code.code, holder: holder.publicKey.toBase58() });
    if (r.ok) return { ...r, ms: Date.now() - tq };
    if (r.error !== "Unhedged" && r.error !== "Busy") return r;
    console.log(ts(), "  ", r.error, "→ retry");
    await sleep(3000);
  }
  return { error: "timeout" };
}
const holders = Array.from({ length: N }, () => Keypair.generate());
// two concurrent scans to exercise the mutex
const firstTwo = await Promise.all(holders.slice(0, 2).map((h, i) => scan(h, i ? "b" : "a")));
console.log(ts(), "concurrent", firstTwo.map((r: any) => r.ok ? `#${r.index}` : r.error));
for (const h of holders.slice(2)) { const r = await scan(h); console.log(ts(), "scan", r.ok ? `#${r.index} in ${r.ms} ms` : r.error); }
for (const n of [2, 3]) console.log(ts(), "attack", n, (await call(`/api/promises/${c.id}/attack`, { n })).error);
console.log(ts(), "codes holders", holders.map((h) => h.publicKey.toBase58()).join(","));
if (process.env.WAIT !== "1") process.exit(0);
for (;;) {
  const v = await call(`/api/promises/${c.id}`);
  console.log(ts(), v.status, "refunded", v.onchain?.refunded, "vault", v.vaultBalance);
  if (v.status === "CLOSED") { console.log(JSON.stringify({ outcome: v.outcome, receipts: v.receipts }, null, 1)); break; }
  await sleep(20000);
}
