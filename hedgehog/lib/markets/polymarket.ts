// Polymarket, READ-ONLY third source (public Gamma API, no key). Hedgehog never trades here: these
// contracts are (i) context lines for perils Gemini/Kalshi cover poorly (Fed, CPI, gas, games) and
// (ii) a cross-venue price check on quote lines ("Polymarket says 34%").
// Every function here is failure-tolerant: errors return [] / null and never break listMarkets.
import type { MarketContract, Peril, QuoteLine } from "../types";
import { addDays, centralDate, contractMeta, daysBetween, num, parseBounds, perilFromText, price, setMeta, tempPeril, type Bounds, type ContractMeta } from "./normalize";

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
interface PEventFull extends PEvent { startDate?: string }

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

// ---------- disaster / climate events (natural-disaster + weather markets for US businesses) ----------
// Discovery (all public Gamma API, checked live 2026-11-19):
//   1. tags: every open event tagged climate / natural-disasters / hurricanes / earthquakes (the "weather" tag is ~20 MB
//      of worldwide daily temperatures, so it is NOT pulled; temperature comes from weatherSlugs above);
//   2. predictable slugs: daily "where-will-it-rain-on-<month>-<d>-<y>", monthly "precipitation-in-<city>-in-<month>";
//   3. a fixed slug list (POLY_EVENTS) for events whose tags change.
// Each event goes through classifyPolyEvent: US-relevant events only (tornado counts, hurricane landfalls by state,
// US quakes, river / lake / sea levels, US city rain and snow, billion-dollar disasters). Worldwide-only events
// (global quake counts, volcanoes, meteors, global temperature, Chinese typhoons) are skipped: no US small business
// loses money on them. Non-US outcomes inside a US event ("Indonesia" in a quake ladder) are skipped too.

/** How an event becomes contracts. location: fixed place; "group" = each market's groupItemTitle is the place
 *  (city "Chicago, IL by November 30" -> "Chicago", US state "Texas"); non-US groups are dropped. */
export interface PolyEventSpec {
  slug: string; peril: Peril; location: string; cityFromGroup?: boolean; label?: string;
  /** a two-outcome market whose outcomes are not Yes/No ("Drier" / "Wetter"): YES = outcomes[0], this label */
  yesLabel?: string;
}
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
  // added 2026-11-19 (live, priced): flood gauges, hurricane landfalls, US disaster count, California dry winter, first snow
  { slug: "highest-st-johns-river-level-at-cocoa-by-november-30", peril: "flood", location: "Cocoa, FL" },
  { slug: "highest-sea-level-in-san-diego-this-winter", peril: "flood", location: "San Diego" },
  { slug: "will-any-category-4-hurricane-make-landfall-in-the-us-in-before-2027", peril: "storm", location: "US", label: "Cat 4+ hurricane landfall in the US" },
  { slug: "will-any-category-5-hurricane-make-landfall-in-the-us-in-before-2027", peril: "storm", location: "US", label: "Cat 5 hurricane landfall in the US" },
  { slug: "will-2-or-more-hurricanes-make-landfall-in-the-us-in-2026-20260721164140039", peril: "storm", location: "US", label: "2+ US hurricane landfalls" },
  { slug: "will-a-hurricane-make-landfall-in-hawaii-before-2027-20260721182828397", peril: "storm", location: "Hawaii", label: "Hurricane landfall in Hawaii" },
  { slug: "where-will-a-hurricane-make-landfall-in-the-us-during-the-2026-hurricane-season", peril: "storm", location: "", cityFromGroup: true, label: "Hurricane landfall" },
  { slug: "will-the-us-break-its-record-for-billion-dollar-weather-and-climate-disasters-in-2026-1787153419673", peril: "storm", location: "US", label: "Record year: 29+ US billion-dollar disasters" },
  { slug: "california-winter-2026-27-wetter-or-drier", peril: "rain", location: "California", yesLabel: "Drier than normal (Dec–Feb < 11.99 in)" },
  { slug: "first-snow-2026", peril: "snow", location: "", cityFromGroup: true, label: "Any snow" },
];
export const POLY_DISASTER_TAGS = ["climate", "natural-disasters", "hurricanes", "earthquakes"];
export const DISASTER_SOURCE: PolySource = { key: "disaster", tagId: 0, perils: ["water", "storm", "quake", "snow", "rain", "flood"], days: 180 };

