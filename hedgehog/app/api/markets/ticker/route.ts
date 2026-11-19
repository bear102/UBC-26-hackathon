// GET /api/markets/ticker -> ~8 live odds for the header ticker (a few hundred bytes instead of the full ~1.8 MB list).
import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/markets";
import type { MarketContract } from "@/lib/types";

export const dynamic = "force-dynamic";

export type TickerItem = { k: string; t: string; l: string; p: number; v: string };
const VENUE: Record<string, string> = { gemini: "Gemini", kalshi: "Kalshi", polymarket: "Polymarket" };
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 2).trimEnd() + "…" : s);

function pick(ms: MarketContract[]): TickerItem[] {
  const seen = new Map<string, number>();
  const out: TickerItem[] = [];
  for (const m of ms) {
    if (m.status !== "open" || m.yesAsk == null || m.yesAsk <= 0.02 || m.yesAsk >= 0.98) continue;
    const n = seen.get(m.peril) ?? 0;
    if (n >= 2) continue; // spread across perils
    seen.set(m.peril, n + 1);
    out.push({ k: m.id, t: cut(m.eventTitle.replace(/\?$/, ""), 46), l: cut(m.label, 26), p: Math.round(m.yesAsk * 100), v: VENUE[m.venue] ?? m.venue });
    if (out.length >= 8) break;
  }
  return out;
}

export async function GET() {
  try {
    const items = pick(await listMarkets());
    return NextResponse.json(items, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
