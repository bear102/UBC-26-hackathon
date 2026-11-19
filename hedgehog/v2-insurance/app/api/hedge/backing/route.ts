// GET ?owner=<pubkey> -> { live: boolean, hedges: DeskHedge[] }
// The desk's backing orders on Gemini for Gemini-priced positions/policies (dry-run unless HEDGE_LIVE=1).
import { NextResponse } from "next/server";
import { listHedges, liveEnabled } from "@/lib/venue/geminiHedge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get("owner") || undefined;
  return NextResponse.json({ live: liveEnabled(), hedges: listHedges(owner) });
}
