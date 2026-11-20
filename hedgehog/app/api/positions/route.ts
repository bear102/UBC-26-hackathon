// GET ?owner=<pubkey> (required)[&businessId=] -> (Position & { markPrice, markValueUsd, pnlUsd, contract })[]
import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import type { MarketContract } from "@/lib/types";
import { defaultGetContract } from "@/lib/venue";
import { markFor } from "@/lib/venue/pricing";
import { isTestRecord } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const owner = u.searchParams.get("owner");
  const businessId = u.searchParams.get("businessId");
  if (!owner) return NextResponse.json({ error: "owner is required", code: "bad_request" }, { status: 400 });
  const rows = store.list("positions")
    .filter((p) => p.owner === owner && (!businessId || p.businessId === businessId))
    .filter((p) => !isTestRecord(p, owner)) // test / e2e / parametric rows (lib/visibility.ts); an owner always sees their own
    .filter((p) => p.txSig || Date.now() - Date.parse(p.createdAt) < 10 * 60_000) // hide abandoned unsigned buys
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ids = [...new Set(rows.map((p) => p.contractId))];
  const contracts = new Map<string, MarketContract | null>(
    await Promise.all(ids.map(async (id) => [id, await Promise.race([
      defaultGetContract(id).catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ])] as const)),
  );
  const out = rows.map((p) => {
    const c = contracts.get(p.contractId) ?? null;
    const markPrice = p.voided ? null : p.status === "redeemed" || p.status === "won" ? 1 : p.status === "lost" ? 0 : c ? markFor(c, p.side) : null;
    const markValueUsd = markPrice == null ? null : Math.round(markPrice * p.contracts * 100) / 100;
    const contract = c && { id: c.id, venue: c.venue, eventTitle: c.eventTitle, label: c.label, status: c.status, resolution: c.resolution ?? null, expiry: c.expiry, url: c.url };
    return { ...p, markPrice, markValueUsd, pnlUsd: markValueUsd == null ? null : Math.round((markValueUsd - p.costUsd) * 100) / 100, contract };
  });
  return NextResponse.json(out);
}
