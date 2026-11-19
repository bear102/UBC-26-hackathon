// Market explorer data (/markets): the live universe the AI searches, grouped into events by risk type and place,
// with the same event on Gemini / Kalshi / Polymarket merged into one row and outcomes aligned across venues.
// Server-only; cached 60s (listMarkets itself caches each venue for 45-60s).
import type { MarketContract, Peril, VenueId } from "../types";
import { listMarkets } from "./index";
import { boundsKey, boundsOf, eventDay, family, gameInfo, sideProb, underlying } from "./compare";

export type RiskGroup = "heat" | "rain" | "games" | "energy" | "rates" | "crypto" | "other";
export const RISK_GROUPS: { id: RiskGroup; label: string; perils: Peril[] }[] = [
  { id: "heat", label: "Heat & cold", perils: ["heat", "cold"] },
  { id: "rain", label: "Rain", perils: ["rain"] },
  { id: "games", label: "Games", perils: ["game"] },
  { id: "energy", label: "Oil & gas", perils: ["oil", "gas"] },
  { id: "rates", label: "Rates & inflation", perils: ["fed", "cpi"] },
  { id: "crypto", label: "Crypto", perils: ["crypto"] },
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

const ORDER: VenueId[] = ["gemini", "kalshi", "polymarket"];
const NATIONAL: Peril[] = ["oil", "gas", "fed", "cpi"];

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
  const counts: Record<VenueId, number> = { gemini: 0, kalshi: 0, polymarket: 0 };
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
      e = { ev: { key, group: groupOf(c.peril), peril: family(c.peril), title: c.eventTitle, place: placeOf(c), date: eventDay(c), expiry: c.expiry, venues: [], outcomes: [] }, outs: new Map() };
      byKey.set(key, e);
    }
    const ev = e.ev;
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
  const places = [...new Set(events.filter((e) => e.group === "heat" || e.group === "rain").map((e) => e.place).filter(Boolean))]
    .sort((a, b) => (a === "Austin" ? -1 : b === "Austin" ? 1 : a.localeCompare(b)));
  return { asOf: new Date(now).toISOString(), total: counts.gemini + counts.kalshi + counts.polymarket, counts, events, places };
}

let cache: { t: number; v: ExplorerData; p?: Promise<ExplorerData> } | null = null;
const TTL = 60_000;

/** Cached explorer data (60s, stale-on-error). */
export async function getExplorerData(): Promise<ExplorerData> {
  if (cache && Date.now() - cache.t < TTL) return cache.v;
  if (cache?.p) return cache.p;
  const prev = cache;
  const p = listMarkets({ venues: ["gemini", "kalshi", "polymarket"] })
    .then((ms) => { const v = buildExplorer(ms); cache = { t: Date.now(), v }; return v; })
    .catch((e) => { if (prev) { cache = { t: prev.t, v: prev.v }; return prev.v; } cache = null; throw e; });
  cache = { t: prev?.t ?? 0, v: prev?.v ?? { asOf: "", total: 0, counts: { gemini: 0, kalshi: 0, polymarket: 0 }, events: [], places: [] }, p };
  return p;
}
