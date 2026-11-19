// Kalshi markets for Hedgehog, read-only. Primary source: DFlow Prediction Markets Metadata API
// (env.dflowMeta(); exposes the Solana YES/NO outcome mints). Fallback: Kalshi's public trade API
// (same markets, same tickers, no mints). No keys required for either; nothing here places orders.
//
// Status 2026-11-19: dev-prediction-markets-api.dflow.net does not resolve (NXDOMAIN) and
// prediction-markets-api.dflow.net answers 403 without an x-api-key, so the Kalshi fallback serves
// the data until a DFlow key (DFLOW_API_KEY + DFLOW_METADATA_BASE) is configured.
import { env } from "../env";
import type { MarketContract, Peril } from "../types";
import { addDays, centralDate, num, parseBounds, price, setMeta, tempPeril, type ContractMeta } from "./normalize";

export const KALSHI_PUBLIC = "https://api.elections.kalshi.com/trade-api/v2";

/** Kalshi series Hedgehog indexes. `location: "subtitle"` = multi-city series, city is the market's yes_sub_title. */
export interface SeriesSpec { series: string; peril: Peril; location?: string; league?: string; low?: boolean; period?: "day" | "weekend" | "month" | "game" | "other" }
export const SERIES: SeriesSpec[] = [
  // Austin weather
  { series: "KXRAIN", peril: "rain", location: "subtitle", period: "day" },          // "Will it rain in <city> on <date>?" (Austin included)
  { series: "KXRAINDAUS", peril: "rain", location: "Austin", period: "day" },
  { series: "KXRAINWKND", peril: "rain", location: "subtitle", period: "weekend" },  // weekend rain, per city
  { series: "KXRAINTHANKSGIVING", peril: "rain", location: "subtitle", period: "day" },
  { series: "KXRAINAUSM", peril: "rain", location: "Austin", period: "month" },      // monthly Austin rainfall totals
  { series: "KXHIGHAUS", peril: "heat", location: "Austin", period: "day" },
  { series: "KXLOWTAUS", peril: "cold", location: "Austin", low: true, period: "day" },
  // nearby / other big cities (free-text businesses)
  { series: "KXHIGHTDAL", peril: "heat", location: "Dallas", period: "day" },
  { series: "KXHIGHTHOU", peril: "heat", location: "Houston", period: "day" },
  { series: "KXHIGHNY", peril: "heat", location: "NYC", period: "day" },
  { series: "KXHIGHCHI", peril: "heat", location: "Chicago", period: "day" },
  { series: "KXHIGHMIA", peril: "heat", location: "Miami", period: "day" },
  { series: "KXHIGHLAX", peril: "heat", location: "Los Angeles", period: "day" },
  { series: "KXHIGHDEN", peril: "heat", location: "Denver", period: "day" },
  // national economic perils
  { series: "KXAAAGASW", peril: "gas", period: "other" },   // AAA US avg gas price, weekly
  { series: "KXAAAGASM", peril: "gas", period: "other" },   // monthly
  { series: "KXWTI", peril: "oil", period: "other" },
  { series: "KXWTIW", peril: "oil", period: "other" },
  { series: "KXFEDDECISION", peril: "fed", period: "other" },
  { series: "KXFED", peril: "fed", period: "other" },
  { series: "KXCPI", peril: "cpi", period: "other" },
  { series: "KXCPIYOY", peril: "cpi", period: "other" },
  // games (Spurs, Rockets, Texans, Longhorns, Austin FC)
  { series: "KXNBAGAME", peril: "game", league: "NBA", period: "game" },
  { series: "KXNFLGAME", peril: "game", league: "NFL", period: "game" },
  { series: "KXNCAAFGAME", peril: "game", league: "NCAAF", period: "game" },
  { series: "KXMLSGAME", peril: "game", league: "MLS", period: "game" },
];
export const seriesSpec = (series: string): SeriesSpec | undefined => SERIES.find((s) => s.series === series);
const specForTicker = (ticker: string): SeriesSpec => seriesSpec(ticker.split("-")[0]) ?? { series: ticker.split("-")[0], peril: "other", period: "other" };

