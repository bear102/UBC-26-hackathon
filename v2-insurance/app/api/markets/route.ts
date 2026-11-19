// GET /api/markets?peril=heat,rain&venue=kalshi&closed=1  -> MarketContract[] (UI + debugging)
import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/markets";
import type { Peril, VenueId } from "@/lib/types";

export const dynamic = "force-dynamic";

const PERILS = ["heat", "cold", "rain", "game", "oil", "gas", "fed", "cpi", "crypto", "other"];
const VENUES = ["gemini", "kalshi", "polymarket"];
const list = (v: string | null, ok: string[]) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => ok.includes(x));

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const markets = await listMarkets({
      perils: list(q.get("peril"), PERILS) as Peril[],
      venues: list(q.get("venue"), VENUES) as VenueId[],
      includeClosed: q.get("closed") === "1",
    });
    const loc = q.get("location")?.toLowerCase();
    const out = loc ? markets.filter((m) => (m.location ?? "").toLowerCase().includes(loc)) : markets;
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
