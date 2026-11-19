// M1 Risk Scan (SPEC §14.2): one sentence about a business → the live Gemini markets that move its revenue or costs.
// Rule: the LLM picks markets and writes words; code computes every number (probability = mid, cost = Σ ask, depth from the book).
import crypto from "node:crypto";
import { searchEvents, book, type GEvent } from "./gemini";
import { quoteBin } from "./pricing";
import { env } from "./env";
import { kindOf, templateCards } from "./catalog";
import { venueFor, liveCapable, bookBase, isSandbox, hostOf, type Venue } from "./venue";
import { llmJson, llmProvider, errCode, cleanText } from "./llm";

export type Shape = "exclusive" | "ladder";
export type Channel = "revenue" | "cost" | "financing";
export type Action = "promo" | "hedge" | "plan";

export type ExposureRow = {
  id: string;
  event_ticker: string; event_title: string; category: string; expiry?: string;
  symbols: string[]; labels: string[];
  shape: Shape; channel: Channel; action: Action; action_forced?: string;
  impact_usd: number; impact_source: "ai" | "default";
  why: string; basis_note: string; settles_on: string;
  p_bad: number | null; cost_per_usd: number | null; depth: number;
  flags: string[];              // thin, illiquid, no-book
  venue: { mode: "live" | "paper"; host: string; sandbox: boolean; why?: string };
};
export type Profile = { business_type: string; city: string; revenue_drivers?: string[]; cost_drivers?: string[]; financing?: string };
export type ExposureMap = { profile: Profile; rows: ExposureRow[]; source: "llm" | "fallback"; note?: string; ms: number; catalogSize: number };

type Raw = GEvent & { source?: unknown; sourceDetails?: { agency?: string; index?: string; [k: string]: unknown } | null; volume24h?: string | number; [k: string]: unknown };

const DAY = 86400_000;
const CITIES = ["AUS", "SAT", "HOU", "DFW"];

/** Live events a small Texas business could be exposed to (data venue + the trade venue's own financial events). */
const catCache = ((globalThis as any).__hhSuiteCat ??= { t: 0, v: [] as Raw[] }) as { t: number; v: Raw[] };
export async function suiteCatalog(): Promise<Raw[]> {
  if (Date.now() - catCache.t < 60_000 && catCache.v.length) return catCache.v;
  const v = await suiteCatalogFresh();
  catCache.t = Date.now(); catCache.v = v;
  return v;
}
async function suiteCatalogFresh(): Promise<Raw[]> {
  const now = Date.now();
  const all = (await searchEvents(
    ["Austin", "San Antonio", "Houston", "Dallas", "Spurs", "Rockets", "Mavericks", "Texas", "Longhorns", "Aggies"],
    ["category=Weather", "category=Crypto", "category=Commodities", "category=Economics"],
  )) as Raw[];
  if (liveCapable() && env.geminiTrade() !== env.geminiPublic()) {
    const seen = new Set(all.map((e) => e.ticker));
    for (const e of (await searchEvents([], ["category=Crypto", "category=Commodities"], env.geminiTrade())) as Raw[]) if (!seen.has(e.ticker)) all.push(e);
  }
  const keep: Raw[] = [];
  let btcHourly = 0;
  for (const e of all.sort((a, b) => Date.parse(a.expiryDate ?? "") - Date.parse(b.expiryDate ?? ""))) {
    const exp = Date.parse(e.expiryDate ?? "");
    if (!Number.isFinite(exp) || exp < now + 20 * 60_000) continue;
    const horizon = e.category === "Economics" ? 100 * DAY : 45 * DAY;
    if (exp > now + horizon) continue;
    if (!e.contracts?.some((c) => c.prices?.bestAsk)) continue; // no book anywhere: not usable (e.g. empty WTI month-end)
    if (e.category === "Weather") {
      const city = e.ticker.split("-")[1];
      if (!CITIES.includes(city) || exp > now + 3 * DAY) continue;
      // same rule as the promo catalog: the measured day must still be before ~noon CT (expiry is 22:59:59 CT that day)
      if (process.env.HH_WEATHER_ANYTIME !== "1" && exp - (10 * 3600 + 59 * 60 + 59) * 1000 < now + 30 * 60_000) continue;
    }
    else if (e.category === "Sports") { if (kindOf(e) !== "game") continue; }
    else if (e.category === "Crypto") {
      if (!/^(BTC|ETH)\d{10}$/.test(e.ticker)) continue; // hourly/daily ladders only, no 5/15-min noise
      if (++btcHourly > 4) continue;
    } else if (!["Commodities", "Economics"].includes(e.category)) continue;
    keep.push(e);
  }
  return keep.slice(0, 70);
}