// ---------- HTTP with cache + 429 backoff ----------

const cache = new Map<string, { t: number; v: unknown }>();
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function getJson<T>(url: string, ttlMs: number, headers: Record<string, string> = {}): Promise<T> {
  const c = cache.get(url);
  if (ttlMs > 0 && c && Date.now() - c.t < ttlMs) return c.v as T;
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get("retry-after"));
        lastErr = new HttpError(r.status, `GET ${url} -> ${r.status}`);
        await new Promise((res) => setTimeout(res, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 800 * 2 ** i));
        continue;
      }
      if (!r.ok) throw new HttpError(r.status, `GET ${url} -> ${r.status}`);
      const v = (await r.json()) as T;
      cache.set(url, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      // DNS / network errors: don't hammer
      if (!(e instanceof HttpError)) break;
    }
  }
  if (c) return c.v as T; // stale-on-error
  throw lastErr;
}

// ---------- Raw shapes ----------

/** Kalshi public trade-api v2 market (fields we use). */
export interface KMarket {
  ticker: string; event_ticker: string; title?: string; yes_sub_title?: string; no_sub_title?: string;
  status: string; result?: string; close_time?: string; occurrence_datetime?: string; expected_expiration_time?: string;
  yes_ask_dollars?: string; yes_bid_dollars?: string; no_ask_dollars?: string; no_bid_dollars?: string;
  yes_ask_size_fp?: string; yes_bid_size_fp?: string; volume_fp?: string; open_interest_fp?: string;
  rules_primary?: string; floor_strike?: number; cap_strike?: number; strike_type?: string;
}
export interface KEvent { event_ticker: string; series_ticker: string; title: string; sub_title?: string; markets?: KMarket[] }

/** DFlow metadata market (defensive: field names per DFlow docs/QuickNode guide; any missing field is tolerated). */
interface DMarket {
  ticker: string; eventTicker?: string; title?: string; subtitle?: string; yesSubTitle?: string; noSubTitle?: string;
  status?: string; result?: string; closeTime?: number | string; expirationTime?: number | string;
  yesAsk?: number | string | null; yesBid?: number | string | null; noAsk?: number | string | null; noBid?: number | string | null;
  volume?: number; openInterest?: number; rulesPrimary?: string;
  accounts?: Record<string, { yesMint?: string; noMint?: string; marketLedger?: string; isInitialized?: boolean }>;
}
interface DEvent { ticker: string; seriesTicker?: string; title: string; subtitle?: string; markets?: DMarket[] }

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ---------- DFlow availability ----------

let dflowState: { ok: boolean; checkedAt: number; reason?: string } | null = null;
const dflowHeaders = (): Record<string, string> => (process.env.DFLOW_API_KEY ? { "x-api-key": process.env.DFLOW_API_KEY } : {});

/** Which source currently serves Kalshi data. */
export function kalshiSource(): { source: "dflow" | "kalshi-public"; dflowReason?: string } {
  return dflowState?.ok ? { source: "dflow" } : { source: "kalshi-public", dflowReason: dflowState?.reason };
}

async function dflowUsable(): Promise<boolean> {
  if (process.env.HEDGEHOG_DISABLE_DFLOW === "1") { dflowState = { ok: false, checkedAt: Date.now(), reason: "disabled" }; return false; }
  if (dflowState && Date.now() - dflowState.checkedAt < 10 * 60_000) return dflowState.ok;
  try {
    await getJson<unknown>(`${env.dflowMeta()}/events?limit=1`, 60_000, dflowHeaders());
    dflowState = { ok: true, checkedAt: Date.now() };
  } catch (e) {
    dflowState = { ok: false, checkedAt: Date.now(), reason: e instanceof Error ? e.message.replace(/https?:\/\/\S+/, env.dflowMeta()) : String(e) };
  }
  return dflowState.ok;
}

