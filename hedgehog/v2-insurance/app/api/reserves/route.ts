// GET -> proof of reserves: what Hedgehog owes in the worst case vs what it holds, all on Solana devnet.
//   cover:  underwriter vault balance vs on-chain total exposure (the program enforces exposure <= vault per sale)
//   tokens: desk wallet balance vs worst-case $1 × open outcome tokens it sold (ledger in lib/venue/risk.ts; caps)
//   backing: Gemini backing orders (dry-run unless HEDGE_LIVE=1) vs Gemini-priced exposure, and any unbacked sales
//   pricing: Hedgehog fee (HEDGEHOG_FEE_BPS) on top of the market price
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { env } from "@/lib/env";
import { store } from "@/lib/store";
import { coverClient } from "@/lib/solana/policyClient";
import { getConnection } from "@/lib/solana/connection";
import { deskKeypair } from "@/lib/venue/desk";
import { liveEnabled } from "@/lib/venue/geminiHedge";
import { feeBps } from "@/lib/venue/pricing";
import { deskExposure, deskLimits } from "@/lib/venue/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const r2 = (x: number) => Math.round(x * 100) / 100;

export async function GET() {
  const out: Record<string, unknown> = { network: "devnet", at: new Date().toISOString() };
  try {
    const i = await coverClient().info();
    out.cover = i.initialized
      ? { program: i.programId, vault: i.vault, vaultUsd: i.vaultBalance, exposureUsd: i.exposure, freeUsd: i.freeCapacity, maxExposureUsd: i.maxExposure,
          coverageRatio: i.exposure ? r2((i.vaultBalance ?? 0) / i.exposure) : null, policiesSold: i.policiesSold, enforcedOnChain: true }
      : { initialized: false };
  } catch (e) { out.cover = { error: (e as Error).message }; }

  const exp = deskExposure();
  const tokens: Record<string, unknown> = { exposureUsd: exp.totalUsd, openPositions: exp.openPositions, pendingPositions: exp.pendingPositions, limits: deskLimits(), byContract: exp.byContract };
  try {
    const conn = getConnection("devnet");
    const desk = deskKeypair().publicKey;
    const mint = new PublicKey(env.usdcMint());
    const m = await getMint(conn, mint, "confirmed");
    const bal = await getAccount(conn, getAssociatedTokenAddressSync(mint, desk), "confirmed").then((a) => Number(a.amount) / 10 ** m.decimals).catch(() => 0);
    const mintsTestDollar = !!m.mintAuthority?.equals(desk);
    Object.assign(tokens, {
      desk: desk.toBase58(), deskUsd: r2(bal), coverageRatio: exp.totalUsd ? r2(bal / exp.totalUsd) : null,
      note: mintsTestDollar ? "devnet test dollar: the desk is its mint authority and mints any shortfall at payout" : "desk must hold >= exposure; a short desk pauses payouts (crank retries)",
    });
  } catch (e) { tokens.error = (e as Error).message; }
  out.tokens = tokens;

  const hedges = store.list("hedges");
  const geminiExposure = store.list("positions").filter((p) => p.network === "devnet" && p.txSig && (p.status === "open" || p.status === "won") && p.contractId.startsWith("gemini:")).reduce((s, p) => s + p.contracts, 0);
  out.backing = {
    mode: liveEnabled() ? "live" : "dry-run",
    orders: hedges.length,
    plannedContracts: hedges.filter((h) => h.status !== "error").reduce((s, h) => s + h.quantity, 0),
    unbacked: hedges.filter((h) => ["error", "rejected", "partial"].includes(h.status)).map((h) => ({ id: h.id, contractId: h.contractId, status: h.status, error: h.error })),
    geminiTokenExposure: geminiExposure,
  };
  out.pricing = { feeBps: feeBps(), formula: "premium = contracts × live ask (rounded up to cents) + Hedgehog fee" };
  return NextResponse.json(out);
}
