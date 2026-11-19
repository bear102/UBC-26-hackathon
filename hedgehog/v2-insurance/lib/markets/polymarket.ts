// Polymarket, READ-ONLY third source (public Gamma API, no key). Hedgehog never trades here: these
// contracts are (i) context lines for perils Gemini/Kalshi cover poorly (Fed, CPI, gas, games) and
// (ii) a cross-venue price check on quote lines ("Polymarket says 34%").
// Every function here is failure-tolerant: errors return [] / null and never break listMarkets.
import type { MarketContract, Peril, QuoteLine } from "../types";
import { addDays, centralDate, contractMeta, daysBetween, num, parseBounds, price, setMeta, tempPeril, type Bounds, type ContractMeta } from "./normalize";

export const GAMMA = process.env.POLYMARKET_GAMMA_BASE || "https://gamma-api.polymarket.com";
const TTL = 60_000;

/** Subset of a Gamma /markets row we read (real responses carry ~90 fields). */
export interface PMarket {
  id: string; question: string; conditionId?: string; slug: string;
  endDate?: string; gameStartTime?: string | null;
  outcomes?: string | string[]; outcomePrices?: string | string[];
  bestAsk?: number | null; bestBid?: number | null; lastTradePrice?: number | null;
  liquidityNum?: number | null; volumeNum?: number | null;
  active?: boolean; closed?: boolean; acceptingOrders?: boolean;
  sportsMarketType?: string | null; groupItemTitle?: string | null;
  events?: { slug?: string; title?: string }[];
}

/** What we pull: Gamma tag id -> peril family. Moneyline only for sports (events carry ~500 prop markets). */
export interface PolySource { key: string; tagId: number; perils: Peril[]; league?: string; moneyline?: boolean; days: number }
export const POLY_SOURCES: PolySource[] = [
  { key: "nba", tagId: 745, perils: ["game"], league: "NBA", moneyline: true, days: 14 },
  { key: "nfl", tagId: 450, perils: ["game"], league: "NFL", moneyline: true, days: 21 },
  { key: "fed", tagId: 159, perils: ["fed"], days: 75 },
  { key: "inflation", tagId: 702, perils: ["cpi", "gas"], days: 45 },
  { key: "oil", tagId: 309, perils: ["oil"], days: 45 },
];

