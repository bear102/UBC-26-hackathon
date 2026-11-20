// Market explorer data (/markets): the live universe the AI searches, grouped into events by risk type and place,
// with the same event on Gemini / Kalshi / Polymarket merged into one row and outcomes aligned across venues.
// Server-only; cached 60s with stale-while-revalidate, kept warm by instrumentation.ts (listMarkets caches each venue 45-60s).
import type { MarketContract, Peril, VenueId } from "../types";
import { teamCities } from "./teams";
import { listMarkets } from "./index";
import { listParametric, PARAMETRIC_PERILS } from "./parametric";
import { parametricEnabled } from "./proxies";
import { boundsKey, boundsOf, eventDay, family, gameInfo, sideProb, underlying } from "./compare";

export type RiskGroup = "heat" | "rain" | "snow" | "power" | "disaster" | "games" | "energy" | "commodities" | "rates" | "crypto" | "parametric" | "other";
export const RISK_GROUPS: { id: RiskGroup; label: string; perils: Peril[] }[] = [
  { id: "heat", label: "Heat & cold", perils: ["heat", "cold"] },
  { id: "rain", label: "Rain", perils: ["rain"] },
  { id: "snow", label: "Snow & winter", perils: ["snow"] },
  { id: "power", label: "Power & grid", perils: ["power"] },
  { id: "disaster", label: "Water, quakes & storms", perils: ["water", "quake", "storm", "flood"] }, // flood: real river / sea-level markets
  { id: "games", label: "Games", perils: ["game"] },
  { id: "energy", label: "Fuel & oil", perils: ["oil", "gas"] },
  { id: "commodities", label: "Natural gas & metals", perils: ["natgas", "metals"] },
  { id: "rates", label: "Rates & inflation", perils: ["fed", "cpi"] },
  { id: "crypto", label: "Crypto", perils: ["crypto"] },
  // Hedgehog parametric contracts (venue "hedgehog"), only when HEDGEHOG_PARAMETRIC=1 (buildExplorer routes them here by venue)
  { id: "parametric", label: "Parametric (Hedgehog)", perils: ["smoke", "hail", "wildfire"] },
  { id: "other", label: "Other", perils: ["other"] },
];
export const groupOf = (p: Peril): RiskGroup => RISK_GROUPS.find((g) => g.perils.includes(p))?.id ?? "other";

/** One venue's quote for an outcome: chance (midpoint), ask (cost per $1), depth; s="no" when it is that market's NO side. */
export interface Cell { p: number | null; a: number | null; d?: number; s?: "no" }
export interface ExplorerOutcome { key: string; label: string; cells: Partial<Record<VenueId, Cell>> }
export interface ExplorerEvent {
  key: string;
  group: RiskGroup;
  peril: Peril;
  title: string;
  place: string;                  // city (weather), league (games), "US" (national), "" otherwise
  cities?: string[];              // games: home cities of both teams (so the city filter finds "Cleveland" games)
  date: string;                   // YYYY-MM-DD (US Central) of the observed thing
  expiry: string;                 // earliest expiry across venues
  venues: { venue: VenueId; title: string; url?: string; n: number }[];
  outcomes: ExplorerOutcome[];
  spreadPts?: number;             // biggest cross-venue gap on one outcome (points), when ≥2 venues quote it
}
export interface ExplorerData {
  asOf: string;
  total: number;
  counts: Record<VenueId, number>;
  events: ExplorerEvent[];
  places: string[];
}

const ORDER: VenueId[] = ["gemini", "kalshi", "polymarket", "hedgehog"];
const NATIONAL: Peril[] = ["oil", "gas", "fed", "cpi", "natgas", "metals"];
/** Groups whose events are tied to a place (city filter applies). */
export const LOCAL_GROUPS: RiskGroup[] = ["heat", "rain", "snow", "power", "disaster", "parametric"];

function placeOf(c: MarketContract): string {
  if (c.peril === "game") return gameInfo(c).league ?? "";
  if (NATIONAL.includes(c.peril)) return "US";
  if (c.peril === "crypto" || c.peril === "other") return "";
  const l = (c.location ?? "").split(",")[0].trim();
  return /^(nyc|new york)$/i.test(l) ? "New York City" : /^washington,? ?dc$/i.test(l) ? "Washington DC" : l;
}