export function shapeOf(e: GEvent): Shape {
  if (e.category === "Weather" || e.category === "Sports" || /^FED/.test(e.ticker)) return "exclusive";
  if (e.contracts.some((c) => /or (above|more)|^\$?[\d,.]+\+?$/i.test(c.label) || /-HI[\dD]/.test(c.instrumentSymbol))) return "ladder";
  return "exclusive";
}

const midOf = (c: GEvent["contracts"][number]) => {
  const a = Number(c.prices?.bestAsk ?? NaN), b = Number(c.prices?.bestBid ?? NaN);
  return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a / 2 : null;
};

function catalogLines(cat: Raw[]) {
  return cat.map((e) => {
    const cs = e.contracts.filter((c) => c.prices?.bestAsk).slice(0, 10).map((c) => `${c.instrumentSymbol} "${c.label}" ask ${c.prices?.bestAsk}`).join("; ");
    return `- ${e.ticker} | ${e.category} | ${e.title} | ${shapeOf(e)} | expiry ${e.expiryDate} | ${cs}`;
  }).join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    profile: {
      type: "object",
      properties: {
        business_type: { type: "string" }, city: { type: "string" },
        revenue_drivers: { type: "array", items: { type: "string" } }, cost_drivers: { type: "array", items: { type: "string" } }, financing: { type: "string" },
      },
      required: ["business_type", "city"],
    },
    exposures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_ticker: { type: "string" },
          symbols: { type: "array", items: { type: "string" }, description: "contracts that pay in the scenario that HURTS the business; for a ladder event exactly one" },
          channel: { type: "string", enum: ["revenue", "cost", "financing"] },
          action: { type: "string", enum: ["promo", "hedge", "plan"] },
          impact_usd: { type: "number", description: "rough $ hit to this business if the bad scenario happens" },
          why: { type: "string", description: "<=120 chars" },
          basis_note: { type: "string", description: "<=110 chars: how the market's settlement differs from the business's real exposure" },
        },
        required: ["event_ticker", "symbols", "channel", "action", "impact_usd", "why", "basis_note"],
      },
    },
  },
  required: ["profile", "exposures"],
} as const;

const SYSTEM =
  "You are a risk analyst for small Texas businesses. Given a one-sentence business description and a catalog of LIVE Gemini prediction markets, " +
  "list up to 6 markets whose outcome would hurt this business (revenue, costs or financing). Use ONLY tickers and instrumentSymbols from the catalog. " +
  "`symbols` = the contracts that pay in the scenario that hurts the business (for 'exclusive' events, all bins of that scenario; for 'ladder' events exactly ONE threshold). " +
  "action: 'promo' = turn it into a customer money-back promo (weather, local games, BTC for crypto-friendly shops); 'hedge' = the business buys cover directly (costs like natural gas, crypto treasury); " +
  "'plan' = just plan around it (macro like Fed, unemployment, GDP). impact_usd = a rough, conservative dollar hit for a business this size. " +
  "Never invent numbers about odds or prices; those come from the market. Sort by importance.";

type LlmRow = { event_ticker: string; symbols: string[]; channel: Channel; action: Action; impact_usd: number; why: string; basis_note: string };

function settlesOn(e: Raw): string {
  const sd = e.sourceDetails;
  if (sd && (sd.agency || sd.index)) return [sd.agency, sd.index].filter(Boolean).join(" · ");
  if (typeof e.source === "string" && e.source) return e.source;
  if (e.category === "Weather") return "NWS climate report (airport station)";
  if (e.category === "Sports") return "official game result";
  return "Gemini contract rules";
}

