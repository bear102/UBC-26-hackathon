// GET -> { programId, underwriterPda, vault, vaultBalance, exposure, maxExposure, freeCapacity, mint, attestor, ..., test }
// vaultBalance / exposure / policiesSold are the onchain truth (never reduced). `test` says how much of that is test
// policies (lib/visibility.ts), so the UI can show "N policies (M test)" without misstating reserves.
import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { coverClient } from "@/lib/solana/policyClient";
import { summarizeTestPolicies } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const c = coverClient();
    const info = await c.info();
    const test = info.initialized
      ? await c.listPolicies().then((rows) => summarizeTestPolicies(rows, (pda) => store.get("policies", pda)?.businessId as string | undefined)).catch(() => null)
      : null;
    return NextResponse.json({ network: "devnet", ...info, test });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "rpc_error" }, { status: 502 });
  }
}