function eventKey(c: MarketContract): string {
  const day = eventDay(c);
  if (c.peril === "game") {
    const g = gameInfo(c);
    const who = g.pair ? [...g.pair].sort().join("/") : [c.eventTitle.toLowerCase()].join("");
    return `game|${(g.league ?? "").slice(0, 3)}|${day}|${who}`;
  }
  return `${family(c.peril)}|${underlying(c)}|${day}|${placeOf(c).toLowerCase()}|${family(c.peril) === "heat" || c.peril === "rain" ? "" : c.eventTicker}`;
}

/** Outcome alignment key inside an event: team abbreviation for games, bounds for ladders, else the label. */
function outcomeKey(c: MarketContract): string {
  if (c.peril === "game") { const g = gameInfo(c); return g.yes ?? c.label.toLowerCase(); }
  return boundsKey(boundsOf(c)) ?? c.label.toLowerCase().trim();
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function buildExplorer(markets: MarketContract[], now = Date.now()): ExplorerData {
  const counts: Record<VenueId, number> = { gemini: 0, kalshi: 0, polymarket: 0, hedgehog: 0 };
  const byKey = new Map<string, { ev: ExplorerEvent; outs: Map<string, ExplorerOutcome> }>();
  for (const c of markets) {
    if (c.status !== "open") continue;
    const exp = Date.parse(c.expiry);
    if (Number.isFinite(exp) && exp < now + 20 * 60_000) continue;               // about to close
    if (c.peril === "crypto" && Number.isFinite(exp) && exp < now + 6 * 3600_000) continue; // 5-15 min crypto ladders: noise for a business
    counts[c.venue]++;
    const key = eventKey(c);
    let e = byKey.get(key);
    if (!e) {
      e = { ev: { key, group: c.venue === "hedgehog" ? "parametric" : groupOf(c.peril), peril: family(c.peril), title: c.eventTitle, place: placeOf(c), date: eventDay(c), expiry: c.expiry, venues: [], outcomes: [] }, outs: new Map() };
      byKey.set(key, e);
    }
    const ev = e.ev;
    if (c.peril === "game") { const tc = teamCities(c); if (tc.length) ev.cities = [...new Set([...(ev.cities ?? []), ...tc])]; }
    let v = ev.venues.find((x) => x.venue === c.venue);
    if (!v) { v = { venue: c.venue, title: c.eventTitle, url: c.url, n: 0 }; ev.venues.push(v); }
    v.n++;
    if (c.expiry && (!ev.expiry || c.expiry < ev.expiry)) ev.expiry = c.expiry;
    const add = (k: string, label: string, cell: Cell) => {
      let o = e!.outs.get(k);
      if (!o) { o = { key: k, label, cells: {} }; e!.outs.set(k, o); }
      if (!o.cells[c.venue]) o.cells[c.venue] = cell;
    };
    const p = sideProb(c, "yes");
    const cell: Cell = { p, a: c.yesAsk };
    if (c.depthYes !== undefined) cell.d = Math.round(c.depthYes);
    add(outcomeKey(c), c.label, cell);
    // Polymarket game markets are one market per game: also show the other team (= NO side).
    if (c.venue === "polymarket" && c.peril === "game") {
      const g = gameInfo(c);
      const other = g.pair?.find((x) => x !== g.yes);
      const otherName = c.eventTitle.split(/\s+vs\.?\s+/i).find((x) => x.trim().toLowerCase() !== c.label.toLowerCase())?.trim();
      if (other) add(other, otherName ?? other, { p: p === null ? null : r3(1 - p), a: c.noAsk, s: "no" });
    }
  }
  const events: ExplorerEvent[] = [];
  for (const { ev, outs } of byKey.values()) {
    ev.venues.sort((a, b) => ORDER.indexOf(a.venue) - ORDER.indexOf(b.venue));
    // prefer Gemini's naming for the event and outcomes
    ev.title = ev.venues[0].title;
    ev.outcomes = [...outs.values()];
    if (ev.peril !== "game") {
      const num = (o: ExplorerOutcome) => { const [lo, hi] = o.key.split("|"); const n = Number(lo !== "" ? lo : hi); return Number.isFinite(n) ? n : 0; };
      ev.outcomes.sort((a, b) => num(a) - num(b));
    }
    let spread = -1;
    for (const o of ev.outcomes) {
      const ps = ORDER.map((v) => o.cells[v]?.p).filter((x): x is number => typeof x === "number");
      if (ps.length >= 2) spread = Math.max(spread, Math.round((Math.max(...ps) - Math.min(...ps)) * 100));
    }
    if (spread >= 0) ev.spreadPts = spread;
    events.push(ev);
  }
  events.sort((a, b) => (b.venues.length - a.venues.length) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const places = [...new Set([
    ...events.filter((e) => LOCAL_GROUPS.includes(e.group)).map((e) => e.place),
    ...events.flatMap((e) => e.cities ?? []),
  ].filter((p) => p && p !== "US"))]
    .sort((a, b) => (a === "Austin" ? -1 : b === "Austin" ? 1 : a.localeCompare(b)));
  return { asOf: new Date(now).toISOString(), total: counts.gemini + counts.kalshi + counts.polymarket + counts.hedgehog, counts, events, places };
}

type ExplorerCache = { t: number; v: ExplorerData; p?: Promise<ExplorerData> } | null;
// On globalThis so the /markets page and the background warmer (instrumentation.ts) share one cache.
const G = globalThis as { __hhExplorer?: ExplorerCache };
const TTL = 60_000;
/** How old a good snapshot may be and still be shown instantly while a refresh runs (a cold venue pass takes ~20s). */
const STALE_MAX = 30 * 60_000;

/** Cached explorer data: fresh for 60s, then stale-while-revalidate (up to 30 min), stale-on-error. */
export async function getExplorerData(): Promise<ExplorerData> {
  const cache = G.__hhExplorer ?? null;
  if (cache && cache.v.total > 0 && Date.now() - cache.t < TTL) return cache.v;
  const staleOk = !!cache && cache.v.total > 0 && Date.now() - cache.t < STALE_MAX;
  if (cache?.p) return staleOk ? cache.v : cache.p;
  const p = refresh(cache);
  return staleOk ? cache!.v : p;
}

function refresh(prev: ExplorerCache): Promise<ExplorerData> {
  const p = Promise.all([listMarkets({ venues: ["gemini", "kalshi", "polymarket"] }), parametricEnabled() ? explorerParametric() : Promise.resolve([])])
    .then(([live, par]) => {
      const ms = [...live, ...par];
      const v = buildExplorer(ms);
      // keep the previous snapshot if every venue came back empty (outage), but retry soon
      G.__hhExplorer = v.total > 0 || !prev ? { t: Date.now(), v } : { t: prev.t, v: prev.v };
      return G.__hhExplorer.v;
    })
    .catch((e) => { if (prev) { G.__hhExplorer = { t: prev.t, v: prev.v }; return prev.v; } G.__hhExplorer = null; throw e; });
  G.__hhExplorer = { t: prev?.t ?? 0, v: prev?.v ?? { asOf: "", total: 0, counts: { gemini: 0, kalshi: 0, polymarket: 0, hedgehog: 0 }, events: [], places: [] }, p };
  return p;
}

/** Hedgehog parametric contracts shown in the explorer (next 7 / 30 days) for a few demo cities. A cold history pull
 *  (~20 s) never blocks the page: whatever is ready within 12 s is shown, the rest fills the cache for the next pass. */
export const EXPLORER_PARAMETRIC_CITIES = ["Austin, TX", "Houston, TX", "Denver, CO", "Los Angeles, CA"];
async function explorerParametric(): Promise<MarketContract[]> {
  const all = Promise.all(EXPLORER_PARAMETRIC_CITIES.map((c) => listParametric(PARAMETRIC_PERILS, c).catch(() => []))).then((x) => x.flat());
  return Promise.race([all, new Promise<MarketContract[]>((r) => setTimeout(() => r([]), 12_000))]);
}

/** Background warmer: refresh if older than the TTL so a visitor never waits for a cold venue pass. */
export async function warmExplorer(): Promise<void> {
  const c = G.__hhExplorer;
  if (c?.p || (c && c.v.total > 0 && Date.now() - c.t < TTL - 10_000)) return;
  await refresh(c ?? null).catch(() => undefined);
}
