// GET ?since=<ISO | epoch ms>&limit=200 -> FeedEvent[] (oldest first)
import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const s = u.searchParams.get("since");
  const sinceMs = !s ? 0 : /^\d+$/.test(s) ? Number(s) : Date.parse(s) || 0;
  const limit = Math.min(Number(u.searchParams.get("limit")) || 200, 500);
  const rows = store.list("feed").filter((e) => Date.parse(e.at) > sinceMs).sort((a, b) => a.at.localeCompare(b.at));
  return NextResponse.json(rows.slice(-limit));
}
