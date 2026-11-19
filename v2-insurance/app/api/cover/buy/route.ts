// POST { owner, businessId, peril, marketRef, trigger, premiumUsd, payoutUsd, expiry, monthlyBudgetUsd? }
//   -> { policyId, policyPda, businessPda, txBase64, warnings, instructions }
// Builds an UNSIGNED devnet tx (owner pays fees) for Phantom: [register_business | set_budget]? + buy_policy.
// After the wallet sends it, POST /api/cover/confirm { policyPda, signature } to record it in the feed.
import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { store } from "@/lib/store";
import { coverClient } from "@/lib/solana/policyClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  owner: z.string().min(32).max(44),
  businessId: z.string().min(1).max(100).optional(),
  peril: z.enum(["heat", "cold", "rain", "game", "oil", "gas", "fed", "cpi", "crypto", "other"]).default("other"),
  marketRef: z.string().min(1).refine((s) => Buffer.byteLength(s, "utf8") <= 64, "marketRef must be <= 64 bytes"),
  trigger: z.string().min(1).max(500),
  premiumUsd: z.number().positive(),
  payoutUsd: z.number().positive(),
  expiry: z.union([z.string(), z.number()]), // ISO string or unix seconds
  monthlyBudgetUsd: z.number().positive().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "bad_request" }, { status: 400 });
  const b = parsed.data;
  try {
    const owner = new PublicKey(b.owner);
    const expiry = typeof b.expiry === "number" ? b.expiry : Math.floor(Date.parse(b.expiry) / 1000);
    if (!Number.isFinite(expiry)) return NextResponse.json({ error: "bad expiry", code: "bad_request" }, { status: 400 });
    const r = await coverClient().buildBuyTx({
      owner, peril: b.peril, marketRef: b.marketRef, trigger: b.trigger,
      premiumUsd: b.premiumUsd, payoutUsd: b.payoutUsd, expiry, monthlyBudgetUsd: b.monthlyBudgetUsd,
    });
    store.upsert("policies", {
      id: r.policyPda, policyId: r.policyId, owner: b.owner, businessId: b.businessId ?? null, peril: b.peril,
      marketRef: b.marketRef, trigger: b.trigger, premiumUsd: b.premiumUsd, payoutUsd: b.payoutUsd,
      expiry: new Date(expiry * 1000).toISOString(), status: "pending", createdAt: new Date().toISOString(),
    });
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, code: "cover_build_failed" }, { status: /not initialized/.test(msg) ? 503 : 400 });
  }
}
