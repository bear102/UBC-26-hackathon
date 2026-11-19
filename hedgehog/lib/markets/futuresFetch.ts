// Gemini sports futures, fetched by ticker (the category listing never returns them). See futures.ts.
import { env } from "../env";
import type { MarketContract } from "../types";
import { eventByTicker, type GEvent } from "./geminiPm";
import { GEMINI_FUTURES_SEARCH, GEMINI_FUTURES_TICKERS } from "./futures";
import { normalizeGeminiEvents } from "./normalize";

const TTL = 10 * 60_000;

async function searchFutures(): Promise<GEvent[]> {
  const out = new Map<string, GEvent>();
  for (const q of GEMINI_FUTURES_SEARCH) {
    try {
      const r = await fetch(`${env.geminiPublic()}/v1/prediction-markets/events?status=active&search=${encodeURIComponent(q)}&limit=100`,
        { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const j = (await r.json()) as { data?: (GEvent & { eventTags?: { slug?: string }[] })[] };
      for (const e of j.data ?? []) if ((e.eventTags ?? []).some((t) => t.slug === "futures") && e.category === "Sports") out.set(e.ticker, e);
    } catch { /* optional */ }
  }
  return [...out.values()];
}

/** Raw Gemini futures events: the known tickers (10 min cache); a tag-filtered search fills in when most tickers fail. */
export async function geminiFuturesEvents(tickers: readonly string[] = GEMINI_FUTURES_TICKERS): Promise<GEvent[]> {
  const res = await Promise.allSettled(tickers.map((t) => eventByTicker(t, TTL)));
  const evs = res.flatMap((r) => (r.status === "fulfilled" && r.value?.contracts ? [r.value] : []));
  if (evs.length < tickers.length / 2) {
    const have = new Set(evs.map((e) => e.ticker));
    for (const e of await searchFutures()) if (!have.has(e.ticker)) evs.push(e);
  }
  return evs.filter((e) => e.status === "active");
}

/** Normalized Gemini futures contracts (peril "game", meta.futureKind set, label/rules clashes dropped). */
export async function geminiFutures(): Promise<MarketContract[]> {
  return normalizeGeminiEvents(await geminiFuturesEvents());
}
