// GET /api/markets/ticker?city=Austin -> ~8 live odds for the header ticker (a few hundred bytes, not the ~1.8 MB list).
// Local first: weather only for the visitor's business city (default Austin), never foreign cities; then US markets
// (games, preferring the region's teams, fuel, rates, inflation). Crypto and misc are left out.
import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/markets";
import type { MarketContract, Peril } from "@/lib/types";

export const dynamic = "force-dynamic";

export type TickerItem = { k: string; t: string; l: string; p: number; v: string };
const VENUE: Record<string, string> = { gemini: "Gemini", kalshi: "Kalshi", polymarket: "Polymarket" };
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 2).trimEnd() + "…" : s);
const WEATHER: Peril[] = ["heat", "cold", "rain", "snow"];
const US_NATIONAL: Peril[] = ["oil", "gas", "fed", "cpi", "natgas", "power"];
const TEXAS = /\b(austin|dallas|houston|san antonio|texas|spurs|mavericks|rockets|cowboys|texans|longhorns|aggies|tcu|baylor|rice|smu|utsa|astros|rangers|stars)\b/i;
const TX_CITIES = /^(austin|dallas|houston|san antonio|fort worth|el paso)$/i;

const tradable = (m: MarketContract) => m.status === "open" && m.yesAsk != null && m.yesAsk > 0.02 && m.yesAsk < 0.98;
const item = (m: MarketContract): TickerItem =>
  ({ k: m.id, t: cut(m.eventTitle.replace(/\?$/, ""), 46), l: cut(m.label, 26), p: Math.round((m.yesAsk ?? 0) * 100), v: VENUE[m.venue] ?? m.venue });

/** Event key that matches the same question across venues ("Highest temperature in Austin on Nov 20" on Gemini and Kalshi). */
const eventKey = (m: MarketContract) => WEATHER.includes(m.peril)
  ? `${/lowest|low /i.test(m.eventTitle) ? "low" : /highest|high /i.test(m.eventTitle) ? "high" : m.peril}|${(m.location ?? "").toLowerCase()}`
  : m.eventTitle.toLowerCase();

/** Up to `n` items, at most `per` per event so one ladder (or one event on two venues) doesn't fill the strip. */
function take(ms: MarketContract[], n: number, per = 1): MarketContract[] {
  const byEvent = new Map<string, number>();
  const out: MarketContract[] = [];
  for (const m of ms) {
    const k = eventKey(m);
    if ((byEvent.get(k) ?? 0) >= per) continue;
    byEvent.set(k, (byEvent.get(k) ?? 0) + 1);
    out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

function pickTicker(all: MarketContract[], city = "Austin"): TickerItem[] {
  const c = city.split(",")[0].trim().toLowerCase();
  const ms = all.filter(tradable);
  // most even odds first: a 45% line is more interesting than a 3% tail
  const mid = (m: MarketContract) => Math.abs((m.yesAsk ?? 0) - 0.5);
  const local = ms.filter((m) => WEATHER.includes(m.peril) && (m.location ?? "").toLowerCase().split(",")[0].trim() === c).sort((a, b) => mid(a) - mid(b));
  const regional = TX_CITIES.test(c) ? TEXAS : new RegExp(`\\b${c.replace(/[^a-z ]/g, "")}\\b`, "i");
  const games = ms.filter((m) => m.peril === "game").sort((a, b) => Number(regional.test(b.eventTitle)) - Number(regional.test(a.eventTitle)) || mid(a) - mid(b));
  const national = ms.filter((m) => US_NATIONAL.includes(m.peril)).sort((a, b) => mid(a) - mid(b));
  const picked = [...take(local, 3), ...take(games, 3), ...take(national, 3, 1)];
  return picked.slice(0, 8).map(item);
}

export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city")?.slice(0, 40) || "Austin";
  try {
    const items = pickTicker(await listMarkets(), city);
    return NextResponse.json(items, { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json([], { status: 502 });
  }
}
