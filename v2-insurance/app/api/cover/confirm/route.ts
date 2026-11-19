// POST { policyPda, signature } -> DecodedPolicy & { backing? }. Verifies the policy exists on-chain, records a feed event.
// A policy written on a Gemini contract is then backed by the desk on Gemini (payout = contracts; dry-run by default).
import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import { coverClient } from "@/lib/solana/policyClient";
import { defaultGetContract } from "@/lib/venue";
import { backConfirmedSale } from "@/lib/venue/geminiHedge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ policyPda: z.string().min(32).max(44), signature: z.string().min(64).max(90) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "body must be { policyPda, signature }", code: "bad_request" }, { status: 400 });
  const { policyPda, signature } = parsed.data;
  try {
    const c = coverClient();
    await c.connection.confirmTransaction(signature, "confirmed").catch(() => undefined);
    let pol = await c.getPolicy(policyPda);
    for (let i = 0; !pol && i < 5; i++) { await new Promise((r) => setTimeout(r, 1500)); pol = await c.getPolicy(policyPda); }
    if (!pol) return NextResponse.json({ error: "policy not found on-chain (tx not landed or failed)", code: "not_found" }, { status: 404 });
    const prev = store.get("policies", policyPda);
    store.upsert("policies", { ...(prev ?? {}), id: policyPda, ...pol, txSig: signature });
    store.feed({
      id: `policy_bought:${policyPda}`,
      source: "program",
      kind: "policy_bought",
      text: `Hedgehog Cover #${pol.policyId}: ${pol.premiumUsd} USDC premium for ${pol.payoutUsd} USDC payout (${pol.peril}, ${pol.marketRef})`,
      txSig: signature,
    });
    const side = prev?.side === "no" ? "no" : "yes";
    const backing = await backConfirmedSale({
      kind: "policy", refId: policyPda, contractId: String(pol.marketRef ?? prev?.marketRef ?? ""), outcome: side,
      quantity: Math.ceil(Number(pol.payoutUsd) - 1e-9), owner: String(prev?.owner ?? pol.owner ?? ""), businessId: (prev?.businessId as string | undefined) ?? undefined,
      soldForUsd: Number(pol.premiumUsd), txSig: signature,
    }, defaultGetContract);
    return NextResponse.json(backing ? { ...pol, backing } : pol);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "cover_confirm_failed" }, { status: 500 });
  }
}
