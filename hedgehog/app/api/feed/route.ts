// GET ?since=<ISO | epoch ms>&limit=200[&owner=<pubkey>] -> FeedEvent[] (oldest first)
// Test / parametric records are hidden (lib/visibility.ts); `owner` keeps that wallet's own events visible.
import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { feedIndex, isHiddenFeedEvent, showTest } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = u.searchParams.get("since");
  const sinceMs = !s ? 0 : /^\d+$/.test(s) ? Number(s) : Date.parse(s) || 0;
  const limit = Math.min(Number(u.searchParams.get("limit")) || 200, 500);
  const viewer = u.searchParams.get("owner");
  const idx = showTest() ? null : feedIndex({ positions: store.list("positions"), policies: store.list("policies") as Parameters<typeof feedIndex>[0]["policies"], hedges: store.list("hedges") }, viewer);
  const rows = store.list("feed")
    .filter((e) => Date.parse(e.at) > sinceMs && !(idx && isHiddenFeedEvent(e, idx)))
    .sort((a, b) => a.at.localeCompare(b.at));
  return NextResponse.json(rows.slice(-limit));
}
