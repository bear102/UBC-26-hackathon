// POST { positionId, signature } -> Position (verified on-chain; emits a "fill" feed event)
import { NextResponse } from "next/server";
import { z } from "zod";
import { store } from "@/lib/store";
import { venueFor, VenueError } from "@/lib/venue";
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
    return NextResponse.json(await venueFor(pos.network).confirmBuy(pos.id, parsed.data.signature));
  } catch (e) {
    return errorResponse(e);
  }
}
