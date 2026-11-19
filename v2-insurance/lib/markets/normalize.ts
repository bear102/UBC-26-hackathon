// Venue payloads -> MarketContract (lib/types.ts), plus a side map of extra metadata
// (event date, numeric bounds, teams, outcome mints) that types.ts doesn't carry.
import type { MarketContract, Peril } from "../types";
import type { GContract, GEvent } from "./geminiPm";

// ---------- side map ----------

export interface Bounds {
  lo?: number;               // lower bound (value must be >= lo, or > lo when !loInclusive)
  hi?: number;               // upper bound
  loInclusive: boolean;
  hiInclusive: boolean;
  unit?: string;             // "°F" | "°C" | "$" | "%" | "in" | "pts"
  text: string;              // compact human form: "≥95°F", "74–75°F", ">$3.65"
}

export interface ContractMeta {
  eventDate?: string;        // YYYY-MM-DD (US Central) the observed thing happens (game day, weather day, period start)
  eventEnd?: string;         // YYYY-MM-DD last day of the observation period (monthly / weekend markets)
  startTime?: string;        // ISO game start
  bounds?: Bounds;
  teams?: string[];          // sports: names that identify the team the YES side is about (+ opponent in `opponents`)
  opponents?: string[];
  league?: string;           // NBA | NFL | NCAAF | NCAAM | NHL | MLS ...
  series?: string;           // Gemini series / Kalshi series ticker
  category?: string;
  station?: string;          // weather station the market resolves on (basis-risk note)
  rules?: string;            // short resolution rule text
  volume?: number;
  openInterest?: number;
  source?: "gemini" | "dflow" | "kalshi-public";
  outcomeMints?: { yesMint: string; noMint: string; settlementMint?: string; marketLedger?: string };
}

const metaMap = new Map<string, ContractMeta>();
export function setMeta(id: string, m: ContractMeta) { metaMap.set(id, m); }
/** Extra info for a contract id seen by any normalizer in this process (undefined if never seen). */
export function contractMeta(id: string): ContractMeta | undefined { return metaMap.get(id); }

// ---------- numbers / dates ----------

export function num(x: unknown): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = typeof x === "number" ? x : Number(String(x).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
/** A price on a $1 contract; 0 / >=1 mean "no quote". */
export function price(x: unknown): number | null {
  const n = num(x);
  if (n === null || n <= 0 || n >= 1) return null;
  return Math.round(n * 10000) / 10000;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** YYYY-MM-DD of an instant in US Central time. */
export function centralDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}
/** "November 19, 2026" -> "2026-11-19". */
export function parseLongDate(s: string): string | undefined {
  const m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return undefined;
  const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
  if (mi < 0) return undefined;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// ---------- label bounds ----------

const NUM = String.raw`(-?\$?-?[\d,]*\.?\d+)`;

function unitOf(s: string): string | undefined {
  if (/°\s*C\b/i.test(s)) return "°C";
  if (/°/.test(s)) return "°F";
  if (/\$/.test(s)) return "$";
  if (/%/.test(s)) return "%";
  if (/inch/i.test(s)) return "in";
  if (/points?\b/i.test(s)) return "pts";
  return undefined;
}
function fmt(n: number, unit?: string): string {
  const v = Number.isInteger(n) ? String(n) : String(n);
  if (unit === "$") return `$${v}`;
  if (unit === "in") return `${v}in`;
  if (unit === "pts") return `${v}pts`;
  return `${v}${unit ?? ""}`;
}
function boundsText(b: Omit<Bounds, "text">): string {
  if (b.lo !== undefined && b.hi !== undefined) return b.lo === b.hi ? fmt(b.lo, b.unit) : `${fmt(b.lo, b.unit)}–${fmt(b.hi, b.unit)}`;
  if (b.lo !== undefined) return `${b.loInclusive ? "≥" : ">"}${fmt(b.lo, b.unit)}`;
  if (b.hi !== undefined) return `${b.hiInclusive ? "≤" : "<"}${fmt(b.hi, b.unit)}`;
  return "";
}

/**
 * Parse numeric bounds out of a contract label. Handles Gemini ("95°F to 96°F", "78°F or above",
 * "69°F or below", "17°C", "$80 or above") and Kalshi ("76° to 77°", "Above 3.65", "Below $77.00",
 * "Above 5 inches", "Above -0.3%", "More than 23.5 points"). Returns null for non-numeric labels ("Spurs").
 */
export function parseBounds(label: string): Bounds | null {
  const s = label.trim();
  const unit = unitOf(s);
  const n = (x: string) => num(x.replace(/\$/g, "")) as number;
  let m: RegExpMatchArray | null;
  let b: Omit<Bounds, "text"> | null = null;
  if ((m = s.match(new RegExp(`${NUM}\\s*°?\\s*[FC]?\\s*(?:to|–|-)\\s*${NUM}`, "i"))) && !/^(above|below|more|less)/i.test(s)) {
    b = { lo: n(m[1]), hi: n(m[2]), loInclusive: true, hiInclusive: true, unit };
  } else if ((m = s.match(new RegExp(`${NUM}\\s*°?\\s*[FC]?\\s*(?:or|and)\\s*(above|higher|more|over)`, "i")))) {
    b = { lo: n(m[1]), loInclusive: true, hiInclusive: false, unit };
  } else if ((m = s.match(new RegExp(`${NUM}\\s*°?\\s*[FC]?\\s*(?:or|and)\\s*(below|lower|less|under)`, "i")))) {
    b = { hi: n(m[1]), loInclusive: false, hiInclusive: true, unit };
  } else if ((m = s.match(new RegExp(`^(?:above|more than|over|greater than|>)\\s*${NUM}`, "i")))) {
    b = { lo: n(m[1]), loInclusive: false, hiInclusive: false, unit };
  } else if ((m = s.match(new RegExp(`^(?:below|less than|under|<)\\s*${NUM}`, "i")))) {
    b = { hi: n(m[1]), loInclusive: false, hiInclusive: false, unit };
  } else if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*°\s*([FC])?$/i))) {
    const v = Number(m[1]);
    b = { lo: v, hi: v, loInclusive: true, hiInclusive: true, unit };
  }
  if (!b || [b.lo, b.hi].some((x) => x !== undefined && !Number.isFinite(x))) return null;
  return { ...b, text: boundsText(b) };
}

