// POST { positionId, signature } -> Position & { backing? } (verified on-chain; emits a "fill" feed event).
// Gemini-priced positions are then backed by the desk on Gemini (dry-run unless HEDGE_LIVE=1; see lib/venue/geminiHedge.ts).
import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import { defaultGetContract, venueFor, VenueError } from "@/lib/venue";
import { backConfirmedSale } from "@/lib/venue/geminiHedge";
import { errorResponse } from "@/lib/venue/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ positionId: z.string().min(1), signature: z.string().min(64).max(90) });

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "body must be { positionId, signature }", code: "bad_request" }, { status: 400 });
    const pos = store.get("positions", parsed.data.positionId);
    if (!pos) throw new VenueError(`unknown position ${parsed.data.positionId}`, 404, "not_found");
    const confirmed = await venueFor(pos.network).confirmBuy(pos.id, parsed.data.signature);
    const backing = confirmed.network === "devnet"
      ? await backConfirmedSale({ kind: "position", refId: confirmed.id, contractId: confirmed.contractId, outcome: confirmed.side, quantity: confirmed.contracts, owner: confirmed.owner, businessId: confirmed.businessId, soldForUsd: confirmed.costUsd, txSig: confirmed.txSig }, defaultGetContract)
      : null;
    return NextResponse.json(backing ? { ...confirmed, backing } : confirmed);
  } catch (e) {
    return errorResponse(e);
  }
}
