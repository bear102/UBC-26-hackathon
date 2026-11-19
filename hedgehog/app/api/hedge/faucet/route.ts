// POST { owner } -> { minted, usd, solSent, sigs } — DEVNET demo faucet. Works only when the settlement mint
// (USDC_MINT) is a test dollar whose mint authority is the desk (e.g. the e2e test mint in .data/e2e-test-usdc.json).
// Tops the wallet up to max($500, 1.2 × needUsd + $10) test USD and, if it has < 0.01 SOL, sends 0.02 devnet SOL for fees.
import { NextResponse } from "next/server";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { env } from "@/lib/env";
import { getConnection } from "@/lib/solana/connection";
import { deskKeypair } from "@/lib/venue/desk";
import { sendAndPoll } from "@/lib/venue/tx";
import { VenueError } from "@/lib/venue/types";
import { errorResponse } from "@/lib/venue/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MIN_TARGET_USD = 500;   // devnet test dollars: enough for any demo quote
const MAX_TARGET_USD = 20_000; // sanity cap on a single top-up

export async function POST(req: Request) {
  try {
    if (env.venue() !== "mock") throw new VenueError("faucet is devnet-only", 403, "forbidden");
    const body = (await req.json().catch(() => ({}))) as { owner?: string; needUsd?: number };
    const need = Number(body.needUsd);
    const TARGET_USD = Math.min(MAX_TARGET_USD, Math.max(MIN_TARGET_USD, Number.isFinite(need) && need > 0 ? Math.ceil(need * 1.2 + 10) : 0));
    let owner: PublicKey;
    try { owner = new PublicKey(body.owner ?? ""); } catch { throw new VenueError("invalid owner pubkey"); }
    const conn = getConnection("devnet");
    const desk = deskKeypair();
    const mint = new PublicKey(env.usdcMint());
    const m = await getMint(conn, mint, "confirmed");
    if (!m.mintAuthority?.equals(desk.publicKey)) throw new VenueError("USDC_MINT is not the desk's test dollar; use faucet.circle.com for devnet USDC", 409, "not_test_mint");
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const have = await getAccount(conn, ata, "confirmed").then((a) => a.amount).catch(() => 0n);
    const target = BigInt(TARGET_USD) * 10n ** BigInt(m.decimals);
    const tx = new Transaction();
    const minted = have < target ? target - have : 0n;
    if (minted > 0n) tx.add(createAssociatedTokenAccountIdempotentInstruction(desk.publicKey, ata, owner, mint), createMintToInstruction(mint, ata, desk.publicKey, minted));
    const lamports = await conn.getBalance(owner);
    const solSent = lamports < 0.01 * LAMPORTS_PER_SOL;
    if (solSent) tx.add(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: owner, lamports: 0.02 * LAMPORTS_PER_SOL }));
    const sig = tx.instructions.length ? await sendAndPoll(conn, tx, [desk]) : null;
    return NextResponse.json({ minted: Number(minted) / 10 ** m.decimals, usd: TARGET_USD, solSent, sig });
  } catch (e) {
    return errorResponse(e);
  }
}
