// GET -> { programId, underwriterPda, vault, vaultBalance, exposure, maxExposure, freeCapacity, mint, attestor, ... }
import { NextResponse } from "next/server";
import { coverClient } from "@/lib/solana/policyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ network: "devnet", ...(await coverClient().info()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "rpc_error" }, { status: 502 });
  }
}