/** US cities Polymarket lists monthly precipitation for (slug city -> place). */
export const POLY_PRECIP_CITIES: Record<string, string> = { nyc: "NYC", seattle: "Seattle", "los-angeles": "Los Angeles", chicago: "Chicago", miami: "Miami", austin: "Austin", houston: "Houston", dallas: "Dallas", denver: "Denver" };

/** Slugs that change every day / month: daily rain-by-city (today .. +3) and monthly precipitation (this month + next). */
export function dynamicDisasterSlugs(now = new Date()): string[] {
  const today = centralDate(now);
  const out: string[] = [];
  for (let i = 0; i <= 3; i++) {
    const [y, m, d] = addDays(today, i).split("-").map(Number);
    out.push(`where-will-it-rain-on-${MONTHS[m - 1]}-${d}-${y}`);
  }
  const mo = Number(today.slice(5, 7)) - 1;
  for (const k of [mo, (mo + 1) % 12]) for (const c of Object.keys(POLY_PRECIP_CITIES)) out.push(`precipitation-in-${c}-in-${MONTHS[k]}`);
  return out;
}

const US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];
const US_RE = /\b(US|U\.S\.|United States|America)\b/;

/**
 * Title rules for events found by tag / dynamic slug (fixed POLY_EVENTS win). Returns null for anything that is not a
 * US natural-disaster / weather market a small business can lose money on.
 */
export function classifyPolyEvent(e: { slug: string; title: string }): PolyEventSpec | null {
  const t = e.title, slug = e.slug;
  let m: RegExpMatchArray | null;
  if (/tornado/i.test(t)) return US_RE.test(t) ? { slug, peril: "storm", location: "US" } : null;
  if (/hurricane|tropical storm|named storm/i.test(t)) {
    if (/landfall/i.test(t) && /\bwhere\b/i.test(t) && US_RE.test(t)) return { slug, peril: "storm", location: "", cityFromGroup: true, label: "Hurricane landfall" };
    const st = US_STATES.find((s) => new RegExp(`\\b${s}\\b`).test(t));
    if (/landfall/i.test(t) && st) return { slug, peril: "storm", location: st };
    if (/landfall/i.test(t) && US_RE.test(t)) return { slug, peril: "storm", location: "US" };
    return null; // basin counts, Pacific records, "when will the next one form": no place, not a loss
  }
  if (/billion-dollar .*disasters?/i.test(t) && US_RE.test(t)) return { slug, peril: "storm", location: "US" };
  if (/earthquake|magnitude/i.test(t)) {
    if (/\bLA\b|Los Angeles/.test(t)) return { slug, peril: "quake", location: "Los Angeles" };
    if (/California/.test(t)) return { slug, peril: "quake", location: "California" };
    if (/^where will/i.test(t)) return { slug, peril: "quake", location: "", cityFromGroup: true, label: "M6.0+ earthquake" }; // country ladder: keeps "United States"
    return null; // worldwide counts / max magnitude
  }
  if (/where will it rain on/i.test(t)) return { slug, peril: "rain", location: "", cityFromGroup: true, label: "Rain" };
  if ((m = t.match(/^precipitation in (.+?) in [A-Za-z]+\??$/i))) {
    const city = Object.values(POLY_PRECIP_CITIES).find((c) => c.toLowerCase() === m![1].trim().toLowerCase());
    return city ? { slug, peril: "rain", location: city } : null;
  }
  if (/first snow|will it snow in/i.test(t)) return { slug, peril: "snow", location: "", cityFromGroup: true, label: "Any snow" };
  if (/more snow than average/i.test(t)) return { slug, peril: "snow", location: "", cityFromGroup: true, label: "More snow than average" };
  if (/(highest|peak).*(river|sea level|water level|flood)/i.test(t) && (m = t.match(/\bat ([A-Z][A-Za-z. ]+?)\b(?: by| this|\?|$)/) ?? t.match(/\bin ([A-Z][A-Za-z. ]+?)\b(?: by| this|\?|$)/))) return { slug, peril: "flood", location: m[1].trim() };
  if (/lake mead|lake powell|great salt lake|mississippi/i.test(t)) {
    const loc = /mead/i.test(t) ? "Lake Mead" : /powell/i.test(t) ? "Lake Powell" : /salt lake/i.test(t) ? "Great Salt Lake" : /baton rouge/i.test(t) ? "Baton Rouge" : /st\.? louis/i.test(t) ? "St. Louis" : "";
    return loc ? { slug, peril: "water", location: loc } : null;
  }
  return null;
}