const arr = (x: string | string[] | undefined): string[] => {
  if (Array.isArray(x)) return x.map(String);
  if (typeof x !== "string") return [];
  try { const v = JSON.parse(x); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

/** "↑ $4.45" / "↓ 3.0%" / "≥ 4.5%" group titles -> bounds (only the forms Polymarket uses for ladders). */
export function polyBounds(t: string | null | undefined): Bounds | undefined {
  if (!t) return undefined;
  const m = t.match(/^\s*(↑|↓|≥|≤)\s*(\$?)(-?[\d.]+)\s*(%?)/);
  if (!m) return undefined;
  const v = Number(m[3]);
  if (!Number.isFinite(v)) return undefined;
  const unit = m[2] ? "$" : m[4] ? "%" : undefined;
  const fmt = `${unit === "$" ? "$" : ""}${v}${unit === "%" ? "%" : ""}`;
  return m[1] === "↑" || m[1] === "≥"
    ? { lo: v, loInclusive: true, hiInclusive: false, unit, text: `≥${fmt}` }
    : { hi: v, loInclusive: false, hiInclusive: true, unit, text: `≤${fmt}` };
}

function perilFor(src: PolySource | undefined, q: string): Peril | null {
  if (src?.perils.length === 1) return src.perils[0];
  const s = q.toLowerCase();
  if (/\bgas\b|gasoline/.test(s)) return "gas";
  if (/\bus\b|u\.s\.|united states/.test(s) && /inflation|\bcpi\b/.test(s)) return "cpi";
  if (/inflation|\bcpi\b/.test(s)) return null; // other countries' CPI: not useful for a US business
  if (/\boil\b|wti|brent|crude/.test(s)) return "oil";
  if (/\bfed\b|interest rate|fomc/.test(s)) return "fed";
  return src?.perils[0] ?? null;
}

export const polyUrl = (m: PMarket) => `https://polymarket.com/event/${encodeURIComponent(m.events?.[0]?.slug || m.slug)}`;

/**
 * Gamma markets -> MarketContract (venue "polymarket", tradable false, id `polymarket:<slug>`).
 * Yes/No markets: YES = "Yes". Team markets ("Spurs" vs "Lakers"): YES = outcomes[0] wins.
 * Prices: bestAsk/bestBid when present (they quote outcome[0]); else outcomePrices[0] as both sides' mid.
 */
export function normalizePolymarkets(rows: PMarket[], src?: PolySource): MarketContract[] {
  const out: MarketContract[] = [];
  for (const m of rows) {
    if (!m?.slug || !m.question) continue;
    if (src?.moneyline && m.sportsMarketType && m.sportsMarketType !== "moneyline") continue;
    const peril = perilFor(src, m.question);
    if (!peril) continue;
    const outs = arr(m.outcomes), pxs = arr(m.outcomePrices).map(Number);
    if (outs.length !== 2) continue;
    const yesNo = outs[0].toLowerCase() === "yes";
    const mid = Number.isFinite(pxs[0]) ? pxs[0] : null;
    const yesAsk = price(m.bestAsk) ?? price(mid);
    const yesBid = price(m.bestBid) ?? price(mid);
    const id = `polymarket:${m.slug}`;
    const open = m.active !== false && m.closed !== true && m.acceptingOrders !== false;
    const settled = m.closed === true && mid !== null && (mid >= 0.99 || mid <= 0.01);
    const label = yesNo ? (m.groupItemTitle?.trim() || m.question) : outs[0];
    const start = m.gameStartTime ? m.gameStartTime.replace(" ", "T").replace(/\+00$/, "Z") : undefined;
    const meta: ContractMeta = {
      eventDate: start ? centralDate(start) : m.endDate ? centralDate(m.endDate) : undefined,
      bounds: yesNo ? polyBounds(m.groupItemTitle) : undefined,
      volume: num(m.volumeNum) ?? undefined, openInterest: num(m.liquidityNum) ?? undefined,
      category: src?.key, rules: m.question,
    };
    if (!yesNo) { meta.teams = [outs[0]]; meta.opponents = [outs[1]]; meta.league = src?.league; meta.startTime = start; }
    setMeta(id, meta);
    out.push({
      id, venue: "polymarket", eventTitle: m.events?.[0]?.title || m.question, label,
      symbol: m.conditionId || m.slug, eventTicker: m.events?.[0]?.slug || m.slug,
      peril, location: ["fed", "cpi", "gas", "oil"].includes(peril) ? "US" : undefined,
      expiry: m.endDate ?? "",
      yesAsk, yesBid,
      noAsk: yesBid !== null ? price(1 - yesBid) : null,
      noBid: yesAsk !== null ? price(1 - yesAsk) : null,
      url: polyUrl(m), tradable: false,
      status: settled ? "settled" : open ? "open" : "closed",
      resolution: settled ? (mid! >= 0.99 ? "yes" : "no") : null,
    });
  }
  return out;
}

// ---------- daily temperature (highest/lowest per city, listed several days AHEAD of Gemini/Kalshi) ----------
// Polymarket lists "Highest/Lowest temperature in <city> on <date>?" events days in advance, while Gemini and
// Kalshi only list the current day. Events are fetched by their predictable slug for today .. +WEATHER_DAYS
// (Central time). Past days are never requested.

/** Polymarket slug city -> the location string Gemini/Kalshi use. US cities only (our customers are US businesses). */
export const POLY_WEATHER_CITIES: Record<string, string> = {
  austin: "Austin", dallas: "Dallas", houston: "Houston", atlanta: "Atlanta", chicago: "Chicago", miami: "Miami",
  nyc: "NYC", seattle: "Seattle", "san-francisco": "San Francisco", "los-angeles": "Los Angeles", denver: "Denver",
  boston: "Boston", "washington-dc": "Washington DC",
};
export const WEATHER_DAYS = 4;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

interface PEvent { slug: string; title: string; endDate?: string; closed?: boolean; markets?: PMarket[] }

/** Slugs for every city × {highest,lowest} × day from today (Central) through today + days. */
export function weatherSlugs(now = new Date(), days = WEATHER_DAYS): { slug: string; city: string; date: string; low: boolean }[] {
  const today = centralDate(now);
  const out: { slug: string; city: string; date: string; low: boolean }[] = [];
  for (let i = 0; i <= days; i++) {
    const ymd = addDays(today, i);
    const [y, m, d] = ymd.split("-").map(Number);
    for (const [slugCity, city] of Object.entries(POLY_WEATHER_CITIES)) {
      for (const low of [false, true]) {
        out.push({ slug: `${low ? "lowest" : "highest"}-temperature-in-${slugCity}-on-${MONTHS[m - 1]}-${d}-${y}`, city, date: ymd, low });
      }
    }
  }
  return out;
}

/** Temperature events -> MarketContract (peril heat/cold via the same bin logic as Gemini/Kalshi). */
export function normalizePolyWeather(events: PEvent[], slugInfo: Map<string, { city: string; date: string; low: boolean }>, today: string): MarketContract[] {
  const out: MarketContract[] = [];
  for (const e of events) {
    const info = slugInfo.get(e.slug);
    if (!info || info.date < today || e.closed) continue; // never past days
    for (const m of e.markets ?? []) {
      if (!m?.slug || m.closed) continue;
      const outs = arr(m.outcomes), pxs = arr(m.outcomePrices).map(Number);
      if (outs.length !== 2 || outs[0].toLowerCase() !== "yes") continue;
      const label = (m.groupItemTitle || "").trim();
      const bounds = parseBounds(label);
      if (!bounds) continue;
      const mid = Number.isFinite(pxs[0]) ? pxs[0] : null;
      const yesAsk = price(m.bestAsk) ?? price(mid);
      const yesBid = price(m.bestBid) ?? price(mid);
      const id = `polymarket:${m.slug}`;
      setMeta(id, { eventDate: info.date, bounds, volume: num(m.volumeNum) ?? undefined, openInterest: num(m.liquidityNum) ?? undefined, category: "weather", rules: m.question, station: undefined });
      out.push({
        id, venue: "polymarket", eventTitle: e.title, label, symbol: m.conditionId || m.slug, eventTicker: e.slug,
        peril: tempPeril(bounds, info.low), location: info.city, expiry: m.endDate || e.endDate || "",
        yesAsk, yesBid, noAsk: yesBid !== null ? price(1 - yesBid) : null, noBid: yesAsk !== null ? price(1 - yesAsk) : null,
        url: `https://polymarket.com/event/${encodeURIComponent(e.slug)}`, tradable: false,
        status: m.acceptingOrders === false ? "closed" : "open", resolution: null,
      });
    }
  }
  return out;
}

async function fetchWeather(now = new Date()): Promise<MarketContract[]> {
  const slugs = weatherSlugs(now);
  const info = new Map(slugs.map((s) => [s.slug, s]));
  const batches: string[][] = [];
  for (let i = 0; i < slugs.length; i += 25) batches.push(slugs.slice(i, i + 25).map((s) => s.slug));
  const res = await Promise.allSettled(batches.map(async (b) => {
    const qs = b.map((s) => `slug=${encodeURIComponent(s)}`).join("&");
    const r = await fetch(`${GAMMA}/events?${qs}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`polymarket weather -> ${r.status}`);
    const rows = (await r.json()) as unknown;
    return Array.isArray(rows) ? (rows as PEvent[]) : [];
  }));
  const events = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!events.length && res.every((r) => r.status === "rejected")) throw new Error("polymarket weather unreachable");
  return normalizePolyWeather(events, info, centralDate(now));
}

// ---------- disaster / climate events (READ-ONLY reference: Polymarket isn't available to US desks) ----------
// Multi-outcome "bucket" events with no Kalshi/Gemini equivalent (Mississippi low water, Lake Powell, Great Salt Lake,
// LA earthquake, US tornado totals) plus a couple that complement Kalshi (Lake Mead season low, winter snow vs average).
// Fetched by slug. Hurricane landfall events are deliberately left out: the Atlantic season ends Nov 30.

export interface PolyEventSpec { slug: string; peril: Peril; location: string; cityFromGroup?: boolean; label?: string }
export const POLY_EVENTS: PolyEventSpec[] = [
  { slug: "lowest-mississippi-level-at-st-louis-by-november-30", peril: "water", location: "St. Louis" },
  { slug: "lowest-mississippi-level-at-baton-rouge-by-november-30", peril: "water", location: "Baton Rouge" },
  { slug: "how-low-will-lake-powell-drop-1786980780361", peril: "water", location: "Lake Powell" },
  { slug: "how-low-will-lake-mead-drop-1786981653904", peril: "water", location: "Lake Mead" },
  { slug: "lowest-great-salt-lake-elevation-in-2026", peril: "water", location: "Great Salt Lake" },
  { slug: "how-many-tornadoes-in-the-us-in-2026", peril: "storm", location: "US" },
  { slug: "us-tornadoes-in-november-2026", peril: "storm", location: "US" },
  { slug: "magnitude-6pt5-earthquake-in-la-before-2027", peril: "quake", location: "Los Angeles", label: "M6.5+ in LA" },
  { slug: "will-california-experience-a-7pt0-or-above-magnitude-earthquake-in-2026-20260723232901145", peril: "quake", location: "California", label: "M7.0+ in California" },
  { slug: "which-cities-will-get-more-snow-than-average-this-winter-2026-2027", peril: "snow", location: "", cityFromGroup: true, label: "More snow than average" },
];
export const DISASTER_SOURCE: PolySource = { key: "disaster", tagId: 0, perils: ["water", "storm", "quake", "snow"], days: 180 };

interface PEventFull extends PEvent { startDate?: string }

/** Disaster/climate events -> read-only contracts. Bucket labels ("1,033–1,038 ft", "Below 3.00 ft", "1250+") become bounds. */
export function normalizePolyEvents(events: PEventFull[], specs: PolyEventSpec[] = POLY_EVENTS, now = new Date()): MarketContract[] {
  const out: MarketContract[] = [];
  const bySlug = new Map(specs.map((x) => [x.slug, x]));
  const today = centralDate(now);
  for (const e of events) {
    const spec = bySlug.get(e.slug);
    if (!spec || e.closed) continue;
    for (const m of e.markets ?? []) {
      if (!m?.slug || m.closed) continue;
      const outs = arr(m.outcomes), pxs = arr(m.outcomePrices).map(Number);
      if (outs.length !== 2 || outs[0].toLowerCase() !== "yes") continue;
      const group = (m.groupItemTitle || "").trim();
      const location = spec.cityFromGroup ? group : spec.location;
      if (!location) continue;
      const label = spec.cityFromGroup ? `${group}: ${spec.label ?? "Yes"}` : group || spec.label || m.question;
      const bounds = spec.cityFromGroup ? null : parseBounds(group);
      const mid = Number.isFinite(pxs[0]) ? pxs[0] : null;
      const yesAsk = price(m.bestAsk) ?? price(mid);
      const yesBid = price(m.bestBid) ?? price(mid);
      const id = `polymarket:${m.slug}`;
      const end = m.endDate || e.endDate || "";
      const start = e.startDate ? centralDate(e.startDate) : today;
      setMeta(id, {
        eventDate: start < today ? today : start, eventEnd: end ? centralDate(end) : undefined, bounds: bounds ?? undefined,
        volume: num(m.volumeNum) ?? undefined, openInterest: num(m.liquidityNum) ?? undefined, category: spec.peril, rules: m.question,
      });
      out.push({
        id, venue: "polymarket", eventTitle: e.title, label, symbol: m.conditionId || m.slug, eventTicker: e.slug,
        peril: spec.peril, location, expiry: end,
        yesAsk, yesBid, noAsk: yesBid !== null ? price(1 - yesBid) : null, noBid: yesAsk !== null ? price(1 - yesAsk) : null,
        url: `https://polymarket.com/event/${encodeURIComponent(e.slug)}`, tradable: false,
        status: m.acceptingOrders === false ? "closed" : "open", resolution: null,
      });
    }
  }
  return out;
}

async function fetchDisasters(): Promise<MarketContract[]> {
  const qs = POLY_EVENTS.map((x) => `slug=${encodeURIComponent(x.slug)}`).join("&");
  const r = await fetch(`${GAMMA}/events?${qs}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`polymarket disasters -> ${r.status}`);
  const rows = (await r.json()) as unknown;
  return normalizePolyEvents(Array.isArray(rows) ? (rows as PEventFull[]) : []);
}

// ---------- fetch + cache ----------

// Shared across Next bundles (see srcCache in index.ts).
type PolyCache = Map<string, { t: number; v: MarketContract[]; p?: Promise<MarketContract[]> }>;
const G = globalThis as { __hhPolyCache?: PolyCache };
const cache: PolyCache = (G.__hhPolyCache ??= new Map());

async function fetchSource(src: PolySource, now = new Date()): Promise<MarketContract[]> {
  const min = new Date(now.getTime() - 6 * 3600_000).toISOString();
  const max = new Date(now.getTime() + src.days * 86_400_000).toISOString();
  const qs = new URLSearchParams({ closed: "false", limit: "100", tag_id: String(src.tagId), end_date_min: min, end_date_max: max });
  if (src.moneyline) qs.set("sports_market_types", "moneyline");
  const r = await fetch(`${GAMMA}/markets?${qs}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`polymarket ${src.key} -> ${r.status}`);
  const rows = (await r.json()) as unknown;
  return normalizePolymarkets(Array.isArray(rows) ? (rows as PMarket[]) : [], src);
}

/** Pseudo-source for daily temperature (fetched by slug, not by tag). */
export const WEATHER_SOURCE: PolySource = { key: "weather", tagId: 103040, perils: ["heat", "cold"], days: WEATHER_DAYS };

/** Cached (60s) per source, stale-on-error, [] when never reachable. */
async function cachedSource(src: PolySource): Promise<MarketContract[]> {
  const c = cache.get(src.key);
  if (c && Date.now() - c.t < TTL) return c.v;
  const stale = c && c.v.length ? c.v : null; // serve the last good list while a refresh runs
  if (c?.p) return stale ?? c.p;
  const p = (src.key === "weather" ? fetchWeather() : src.key === "disaster" ? fetchDisasters() : fetchSource(src))
    .then((v) => { cache.set(src.key, { t: Date.now(), v }); return v; })
    .catch(() => { cache.set(src.key, { t: Date.now() - TTL + 15_000, v: c?.v ?? [] }); return c?.v ?? []; }); // retry in 15s
  cache.set(src.key, { t: c?.t ?? 0, v: c?.v ?? [], p });
  return stale ?? p;
}

/** Polymarket contracts for the given perils. Never throws. */
export async function listPolymarkets(perils: Peril[]): Promise<MarketContract[]> {
  const srcs = [...POLY_SOURCES, WEATHER_SOURCE, DISASTER_SOURCE].filter((s) => s.perils.some((p) => perils.includes(p)));
  const res = await Promise.allSettled(srcs.map(cachedSource));
  return res.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((c) => perils.includes(c.peril));
}

/** Fresh-ish (cached) contract by id, or null. */
export async function getPolymarket(id: string): Promise<MarketContract | null> {
  for (const s of [...POLY_SOURCES, WEATHER_SOURCE, DISASTER_SOURCE]) {
    const hit = (await cachedSource(s)).find((c) => c.id === id);
    if (hit) return hit;
  }
  try {
    const slug = id.replace(/^polymarket:/, "");
    const r = await fetch(`${GAMMA}/markets?slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(8_000) });
    const rows = r.ok ? ((await r.json()) as PMarket[]) : [];
    return normalizePolymarkets(Array.isArray(rows) ? rows : [])[0] ?? null;
  } catch { return null; }
}

// ---------- cross-venue price check ----------

export interface CrossCheck {
  venue: "polymarket";
  contractId: string;
  title: string;          // the Polymarket question
  prob: number;           // Polymarket's probability (0..1) that THIS line pays
  lineProb: number;       // the line's own implied probability (its ask)
  diffPts: number;        // (lineProb - prob) * 100, rounded
  exact: boolean;         // same game/threshold/date (true) vs a close cousin (false)
  url?: string;
}

/** Team aliases used to link a nickname ("Spurs") to the city label venues use ("San Antonio"). */
export type TeamAlias = { re: RegExp; names: string[] };

const mid = (c: MarketContract): number | null => {
  if (c.yesAsk !== null && c.yesBid !== null) return (c.yesAsk + c.yesBid) / 2;
  return c.yesAsk ?? c.yesBid;
};
const lc = (s: string) => s.toLowerCase().trim();

function sameTeam(venueNames: string[], polyName: string, aliases: TeamAlias[]): boolean {
  const p = lc(polyName);
  if (!p) return false;
  for (const v of venueNames.map(lc)) {
    if (v === p || v.endsWith(` ${p}`) || p.endsWith(` ${v}`)) return true;
    if (aliases.some((a) => a.re.test(polyName) && a.names.some((n) => lc(n) === v))) return true;
  }
  return false;
}

/**
 * Probability, per Polymarket, that `line` pays — or null when no matching Polymarket market exists.
 * Games: same team within ±1 day. Thresholds (gas/oil/fed/cpi): same peril, same bound value and direction, expiry within 3 days.
 */
export function crossCheckLine(line: Pick<QuoteLine, "contract" | "side" | "impliedProb">, poly: MarketContract[], aliases: TeamAlias[] = []): CrossCheck | null {
  const c = line.contract;
  if (c.venue === "polymarket") return null;
  const meta = contractMeta(c.id);
  const lineProb = line.impliedProb;
  const mk = (p: MarketContract, probYes: number, exact: boolean): CrossCheck => {
    const prob = Math.round((line.side === "yes" ? probYes : 1 - probYes) * 1000) / 1000;
    return { venue: "polymarket", contractId: p.id, title: p.eventTitle === p.label ? p.label : `${p.eventTitle}: ${p.label}`, prob, lineProb, diffPts: Math.round((lineProb - prob) * 100), exact, url: p.url };
  };
  for (const p of poly) {
    if (p.status !== "open" || p.peril !== c.peril) continue;
    const pm = contractMeta(p.id);
    const m = mid(p);
    if (m === null || !pm) continue;
    if (c.peril === "game") {
      if (!meta?.eventDate || !pm.eventDate || Math.abs(daysBetween(meta.eventDate, pm.eventDate)) > 1) continue;
      if (meta.league && pm.league && meta.league !== pm.league) continue;
      const self = meta.teams ?? [c.label];
      const opp = meta.opponents ?? [];
      const [pa, pb] = [pm.teams?.[0] ?? "", pm.opponents?.[0] ?? ""];
      // P(line's YES team wins) from Polymarket's P(outcome[0] wins) = m
      if (sameTeam(self, pa, aliases) || (opp.length && sameTeam(opp, pb, aliases))) return mk(p, m, true);
      if (sameTeam(self, pb, aliases) || (opp.length && sameTeam(opp, pa, aliases))) return mk(p, 1 - m, true);
      continue;
    }
    const b = meta?.bounds, pb = pm.bounds;
    if (!b || !pb) continue;
    if (c.peril === "heat" || c.peril === "cold") {
      // Weather: same city, same day, same bin -> exact match.
      if (!c.location || !p.location || c.location.toLowerCase() !== p.location.toLowerCase()) continue;
      if (!meta?.eventDate || meta.eventDate !== pm.eventDate) continue;
      if (b.lo !== pb.lo || b.hi !== pb.hi) continue;
      return mk(p, m, true);
    }
    const sameDir = (b.lo !== undefined && b.hi === undefined && pb.lo !== undefined) || (b.hi !== undefined && b.lo === undefined && pb.hi !== undefined);
    const v = b.lo ?? b.hi, pv = pb.lo ?? pb.hi;
    if (!sameDir || v === undefined || pv === undefined || Math.abs(v - pv) > Math.max(0.005, Math.abs(v) * 0.002)) continue;
    const e1 = Date.parse(c.expiry), e2 = Date.parse(p.expiry);
    if (!Number.isFinite(e1) || !Number.isFinite(e2) || Math.abs(e1 - e2) > 3 * 86_400_000) continue;
    return mk(p, m, false); // "hit X during the month" vs "settles above X" differ, so never claim exact
  }
  return null;
}

