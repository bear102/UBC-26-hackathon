// Cross-venue comparison for one hedge: the same/similar event on Gemini / Kalshi / Polymarket.
//   GET  /api/markets/compare?id=<contractId>&side=yes|no        -> Comparison (404 when the id isn't live)
//   POST /api/markets/compare { contract: MarketContract, side }  -> Comparison (uses the posted contract when its
//        id isn't live, e.g. demo fixtures, and compares it against live markets)
import { NextResponse } from "next/server";
import { compareContract } from "@/lib/markets/compare";
import type { MarketContract } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sideOf = (s: unknown): "yes" | "no" => (s === "no" ? "no" : "yes");

async function run(id: string, side: "yes" | "no", hint?: MarketContract | null) {
  try {
    const cmp = await compareContract(id, side, hint);
    if (!cmp) return NextResponse.json({ error: `contract ${id} not found` }, { status: 404 });
    return NextResponse.json(cmp, { headers: { "cache-control": "private, max-age=20" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  return run(id, sideOf(q.get("side")));
}

export async function POST(req: Request) {
  let body: { contract?: MarketContract; id?: string; side?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const c = body.contract;
  const id = c?.id ?? body.id;
  if (!id || typeof id !== "string") return NextResponse.json({ error: "contract or id is required" }, { status: 400 });
  const hint = c && typeof c.eventTitle === "string" && typeof c.label === "string" && ["gemini", "kalshi", "polymarket"].includes(c.venue) ? c : null;
  return run(id, sideOf(body.side), hint);
}