// ---------- Normalization ----------

const kalshiUrl = (series: string) => `https://kalshi.com/markets/${series.toLowerCase()}`;
const MON: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

/** "KXHIGHAUS-26NOV19" -> {date:"2026-11-19"}; "KXRAINAUSM-26NOV" -> {month:"2026-11"}. */
export function kalshiTickerDate(eventTicker: string): { date?: string; month?: string } {
  const m = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})?/);
  if (!m || !MON[m[2]]) return {};
  const ym = `20${m[1]}-${String(MON[m[2]]).padStart(2, "0")}`;
  return m[3] ? { date: `${ym}-${m[3]}`, month: ym } : { month: ym };
}

function lastDayOfMonth(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

function kStatus(s: string | undefined, result: string | undefined): MarketContract["status"] {
  const st = (s ?? "").toLowerCase();
  if (result === "yes" || result === "no" || ["settled", "finalized", "determined"].includes(st)) return "settled";
  if (["active", "open", "initialized"].includes(st)) return "open";
  return "closed";
}

interface Common {
  ticker: string; eventTicker: string; eventTitle: string; label: string; status: string; result?: string;
  closeTime?: string; occurrence?: string; yesAsk: unknown; yesBid: unknown; noAsk: unknown; noBid: unknown;
  depthYes?: number; depthNo?: number; volume?: number; openInterest?: number; rules?: string;
  outcomeMints?: ContractMeta["outcomeMints"]; source: "dflow" | "kalshi-public";
}

function toContract(c: Common, spec: SeriesSpec): MarketContract {
  const bounds = parseBounds(c.label) ?? parseBounds(c.eventTitle.match(/(above|below)\s+\$?[\d.]+/i)?.[0] ?? "");
  const peril: Peril = spec.peril === "heat" || spec.peril === "cold" ? tempPeril(bounds, !!spec.low) : spec.peril;
  const location = spec.location === "subtitle" ? c.label : spec.location;
  const td = kalshiTickerDate(c.eventTicker);
  let eventDate: string | undefined, eventEnd: string | undefined;
  if (spec.period === "game" && c.occurrence) eventDate = centralDate(c.occurrence);
  else if (spec.period === "month" && td.month) { eventDate = `${td.month}-01`; eventEnd = lastDayOfMonth(td.month); }
  else if (spec.period === "weekend" && td.date) { eventDate = td.date; eventEnd = addDays(td.date, 1); }
  else if (td.date) eventDate = td.date;
  else if (c.closeTime) eventDate = centralDate(c.closeTime);
  const id = `kalshi:${c.ticker}`;
  const yesAsk = price(c.yesAsk), yesBid = price(c.yesBid);
  const noAsk = price(c.noAsk) ?? (yesBid !== null ? price(1 - yesBid) : null);
  const noBid = price(c.noBid) ?? (yesAsk !== null ? price(1 - yesAsk) : null);
  const status = kStatus(c.status, c.result);
  const meta: ContractMeta = {
    eventDate, eventEnd, bounds: bounds ?? undefined, series: spec.series, category: spec.peril, rules: c.rules,
    volume: c.volume, openInterest: c.openInterest, source: c.source, outcomeMints: c.outcomeMints,
  };
  if (spec.period === "game") {
    meta.league = spec.league; meta.startTime = c.occurrence;
    const t = c.eventTitle.split(/\s+(?:vs\.?|at|@)\s+/i).map((x) => x.trim()).filter(Boolean);
    meta.teams = [c.label];
    meta.opponents = t.filter((x) => x.toLowerCase() !== c.label.toLowerCase());
  }
  setMeta(id, meta);
  return {
    id, venue: "kalshi", eventTitle: c.eventTitle, label: c.label, symbol: c.ticker, eventTicker: c.eventTicker,
    peril, location, expiry: c.closeTime ?? "",
    yesAsk, yesBid, noAsk, noBid,
    depthYes: c.depthYes, depthNo: c.depthNo,
    url: kalshiUrl(spec.series), tradable: true, status,
    resolution: c.result === "yes" ? "yes" : c.result === "no" ? "no" : null,
  };
}

export function normalizeKalshiEvent(e: KEvent, spec: SeriesSpec = specForTicker(e.event_ticker)): MarketContract[] {
  return (e.markets ?? []).map((m) => toContract({
    ticker: m.ticker, eventTicker: m.event_ticker || e.event_ticker, eventTitle: e.title || m.title || m.ticker,
    label: m.yes_sub_title || m.title || m.ticker, status: m.status, result: m.result || undefined,
    closeTime: m.close_time, occurrence: m.occurrence_datetime || m.expected_expiration_time,
    yesAsk: m.yes_ask_dollars, yesBid: m.yes_bid_dollars, noAsk: m.no_ask_dollars, noBid: m.no_bid_dollars,
    depthYes: num(m.yes_ask_size_fp) ?? undefined, depthNo: num(m.yes_bid_size_fp) ?? undefined, // NO ask = 1 - YES bid
    volume: num(m.volume_fp) ?? undefined, openInterest: num(m.open_interest_fp) ?? undefined,
    rules: m.rules_primary, source: "kalshi-public",
  }, spec));
}

const dPrice = (x: unknown) => { const n = num(x); return n === null ? null : n > 1 ? n / 100 : n; };
const dTime = (x: number | string | undefined) => x === undefined ? undefined : typeof x === "number" ? new Date(x * (x < 1e12 ? 1000 : 1)).toISOString() : x;

export function normalizeDflowEvent(e: DEvent, spec: SeriesSpec = specForTicker(e.ticker)): MarketContract[] {
  return (e.markets ?? []).map((m) => {
    const accts = m.accounts ?? {};
    const key = accts[USDC_MAINNET] ? USDC_MAINNET : Object.keys(accts)[0];
    const a = key ? accts[key] : undefined;
    return toContract({
      ticker: m.ticker, eventTicker: m.eventTicker || e.ticker, eventTitle: e.title || m.title || m.ticker,
      label: m.yesSubTitle || m.subtitle || m.title || m.ticker, status: m.status ?? "active", result: m.result || undefined,
      closeTime: dTime(m.closeTime), occurrence: dTime(m.expirationTime),
      yesAsk: dPrice(m.yesAsk), yesBid: dPrice(m.yesBid), noAsk: dPrice(m.noAsk), noBid: dPrice(m.noBid),
      volume: m.volume, openInterest: m.openInterest, rules: m.rulesPrimary, source: "dflow",
      outcomeMints: a?.yesMint && a?.noMint ? { yesMint: a.yesMint, noMint: a.noMint, settlementMint: key, marketLedger: a.marketLedger } : undefined,
    }, spec);
  });
}

// ---------- Fetchers ----------

async function kalshiSeries(spec: SeriesSpec, status: "open" | "settled", extra = ""): Promise<MarketContract[]> {
  const out: MarketContract[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const url = `${KALSHI_PUBLIC}/events?series_ticker=${spec.series}&status=${status}&with_nested_markets=true&limit=200${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await getJson<{ events: KEvent[]; cursor?: string }>(url, status === "open" ? 60_000 : 30 * 60_000);
    for (const e of r.events ?? []) out.push(...normalizeKalshiEvent(e, spec));
    if (!r.cursor || (r.events ?? []).length < 200) break;
    cursor = r.cursor;
  }
  return out;
}

async function dflowSeries(spec: SeriesSpec): Promise<MarketContract[]> {
  const out: MarketContract[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const url = `${env.dflowMeta()}/events?seriesTickers=${spec.series}&withNestedMarkets=true&status=active&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await getJson<{ events: DEvent[]; cursor?: string | number | null }>(url, 60_000, dflowHeaders());
    for (const e of r.events ?? []) out.push(...normalizeDflowEvent(e, spec));
    if (!r.cursor || (r.events ?? []).length < 200) break;
    cursor = String(r.cursor);
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const res: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { res[k] = { status: "fulfilled", value: await f(items[k]) }; } catch (reason) { res[k] = { status: "rejected", reason }; }
    }
  }));
  return res;
}

