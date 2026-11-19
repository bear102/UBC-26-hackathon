// POST { owner, businessId?, monthlyBudgetUsd?, lines: [{ marketRef, side?, contracts, trigger, premiumUsd?, peril? }] }
//   -> { txs: base64[], policies: [{ index, policyId, policyPda, tx, marketRef, premiumUsd, payoutUsd }], warnings, quoteExpiresAt }
// "Cover all": one wallet approval (signAllTransactions) for every line of a plan. Each line is priced from the LIVE market
// exactly like /api/cover/buy (priceBuy, price-moved guard, backing check). Up to 3 policies per tx; the client sends
// the txs IN ORDER, then calls /api/cover/confirm { policyPda, signature } for each policy with its tx's signature.
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

const RESOLUTION_BUFFER_H = () => Number(process.env.COVER_RESOLUTION_BUFFER_H) || 48;

const Line = z.object({
  marketRef: z.string().min(1).refine((s) => Buffer.byteLength(s, "utf8") <= 64, "marketRef must be <= 64 bytes"),
  side: z.enum(["yes", "no"]).default("yes"),
  contracts: z.number().int().min(1).max(10_000),
  trigger: z.string().min(1).max(500),
  premiumUsd: z.number().positive().optional(),
  peril: z.enum(ALL_PERILS).optional(),
});
const Body = z.object({
  owner: z.string().min(32).max(44),
  businessId: z.string().min(1).max(100).optional(),
  monthlyBudgetUsd: z.number().positive().optional(),
  lines: z.array(Line).min(1).max(9),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), code: "bad_request" }, { status: 400 });
  const b = parsed.data;
  try {
    let owner: PublicKey;
    try { owner = new PublicKey(b.owner); } catch { throw new VenueError("invalid owner pubkey"); }
    const priced: { l: z.infer<typeof Line>; contract: NonNullable<Awaited<ReturnType<typeof defaultGetContract>>>; price: ReturnType<typeof priceBuy>; expiry: number }[] = [];
    for (const [i, l] of b.lines.entries()) {
      const tag = `line ${i + 1} (${l.marketRef})`;
      const contract = await defaultGetContract(l.marketRef);
      if (!contract) throw new VenueError(`${tag}: unknown market`, 404, "not_found");
      if (!isCoverable(contract)) throw new VenueError(`${tag}: ${contract.venue} markets are read-only context`, 400, "not_tradable");
      try {
        const price = priceBuy(contract, l.side, l.contracts);
        checkPriceMoved(price.marketCostUsd, l.premiumUsd);
        checkBacking(contract.id);
        if (price.costUsd > l.contracts) throw new VenueError("premium would exceed payout", 400, "bad_price");
        const marketExpiry = Math.floor(Date.parse(contract.expiry) / 1000);
        if (!Number.isFinite(marketExpiry)) throw new VenueError("market has no expiry", 400, "bad_market");
        priced.push({ l, contract, price, expiry: marketExpiry + RESOLUTION_BUFFER_H() * 3600 });
      } catch (e) {
        if (e instanceof VenueError) throw new VenueError(`${tag}: ${e.message}`, e.status, e.code);
        throw e;
      }
    }

    const r = await coverClient().buildBuyBatchTxs({
      owner, monthlyBudgetUsd: b.monthlyBudgetUsd, quoter: loadKeypair("attestor"),
      items: priced.map(({ l, contract, price, expiry }) => ({
        peril: l.peril ?? contract.peril, marketRef: contract.id, trigger: l.trigger, premiumUsd: price.costUsd, payoutUsd: l.contracts, expiry,
      })),
    });
    const now = new Date().toISOString();
    const policies = r.policies.map((p) => {
      const { l, contract, price, expiry } = priced[p.index];
      store.upsert("policies", {
        id: p.policyPda, policyId: p.policyId, owner: b.owner, businessId: b.businessId ?? null, peril: l.peril ?? contract.peril,
        marketRef: contract.id, trigger: l.trigger, premiumUsd: price.costUsd, payoutUsd: l.contracts, side: l.side,
        marketCostUsd: price.marketCostUsd, feeUsd: price.feeUsd, ask: price.ask,
        expiry: new Date(expiry * 1000).toISOString(), marketExpiry: contract.expiry, status: "pending", createdAt: now,
      });
      return { ...p, marketRef: contract.id, premiumUsd: price.costUsd, payoutUsd: l.contracts };
    });
    return NextResponse.json({ txs: r.txs, policies, warnings: r.warnings, quoteExpiresAt: r.quoteExpiresAt, businessPda: r.businessPda });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not initialized/.test(msg)) return NextResponse.json({ error: msg, code: "cover_build_failed" }, { status: 503 });
    if (/BudgetExceeded|InsufficientCapacity/.test(msg)) return NextResponse.json({ error: msg, code: /Budget/.test(msg) ? "budget_exceeded" : "insufficient_capacity" }, { status: 409 });
    if (e instanceof VenueError) return errorResponse(e);
    return NextResponse.json({ error: msg, code: "cover_build_failed" }, { status: 400 });
  }
}
