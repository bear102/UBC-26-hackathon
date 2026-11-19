// GET ?owner=<pubkey> -> { policies: DecodedPolicy[] } (on-chain, newest first; all policies when owner omitted)
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { store } from "@/lib/store";
import { coverClient } from "@/lib/solana/policyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get("owner") || undefined;
  if (owner) { try { new PublicKey(owner); } catch { return NextResponse.json({ error: "bad owner", code: "bad_request" }, { status: 400 }); } }
  try {
    const onchain = await coverClient().listPolicies(owner);
    const policies = onchain.map((p) => {
      const local = store.get("policies", p.pda) as Record<string, unknown> | undefined;
      return { ...p, businessId: (local?.businessId as string | null) ?? null, trigger: (local?.trigger as string | undefined) ?? null, txSig: (local?.txSig as string | undefined) ?? null };
    });
    return NextResponse.json({ policies });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "rpc_error" }, { status: 502 });
  }
}