/** Does a value satisfy the bounds? (used for backtests) */
export function inBounds(v: number, b: Bounds): boolean {
  if (b.lo !== undefined && (b.loInclusive ? v < b.lo : v <= b.lo)) return false;
  if (b.hi !== undefined && (b.hiInclusive ? v > b.hi : v >= b.hi)) return false;
  return true;
}

/** Peril for a temperature bin: low-only bins are "cold", everything else "heat". */
export function tempPeril(b: Bounds | null, lowSeries = false): Peril {
  if (lowSeries) return "cold";
  if (b && b.hi !== undefined && b.lo === undefined) return "cold";
  return "heat";
}

/** Peril from free text (fallback for unknown categories). */
export function perilFromText(t: string): Peril {
  const s = t.toLowerCase();
  if (/highest temperature|maximum temperature|heat/.test(s)) return "heat";
  if (/lowest temperature|minimum temperature|freeze|cold/.test(s)) return "cold";
  if (/rain|precip|storm/.test(s)) return "rain";
  if (/\bgas prices?\b|gasoline/.test(s)) return "gas";
  if (/\boil\b|wti|brent|crude/.test(s)) return "oil";
  if (/\bfed\b|federal funds|fomc|rate (cut|hike)/.test(s)) return "fed";
  if (/\bcpi\b|inflation/.test(s)) return "cpi";
  if (/bitcoin|\bbtc\b|\beth\b|ether|solana|\bsol\b|crypto/.test(s)) return "crypto";
  return "other";
}

// ---------- Gemini ----------

export const geminiUrl = (eventTicker: string) => `https://www.gemini.com/predictions/${encodeURIComponent(eventTicker)}`;

function geminiPrices(c: GContract) {
  const p = c.prices ?? {};
  const bestBid = price(p.bestBid), bestAsk = price(p.bestAsk);
  const yesAsk = price(p.buy?.yes) ?? bestAsk;
  const yesBid = price(p.sell?.yes) ?? bestBid;
  const noAsk = price(p.buy?.no) ?? (yesBid !== null ? price(1 - yesBid) : null);
  const noBid = price(p.sell?.no) ?? (yesAsk !== null ? price(1 - yesAsk) : null);
  return { yesAsk, yesBid, noAsk, noBid };
}