/** Open Kalshi markets for the indexed series (optionally only some perils). DFlow first, Kalshi public fallback. */
export async function listKalshiMarkets(perils?: Peril[]): Promise<MarketContract[]> {
  const specs = SERIES.filter((s) => !perils || perils.includes(s.peril) || (s.peril === "heat" && perils.includes("cold")) || (s.peril === "cold" && perils.includes("heat")));
  const useDflow = await dflowUsable();
  const results = await pool(specs, 4, async (spec) => {
    if (useDflow) {
      try { return await dflowSeries(spec); } catch { /* fall through */ }
    }
    return kalshiSeries(spec, "open");
  });
  const out: MarketContract[] = [];
  for (const r of results) if (r.status === "fulfilled") out.push(...r.value);
  return out;
}

/** Fresh single Kalshi market (with result when settled). */
export async function getKalshiContract(ticker: string): Promise<MarketContract | null> {
  const spec = specForTicker(ticker);
  if (await dflowUsable()) {
    try {
      const m = await getJson<DMarket>(`${env.dflowMeta()}/market/${encodeURIComponent(ticker)}`, 0, dflowHeaders());
      const e = m.eventTicker ? await getJson<DEvent>(`${env.dflowMeta()}/event/${encodeURIComponent(m.eventTicker)}`, 5 * 60_000, dflowHeaders()).catch(() => null) : null;
      return normalizeDflowEvent({ ticker: m.eventTicker ?? ticker, title: e?.title ?? m.title ?? ticker, markets: [m] }, spec)[0] ?? null;
    } catch { /* fall back */ }
  }
  try {
    const { market } = await getJson<{ market: KMarket }>(`${KALSHI_PUBLIC}/markets/${encodeURIComponent(ticker)}`, 0);
    const ev = await getJson<{ event: KEvent }>(`${KALSHI_PUBLIC}/events/${encodeURIComponent(market.event_ticker)}`, 5 * 60_000).catch(() => null);
    return normalizeKalshiEvent({ event_ticker: market.event_ticker, series_ticker: spec.series, title: ev?.event?.title ?? market.title ?? ticker, markets: [market] }, spec)[0] ?? null;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** Settled Kalshi markets of a series closed in the last `days` days (for hit-rate backtests). */
export async function settledKalshi(series: string, days: number): Promise<MarketContract[]> {
  const spec = specForTicker(series);
  const minTs = Math.floor(Date.now() / 1000) - days * 86400;
  return kalshiSeries(spec, "settled", `&min_close_ts=${minTs}`);
}

export type BookLevels = { yes: { price: number; size: number }[]; no: { price: number; size: number }[] };

/** Kalshi order book as ASK ladders per side (Kalshi publishes bids only: YES ask = 1 - NO bid). */
export async function kalshiBook(ticker: string): Promise<BookLevels> {
  const r = await getJson<{ orderbook_fp?: { yes_dollars?: [string, string][] | null; no_dollars?: [string, string][] | null } }>(
    `${KALSHI_PUBLIC}/markets/${encodeURIComponent(ticker)}/orderbook`, 5_000);
  const conv = (bids: [string, string][] | null | undefined) => (bids ?? [])
    .map(([p, s]) => ({ price: Math.round((1 - Number(p)) * 10000) / 10000, size: Number(s) }))
    .filter((l) => l.price > 0 && l.price < 1 && l.size > 0)
    .sort((a, b) => a.price - b.price);
  return { yes: conv(r.orderbook_fp?.no_dollars), no: conv(r.orderbook_fp?.yes_dollars) };
}
