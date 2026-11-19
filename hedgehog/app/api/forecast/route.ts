// GET /api/forecast?zip=78702&city=Austin,%20TX&busy=Fri,Sat,Sun[&desc=...] -> ForecastSummary (7 days, alerts, signals) | 404.
// NWS first, Open-Meteo fallback, cached ~30 min per location (lib/ai/forecast.ts). No LLM call.
import { NextResponse } from "next/server";
import { getForecast } from "@/lib/ai/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const zip = (q.get("zip") ?? "").trim().slice(0, 10).replace(/[^0-9-]/g, "");
  const city = (q.get("city") ?? "").trim().slice(0, 80) || "Austin, TX";
  const busyDays = (q.get("busy") ?? "").split(",").map((d) => d.trim().slice(0, 3)).map((d) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase()).filter((d) => DAYS.has(d));
  const description = (q.get("desc") ?? "").slice(0, 400);
  const s = await getForecast({ zip: zip || undefined, city }, { busyDays, description });
  if (!s) return NextResponse.json({ error: "forecast unavailable" }, { status: 404 });
  return NextResponse.json(s, { headers: { "cache-control": "private, max-age=300" } });
}