const US_CITY_GROUP = /^(.+?),\s*([A-Z]{2})\b/; // "Chicago, IL by November 30" / "New York, NY"
/** Place for a "group" market: US city ("Chicago, IL ..." -> "Chicago"), US state, "United States" -> "US"; else null (non-US). */
export function placeFromGroup(group: string): string | null {
  const g = group.trim();
  if (!g) return null;
  const m = g.match(US_CITY_GROUP);
  if (m) return m[1].trim();
  if (US_STATES.includes(g)) return g;
  if (/^(US|USA|United States)$/i.test(g)) return "US";
  if (/^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/.test(g) && !/[,]/.test(g) && POLY_WEATHER_CITIES_SET.has(g.toLowerCase())) return g; // bare US city ("Chicago")
  return null;
}
const POLY_WEATHER_CITIES_SET = new Set([...Object.values(POLY_WEATHER_CITIES), "New York City", "Boston", "Detroit", "Minneapolis", "Philadelphia", "Pittsburgh", "Salt Lake City"].map((x) => x.toLowerCase()));

/** Bucket labels as Polymarket writes them -> bounds: '<3"', '3-4.5"', '>7.75"', "Under 10", "10 - 24", "60 or more", "1250+". */
export function disasterBounds(label: string): Bounds | null {
  const s = label.replace(/(\d)\s*"/g, "$1 inches").replace(/[–—]/g, "–").trim();
  if (!/\d/.test(s)) return null;
  return parseBounds(s);
}

/** Observation window from the title: "on November 20" (one day), "in November 2026" (the month), "by November 30" (end). */
export function titleWindow(title: string, startIso: string | undefined, today: string): { start?: string; end?: string } {
  const year = Number((startIso ?? today).slice(0, 4));
  const mi = (w: string) => MONTHS.indexOf(w.toLowerCase());
  let m: RegExpMatchArray | null;
  const ymd = (y: number, mo: number, d: number) => `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const yFor = (mo: number) => (startIso && mo < Number(startIso.slice(5, 7)) - 1 ? year + 1 : year);
  if ((m = title.match(/\bon ([A-Za-z]+) (\d{1,2})\b/)) && mi(m[1]) >= 0) { const d = ymd(yFor(mi(m[1])), mi(m[1]), Number(m[2])); return { start: d, end: d }; }
  if ((m = title.match(/\bby ([A-Za-z]+) (\d{1,2})\b/)) && mi(m[1]) >= 0) return { end: ymd(yFor(mi(m[1])), mi(m[1]), Number(m[2])) };
  if ((m = title.match(/\bin ([A-Za-z]+)(?: (\d{4}))?\??$/)) && mi(m[1]) >= 0) {
    const mo = mi(m[1]), y = m[2] ? Number(m[2]) : yFor(mo);
    return { start: ymd(y, mo, 1), end: new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10) };
  }
  return {};
}

/** Disaster/climate events -> contracts (venue polymarket). Fixed specs by slug first, then classifyPolyEvent. */
export function normalizePolyEvents(events: PEventFull[], specs: PolyEventSpec[] = POLY_EVENTS, now = new Date()): MarketContract[] {
  const out: MarketContract[] = [];
  const bySlug = new Map(specs.map((x) => [x.slug, x]));
  const today = centralDate(now);
  const seen = new Set<string>();
  for (const e of events) {
    if (!e?.slug || seen.has(e.slug)) continue;
    seen.add(e.slug);
    const spec = bySlug.get(e.slug) ?? classifyPolyEvent(e);
    if (!spec || e.closed) continue;
    const win = titleWindow(e.title, e.startDate, today);
    for (const m of e.markets ?? []) {
      if (!m?.slug || m.closed) continue;
      const outs = arr(m.outcomes), pxs = arr(m.outcomePrices).map(Number);
      if (outs.length !== 2) continue;
      if (outs[0].toLowerCase() !== "yes" && !spec.yesLabel) continue;
      const group = (m.groupItemTitle || "").trim();
      const location = spec.cityFromGroup ? placeFromGroup(group) : spec.location;
      if (!location) continue; // non-US outcome ("Indonesia") or unknown place
      const label = spec.yesLabel ?? (spec.cityFromGroup ? `${location}: ${spec.label ?? "Yes"}` : group || spec.label || m.question);
      const bounds = spec.cityFromGroup || spec.yesLabel ? null : disasterBounds(group);
      const mid = Number.isFinite(pxs[0]) ? pxs[0] : null;
      const yesAsk = price(m.bestAsk) ?? price(mid);
      const yesBid = price(m.bestBid) ?? price(mid);
      if (yesAsk === null && yesBid === null) continue; // dead / unpriced
      if ((yesAsk ?? 1) >= 0.98 && (yesBid ?? 0) <= 0.02) continue; // empty book (1¢ bid / 99¢ ask): no real price
      const id = `polymarket:${m.slug}`;
      const end = m.endDate || e.endDate || "";
      const startDay = win.start ?? (e.startDate ? centralDate(e.startDate) : today);
      const endDay = win.end ?? (end ? centralDate(end) : undefined);
      setMeta(id, {
        eventDate: startDay < today ? today : startDay, eventEnd: endDay && endDay >= today ? endDay : undefined, bounds: bounds ?? undefined,
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

async function gammaEvents(qs: string): Promise<PEventFull[]> {
  const r = await fetch(`${GAMMA}/events?${qs}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`polymarket events -> ${r.status}`);
  const rows = (await r.json()) as unknown;
  return Array.isArray(rows) ? (rows as PEventFull[]) : [];
}

