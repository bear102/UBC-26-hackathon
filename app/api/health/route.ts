// One-stop diagnostics for "nothing happens": open /api/health in a browser on the machine running the app.
import fs from "node:fs";
import path from "node:path";
import { json } from "@/lib/hh/http";
import { env } from "@/lib/hh/env";
import { conn, key, usdcBalance } from "@/lib/hh/chain";
import * as P from "@/lib/hh/program";
import * as G from "@/lib/hh/geminiPrivate";
import { load } from "@/lib/hh/store";
import { liveCapable, hostOf } from "@/lib/hh/venue";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };
async function check(fn: () => Promise<string>): Promise<Check> {
  try { return { ok: true, detail: await fn() }; } catch (e) { return { ok: false, detail: String((e as Error).message ?? e).slice(0, 300) }; }
}
const KEYS = ["merchant", "attestor", "relayer", "crank"] as const;

export async function GET() {
  const c: Record<string, Check> = {};
  c.cwd = { ok: fs.existsSync(path.resolve(process.cwd(), "package.json")), detail: process.cwd() };
  for (const k of KEYS) c[`key_${k}`] = await check(async () => key(k).publicKey.toBase58());
  c.attestor_matches_program = await check(async () => {
    const a = key("attestor").publicKey;
    if (!a.equals(P.ATTESTOR)) throw new Error(`keys/attestor.json is ${a.toBase58()} but the program expects ${P.ATTESTOR.toBase58()}`);
    return "ok";
  });
  c.relayer_matches_program = await check(async () => {
    const a = key("relayer").publicKey;
    if (!a.equals(P.RELAYER)) throw new Error(`keys/relayer.json is ${a.toBase58()} but the program expects ${P.RELAYER.toBase58()}`);
    return "ok";
  });
  c.rpc = await check(async () => `${env.rpc()} slot ${await conn().getSlot()}`);
  c.program = await check(async () => {
    const a = await conn().getAccountInfo(P.PROGRAM_ID);
    if (!a?.executable) throw new Error(`program ${P.PROGRAM_ID.toBase58()} not found on ${env.rpc()}`);
    return P.PROGRAM_ID.toBase58();
  });
  for (const k of KEYS) c[`sol_${k}`] = await check(async () => {
    const pk = key(k).publicKey;
    const b = (await conn().getBalance(pk)) / 1e9;
    if (b < 0.01) throw new Error(`${b} SOL: fund ${pk.toBase58()} at faucet.solana.com`);
    return `${b} SOL`;
  });
  c.usdc_merchant = await check(async () => {
    const pk = key("merchant").publicKey;
    const b = await usdcBalance(pk);
    if (!b) throw new Error(`no devnet USDC: faucet.circle.com → Solana Devnet → ${pk.toBase58()}`);
    return `$${b}`;
  });
  c.gemini_public = await check(async () => {
    const r = await fetch(`${env.geminiPublic()}/v1/prediction-markets/events?status=active&limit=1`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return hostOf(env.geminiPublic());
  });
  c.gemini_trading = { ok: true, detail: liveCapable() ? `live trading enabled on ${hostOf(env.geminiTrade())} (where listed)` : "no keys A+B (or HEDGE_MODE=paper): every promise is PAPER" };
  if (G.hasKeys("A")) c.gemini_key_A = await check(async () => { await G.balances("A"); return "balances 200"; });
  if (G.hasKeys("B")) c.gemini_key_B = await check(async () => { await G.positions("B"); return "positions 200"; });
  c.llm = { ok: true, detail: process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.GOOGLE_API_KEY ? "google" : "none (template cards)" };
  c.store = await check(async () => { const s = load(); return `${Object.keys(s.promises).length} promises; last log: ${s.log.at(-1)?.msg ?? "-"}`; });
  const w = !!(globalThis as unknown as { __hhWorker?: boolean }).__hhWorker;
  c.worker = { ok: w, detail: w ? "running in this process" : "not started: check the server console for 'worker started' (instrumentation.ts)" };
  const local = /localhost|127\.0\.0\.1/.test(env.publicUrl());
  c.public_url = { ok: !local, detail: `${env.publicUrl()}${local ? ": phones can't open QR links to localhost; set PUBLIC_URL to your ngrok URL (tunnel to port 5380)" : ""}` };
  return json({ ok: Object.values(c).every((x) => x.ok), checks: c });
}
