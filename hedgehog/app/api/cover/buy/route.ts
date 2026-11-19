// POST { owner, businessId?, peril?, marketRef, side?, contracts? | payoutUsd, trigger, premiumUsd?, monthlyBudgetUsd? }
//   -> { policyId, policyPda, businessPda, txBase64, warnings, instructions, quoteExpiresAt, pricing }
// Builds a devnet tx (owner pays fees) for Phantom: [register_business | set_budget]? + buy_policy.
// Hedgehog prices the policy from the LIVE market (never from the client): payout = contracts × $1,
// premium = contracts × ask + Hedgehog fee, expiry = market expiry + resolution buffer. The attestor co-signs as the
// program's "quoter" (docs/FLOW-AUDIT.md F1), so the quote is only valid until the blockhash expires (~60-90 s).
// `premiumUsd` (optional) is what the owner was shown: if the market price moved above it we refuse (409 price_moved).
// After the wallet sends it, POST /api/cover/confirm { policyPda, signature }.
import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { store } from "@/lib/store";
import { isCoverable } from "@/lib/markets/quote";
import { ALL_PERILS } from "@/lib/types";
import { coverClient, loadKeypair } from "@/lib/solana/policyClient";
import { defaultGetContract, VenueError } from "@/lib/venue";
import { errorResponse } from "@/lib/venue/http";
import { priceBuy } from "@/lib/venue/pricing";
import { checkBacking, checkPriceMoved } from "@/lib/venue/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Policies stay open this long past the market's expiry so the crank can settle from the official resolution
 *  before anyone can call expire_policy (refund). */
const RESOLUTION_BUFFER_H = () => Number(process.env.COVER_RESOLUTION_BUFFER_H) || 48;

const Body = z.object({
  owner: z.string().min(32).max(44),
  businessId: z.string().min(1).max(100).optional(),
  peril: z.enum(ALL_PERILS).optional(),
  marketRef: z.string().min(1).refine((s) => Buffer.byteLength(s, "utf8") <= 64, "marketRef must be <= 64 bytes"),
  trigger: z.string().min(1).max(500),
  side: z.enum(["yes", "no"]).default("yes"), // which outcome of marketRef pays the policy
  contracts: z.number().int().min(1).max(10_000).optional(),
  payoutUsd: z.number().positive().optional(), // legacy alias: contracts = round(payoutUsd)
  premiumUsd: z.number().positive().optional(), // what the UI showed (price-moved guard), never charged as-is
  expiry: z.union([z.string(), z.number()]).optional(), // ignored: the market's expiry is used
  monthlyBudgetUsd: z.number().positive().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "bad_request" }, { status: 400 });
  const b = parsed.data;
  try {
    let owner: PublicKey;
    try { owner = new PublicKey(b.owner); } catch { throw new VenueError("invalid owner pubkey"); }
    const contracts = b.contracts ?? Math.round(b.payoutUsd ?? 0);
    if (!(contracts >= 1)) throw new VenueError("contracts (or payoutUsd) must be >= 1");
    const contract = await defaultGetContract(b.marketRef);
    if (!contract) throw new VenueError(`unknown market ${b.marketRef}`, 404, "not_found");
    if (!isCoverable(contract)) throw new VenueError(`${contract.venue} markets are read-only context (cannot price cover)`, 400, "not_tradable");
    const price = priceBuy(contract, b.side, contracts); // open, not expired, ask <= MAX_ASK, fee applied
    checkPriceMoved(price.marketCostUsd, b.premiumUsd);
    checkBacking(contract.id);
    if (price.costUsd > contracts) throw new VenueError("premium would exceed payout", 400, "bad_price");
    const marketExpiry = Math.floor(Date.parse(contract.expiry) / 1000);
    if (!Number.isFinite(marketExpiry)) throw new VenueError(`market ${contract.id} has no expiry`, 400, "bad_market");
    const expiry = marketExpiry + RESOLUTION_BUFFER_H() * 3600;

    const r = await coverClient().buildBuyTx({
      owner, peril: b.peril ?? contract.peril, marketRef: contract.id, trigger: b.trigger,
      premiumUsd: price.costUsd, payoutUsd: contracts, expiry, monthlyBudgetUsd: b.monthlyBudgetUsd,
      quoter: loadKeypair("attestor"),
    });
    store.upsert("policies", {
      id: r.policyPda, policyId: r.policyId, owner: b.owner, businessId: b.businessId ?? null, peril: b.peril ?? contract.peril,
      marketRef: contract.id, trigger: b.trigger, premiumUsd: price.costUsd, payoutUsd: contracts, side: b.side,
      marketCostUsd: price.marketCostUsd, feeUsd: price.feeUsd, ask: price.ask,
      expiry: new Date(expiry * 1000).toISOString(), marketExpiry: contract.expiry, status: "pending", createdAt: new Date().toISOString(),
    });
    return NextResponse.json({
      ...r,
      premiumUsd: price.costUsd, payoutUsd: contracts,
      pricing: { ask: price.ask, contracts, marketCostUsd: price.marketCostUsd, feeUsd: price.feeUsd, feeBps: price.feeBps, premiumUsd: price.costUsd },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not initialized/.test(msg)) return NextResponse.json({ error: msg, code: "cover_build_failed" }, { status: 503 });
    if (e instanceof VenueError) return errorResponse(e);
    return NextResponse.json({ error: msg, code: "cover_build_failed" }, { status: 400 });
  }
}