function geminiStatus(e: GEvent, c: GContract): MarketContract["status"] {
  const rs = (c.resolutionSide ?? "").toLowerCase();
  if (rs === "yes" || rs === "no" || c.status === "settled" || e.status === "settled") return "settled";
  if (c.status !== "active" || (c.marketState && c.marketState !== "open") || e.status !== "active") return "closed";
  return "open";
}

const SPORT_PREFIX = /^(NBA|NFL|NHL|NCAAF|NCAAM|NCAAW|WNBA|MLB|MLS|UCL|EPL|LALIGA|LIGAMX)-/;

/**
 * Gemini events -> MarketContract[]. Keeps weather, commodities, crypto, sports moneylines ("-M" events);
 * drops sports props/spreads/totals unless `includeProps`.
 */
export function normalizeGeminiEvents(events: GEvent[], opts: { includeProps?: boolean } = {}): MarketContract[] {
  const out: MarketContract[] = [];
  for (const e of events) {
    const cat = (e.category ?? "").toLowerCase();
    let kind: "weather" | "sports" | "commodity" | "crypto" | "other";
    if (cat === "weather") kind = "weather";
    else if (cat === "sports") kind = "sports";
    else if (cat === "commodities") kind = "commodity";
    else if (cat === "crypto") kind = "crypto";
    else kind = "other";
    if (kind === "sports" && !opts.includeProps && !/-M$/.test(e.ticker)) continue;

    let location: string | undefined;
    let eventDate: string | undefined;
    let station: string | undefined;
    let lowSeries = false;
    const wm = e.title.match(/(Highest|Lowest) temperature in (.+?) on (.+?)\??$/i);
    if (kind === "weather" && wm) {
      lowSeries = /lowest/i.test(wm[1]);
      location = wm[2].trim();
      eventDate = parseLongDate(wm[3]);
    }
    const sm = SPORT_PREFIX.exec(e.ticker);
    if (kind === "sports" && e.startTime) eventDate = centralDate(e.startTime);
    if ((kind === "commodity" || kind === "crypto") && e.expiryDate) eventDate = centralDate(e.expiryDate);
    if (kind === "other") {
      const d = parseLongDate(e.title);
      eventDate = d ?? (e.expiryDate ? centralDate(e.expiryDate) : undefined);
    }

    for (const c of e.contracts ?? []) {
      const bounds = parseBounds(c.label);
      let peril: Peril;
      if (kind === "weather") peril = wm ? tempPeril(bounds, lowSeries) : perilFromText(e.title);
      else if (kind === "sports") peril = "game";
      else if (kind === "commodity") peril = /\b(WTI|Brent|crude)\b|^Oil/i.test(e.title) ? "oil" : /gasoline|gas prices/i.test(e.title) ? "gas" : "other";
      else if (kind === "crypto") peril = "crypto";
      else peril = perilFromText(e.title);

      if (kind === "weather" && !station) {
        const desc = typeof c.description === "object" ? JSON.stringify(c.description) : String(c.description ?? "");
        const st = desc.match(/recorded at ([^,."]+?)(?:,| on )/);
        if (st) station = st[1].trim();
      }

      const id = `gemini:${c.instrumentSymbol}`;
      const px = geminiPrices(c);
      const mc: MarketContract = {
        id, venue: "gemini", eventTitle: e.title, label: c.label, symbol: c.instrumentSymbol, eventTicker: e.ticker,
        peril, location, expiry: c.expiryDate ?? e.expiryDate ?? "",
        ...px,
        url: geminiUrl(e.ticker),
        tradable: false,
        status: geminiStatus(e, c),
        resolution: c.resolutionSide === "yes" ? "yes" : c.resolutionSide === "no" ? "no" : null,
      };
      const meta: ContractMeta = { eventDate, bounds: bounds ?? undefined, series: typeof e.series === "string" ? e.series : undefined, category: e.category, station, source: "gemini", volume: num(e.volume) ?? undefined };
      if (kind === "sports") {
        meta.startTime = e.startTime ?? undefined;
        meta.league = sm?.[1];
        meta.teams = [c.label, c.target?.name].filter((x): x is string => !!x);
        meta.opponents = e.contracts.filter((o) => o !== c).flatMap((o) => [o.label, o.target?.name]).filter((x): x is string => !!x);
      }
      setMeta(id, meta);
      out.push(mc);
    }
  }
  return out;
}