async function enrich(e: Raw, r: LlmRow, impactSource: "ai" | "default"): Promise<ExposureRow | null> {
  const syms = new Set(e.contracts.map((c) => c.instrumentSymbol));
  let symbols = [...new Set((r.symbols ?? []).filter((s) => syms.has(s)))];
  if (!symbols.length) return null;
  const shape = shapeOf(e);
  if (shape === "ladder" && symbols.length > 1) {
    // keep the threshold nearest a coin flip
    symbols = [symbols.map((s) => ({ s, m: midOf(e.contracts.find((c) => c.instrumentSymbol === s)!) ?? 0 })).sort((a, b) => Math.abs(a.m - 0.5) - Math.abs(b.m - 0.5))[0].s];
  }
  const contracts = symbols.map((s) => e.contracts.find((c) => c.instrumentSymbol === s)!);
  // Numbers come from the book of the venue this risk would actually be hedged on (sandbox when it lists the event).
  let venue: Venue;
  try { venue = await venueFor(e.ticker, symbols); } catch { venue = { data: env.geminiPublic(), trade: env.geminiTrade(), mode: "paper", resolve: env.geminiPublic(), why: "venue check failed" }; }
  const base = bookBase(venue);
  const bins = await Promise.all(symbols.map(async (s) => quoteBin(s, await book(s, 5_000, base).catch(() => ({ bids: [], asks: [] })), env.limitSlippage())));
  const p_bad = bins.some((b) => b.mid == null) ? null : Math.min(1, bins.reduce<number>((a, b) => a + (b.mid as number), 0));
  const cost = bins.some((b) => b.ask == null) ? null : Math.round(bins.reduce<number>((a, b) => a + (b.ask as number), 0) * 10000) / 10000;
  const depth = bins.length ? Math.min(...bins.map((b) => b.depth)) : 0;

  const flags: string[] = [];
  if (cost == null) flags.push("no-book");
  else if (depth < 50) flags.push("thin");
  const v24 = Number(e.volume24h ?? NaN);
  if (Number.isFinite(v24) && v24 === 0) flags.push("illiquid");

  let action: Action = r.action;
  let forced: string | undefined;
  const promoOk = kindOf(e) != null;
  if (action === "promo" && !promoOk) { action = "hedge"; forced = "not a promo market"; }
  if (e.category === "Economics" || e.category === "Politics") { if (action !== "plan") forced = "macro markets are plan-only"; action = "plan"; }
  else if (cost != null && cost > 0.75 && action !== "plan") { action = "plan"; forced = `cover costs ${Math.round(cost * 100)}¢ per $1`; }
  else if (cost == null && action !== "plan") { action = "plan"; forced = "no order book"; }

  const settles = settlesOn(e);
  const impact = Math.max(0, Math.round(Number(r.impact_usd) || 0));
  return {
    id: crypto.createHash("sha256").update(`${e.ticker}|${symbols.join(",")}`).digest("hex").slice(0, 12),
    event_ticker: e.ticker, event_title: e.title, category: e.category, expiry: e.expiryDate,
    symbols, labels: contracts.map((c) => c.label), shape,
    channel: r.channel, action, action_forced: forced,
    impact_usd: impact || 100, impact_source: impact ? impactSource : "default",
    why: cleanText(r.why).slice(0, 120),
    basis_note: `Settles on ${settles}. ${cleanText(r.basis_note).slice(0, 110)}`.trim(),
    settles_on: settles,
    p_bad: p_bad == null ? null : Math.round(p_bad * 1000) / 1000, cost_per_usd: cost, depth: Math.floor(depth),
    flags,
    venue: { mode: venue.mode, host: hostOf(venue.mode === "live" ? venue.trade : venue.data), sandbox: venue.mode === "live" && isSandbox(venue.trade), why: venue.why },
  };
}