async function fetchDisasters(now = new Date()): Promise<MarketContract[]> {
  const slugs = [...new Set([...POLY_EVENTS.map((x) => x.slug), ...dynamicDisasterSlugs(now)])];
  const batches: string[] = [];
  for (let i = 0; i < slugs.length; i += 25) batches.push(slugs.slice(i, i + 25).map((s) => `slug=${encodeURIComponent(s)}`).join("&"));
  const res = await Promise.allSettled([
    ...batches.map((qs) => gammaEvents(`${qs}&limit=100`)), // Gamma caps an unbounded slug query at 20 events
    ...POLY_DISASTER_TAGS.map((t) => gammaEvents(`tag_slug=${t}&closed=false&limit=100`)),
  ]);
  if (res.every((r) => r.status === "rejected")) throw new Error("polymarket disasters unreachable");
  return normalizePolyEvents(res.flatMap((r) => (r.status === "fulfilled" ? r.value : [])), POLY_EVENTS, now);
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

/** Disaster events move slowly and the pull is ~10 requests: refresh every 5 min. */
const DISASTER_TTL = 5 * 60_000;
/** Cached (60s; disasters 5 min) per source, stale-on-error, [] when never reachable. */
async function cachedSource(src: PolySource): Promise<MarketContract[]> {
  const c = cache.get(src.key);
  if (c && Date.now() - c.t < (src.key === "disaster" ? DISASTER_TTL : TTL)) return c.v;
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
    const list = Array.isArray(rows) ? rows : [];
    // not in any live source (e.g. a disaster market that closed): peril from the question so it can still settle
    return normalizePolymarkets(list)[0] ?? normalizePolymarkets(list, { key: "lookup", tagId: 0, perils: [perilFromText(list[0]?.question ?? "")], days: 0 })[0] ?? null;
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