/** Keyword fallback when the LLM is missing, slow or wrong: promo templates + simple cost/financing rows. */
async function fallbackRows(text: string, cat: Raw[]): Promise<{ profile: Profile; rows: LlmRow[] }> {
  const t = text.toLowerCase();
  const rows: LlmRow[] = [];
  const byTicker = new Map(cat.map((e) => [e.ticker, e]));
  try {
    const promoCat = cat.flatMap((e) => { const k = kindOf(e); return k ? [{ ...e, kind: k }] : []; });
    for (const c of await templateCards(promoCat)) {
      if (!byTicker.has(c.event_ticker)) continue;
      const wx = c.event_ticker.startsWith("WXHIGH");
      const btc = /^BTC/.test(c.event_ticker);
      if (wx && !/coffee|cart|iced|patio|truck|drink|cafe|tea|smoothie|ice/.test(t)) continue;
      if (btc && !/crypto|bitcoin|btc|coffee|cart/.test(t)) continue;
      if (!wx && !btc && !/bar|pub|watch|game|sport|wing|beer/.test(t)) continue;
      rows.push({ event_ticker: c.event_ticker, symbols: c.strip, channel: "revenue", action: "promo", impact_usd: wx ? 150 : btc ? 100 : 250, why: c.why, basis_note: wx ? "Airport station, not your street corner." : "Same contract settles the promo and the hedge." });
    }
  } catch { /* templates are best-effort */ }
  // latest-expiring event of the series that still has a two-sided book; threshold nearest a coin flip
  // Prefer an event the trade venue lists (so the Hedge Desk can actually buy it), else the latest one with a two-sided book.
  const ladderNear = async (re: RegExp) => {
    const cands: { e: Raw; c: GEvent["contracts"][number] }[] = [];
    for (const e of cat.filter((x) => re.test(x.ticker)).sort((a, b) => Date.parse(b.expiryDate ?? "") - Date.parse(a.expiryDate ?? ""))) {
      const c = e.contracts.filter((x) => x.prices?.bestAsk && x.prices?.bestBid).sort((a, b) => Math.abs((midOf(a) ?? 0) - 0.5) - Math.abs((midOf(b) ?? 0) - 0.5))[0];
      if (c) cands.push({ e, c });
    }
    for (const x of cands.slice(0, 4)) { try { if ((await venueFor(x.e.ticker, [x.c.instrumentSymbol])).mode === "live") return x; } catch { /* next */ } }
    return cands[0] ?? null;
  };
  if (/gas|griddle|stove|kitchen|restaurant|taco|taqueria|grill|bbq|bakery/.test(t)) {
    const x = await ladderNear(/^NGAS\d{10}$/);
    if (x) rows.push({ event_ticker: x.e.ticker, symbols: [x.c.instrumentSymbol], channel: "cost", action: "hedge", impact_usd: 300, why: "Gas griddles and ovens: a price spike raises next month's bill.", basis_note: "Your utility bill follows the index with a lag." });
  }
  if (/crypto|bitcoin|btc/.test(t)) {
    const x = await ladderNear(/^BTC\d{10}$/);
    if (x) rows.push({ event_ticker: x.e.ticker, symbols: [x.c.instrumentSymbol], channel: "revenue", action: "hedge", impact_usd: 100, why: "Crypto payments held overnight lose value if BTC drops.", basis_note: "Hourly index price, not your exact sale price." });
  }
  if (/loan|sba|credit|mortgage|lease|rate/.test(t)) {
    const fed = cat.find((e) => /^FED/.test(e.ticker));
    const hike = fed?.contracts.find((c) => /hike/i.test(c.label) && c.prices?.bestAsk);
    if (fed && hike) rows.push({ event_ticker: fed.ticker, symbols: [hike.instrumentSymbol], channel: "financing", action: "plan", impact_usd: 200, why: "A variable-rate loan costs more after a hike.", basis_note: "The Fed decision, not your lender's rate." });
  }
  const city = /san antonio/.test(t) ? "San Antonio" : /houston/.test(t) ? "Houston" : /dallas/.test(t) ? "Dallas" : "Austin";
  return { profile: { business_type: text.slice(0, 60), city }, rows: rows.slice(0, 6) };
}

const cache = ((globalThis as any).__hhExposureCache ??= new Map<string, { t: number; v: ExposureMap }>()) as Map<string, { t: number; v: ExposureMap }>;

export async function scanExposures(text: string, opts: { fresh?: boolean } = {}): Promise<ExposureMap> {
  const key = crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.t < 10 * 60_000) return hit.v;
  const t0 = Date.now();
  const cat = await suiteCatalog();
  const byTicker = new Map(cat.map((e) => [e.ticker, e]));
  let profile: Profile | null = null, raw: LlmRow[] = [], source: ExposureMap["source"] = "llm", note: string | undefined;
  const provider = llmProvider();
  if (provider) {
    try {
      const out = await llmJson({ system: SYSTEM, user: `Business: ${text.slice(0, 400)}\n\nLive Gemini catalog (ticker | category | title | shape | expiry | contracts):\n${catalogLines(cat)}`, schema: SCHEMA, timeoutMs: 25_000 });
      if (out.refused) throw Object.assign(new Error("refused"), { status: "refused" });
      const parsed = JSON.parse(out.text || "{}") as { profile?: Profile; exposures?: LlmRow[] };
      profile = parsed.profile ?? null;
      raw = (parsed.exposures ?? []).filter((r) => byTicker.has(r.event_ticker)).slice(0, 6);
      note = provider;
      if (!raw.length) throw Object.assign(new Error("no valid markets"), { status: "no-valid-markets" });
    } catch (e) {
      source = "fallback"; note = `${provider} ${errCode(e)}; keyword fallback`;
    }
  } else { source = "fallback"; note = "no LLM key; keyword fallback"; }
  if (source === "fallback") { const fb = await fallbackRows(text, cat); profile = fb.profile; raw = fb.rows; }
  const rows = (await Promise.all(raw.map((r) => enrich(byTicker.get(r.event_ticker)!, r, source === "llm" ? "ai" : "default").catch(() => null))))
    .filter((r): r is ExposureRow => !!r);
  // dedupe by event+symbols, rank by expected hit
  const seen = new Set<string>();
  const ranked = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => (b.p_bad ?? 0) * b.impact_usd - (a.p_bad ?? 0) * a.impact_usd);
  const v: ExposureMap = { profile: profile ?? { business_type: text.slice(0, 60), city: "Austin" }, rows: ranked, source, note, ms: Date.now() - t0, catalogSize: cat.length };
  cache.set(key, { t: Date.now(), v });
  return v;
}
