// Hedgehog parametric cover: shared ids, pricing math, windows, disk cache and HTTP helpers. Server-only.
//
// A parametric contract is a synthetic binary contract for a peril NO prediction market lists (flood, air quality,
// hail, wildfire). It is generated per business location + window, priced from public history for that place and
// season, and settled from the same public data (lib/markets/parametric/settle.ts). Venue id: "hedgehog".
//
// Ids (<= 64 bytes, the Cover program's marketRef limit):
//   hedgehog:flood:<usgsSite>:<YYYYMMDD>-<YYYYMMDD>           river at a USGS/NWS gauge at or above NWS flood stage
//   hedgehog:aqi:<city-st>:<YYYYMMDD>-<YYYYMMDD>              daily AQI above 150 on any day
//   hedgehog:hail:<city-st>:<miles>:<YYYYMMDD>-<YYYYMMDD>     hail >= 1 inch reported within <miles> (NOAA SPC)
//   hedgehog:wildfire:<city-st>:<miles>:<YYYYMMDD>-<YYYYMMDD> new wildfire >= 100 acres within <miles> (NIFC)
import fs from "node:fs";
import path from "node:path";
import type { Peril } from "../../types";

export type ParamKind = "flood" | "aqi" | "hail" | "wildfire";
export const KIND_PERIL: Record<ParamKind, Peril> = { flood: "flood", aqi: "smoke", hail: "hail", wildfire: "wildfire" };
export const PERIL_KIND: Partial<Record<Peril, ParamKind>> = { flood: "flood", smoke: "aqi", hail: "hail", wildfire: "wildfire" };
/** Perils no venue lists: only Hedgehog parametric cover hedges them. */
export const PARAMETRIC_PERILS: Peril[] = ["flood", "smoke", "hail", "wildfire"];
export const isParametricPeril = (p: Peril) => PARAMETRIC_PERILS.includes(p);
export const isParametricId = (id: string) => id.startsWith("hedgehog:");

// ---------- triggers ----------
export const AQI_THRESHOLD = 150;          // "Unhealthy" (EPA AQI category 4 starts at 151)
export const HAIL_MIN_INCHES = 1;          // NWS severe-hail criterion
export const HAIL_RADIUS_MI = 25;
export const FIRE_RADIUS_MI = 30;
export const FIRE_MIN_ACRES = 100;         // smaller fires start every week near most cities: not insurance

// ---------- pricing ----------
export const LOAD = 0.25;                  // 25% load on the expected payout
export const MIN_PRICE = 0.02;
export const MAX_PRICE = 0.85;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const centsUp = (x: number) => Math.ceil(Math.round(x * 100 * 1e6) / 1e6) / 100;

/** YES = clamp(p × 1.25 + 1¢, 2¢, 85¢); NO = 1 − p + the same load (NO is rarely insurance: usually > 85¢). */
export function priceFromProb(p: number): { yesAsk: number; noAsk: number } {
  const q = clamp(Number.isFinite(p) ? p : 1, 0, 1);
  const yesAsk = clamp(centsUp(q * (1 + LOAD) + 0.01), MIN_PRICE, MAX_PRICE);
  const noAsk = clamp(centsUp(1 - q + q * LOAD + 0.01), MIN_PRICE, 0.99);
  return { yesAsk, noAsk };
}

/**
 * Chance of at least one event in an L-day window from a seasonal history: q = episode starts per observed day
 * (+0.5 / +1 smoothing, so a clean history never prices at zero), P = 1 − (1 − q)^L.
 * Episodes (not event days) so a 5-day flood counts once.
 */
export function probFromEpisodes(episodes: number, observedDays: number, windowDays: number): { p: number; q: number } {
  const q = (Math.max(0, episodes) + 0.5) / (Math.max(0, observedDays) + 1);
  return { q, p: 1 - Math.pow(1 - Math.min(q, 0.999), Math.max(1, windowDays)) };
}

// ---------- dates / windows ----------
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetweenYmd = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
export const todayCentral = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const compact = (ymd: string) => ymd.replace(/-/g, "");
const expand = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
/** End of a window day in US Central (23:59:59 CST/CDT, approximated as UTC-6). */
export const endOfDayIso = (ymd: string) => new Date(Date.parse(`${ymd}T23:59:59-06:00`)).toISOString();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
export const windowText = (start: string, end: string) => (start === end ? shortDay(start) : `${shortDay(start)}–${shortDay(end)}`);

// ---------- ids ----------
export interface ParamSpec {
  kind: ParamKind;
  place: string;        // USGS site number (flood) or city slug "austin-tx"
  radiusMi?: number;    // hail / wildfire
  start: string;        // YYYY-MM-DD (US Central)
  end: string;
}

export function parametricId(s: ParamSpec): string {
  const w = `${compact(s.start)}-${compact(s.end)}`;
  const mid = s.kind === "hail" || s.kind === "wildfire" ? `${s.place}:${s.radiusMi ?? (s.kind === "hail" ? HAIL_RADIUS_MI : FIRE_RADIUS_MI)}` : s.place;
  return `hedgehog:${s.kind}:${mid}:${w}`;
}

export function parseParametricId(id: string): ParamSpec | null {
  const p = id.split(":");
  if (p[0] !== "hedgehog") return null;
  const kind = p[1] as ParamKind;
  if (!["flood", "aqi", "hail", "wildfire"].includes(kind)) return null;
  const w = p[p.length - 1].match(/^(\d{8})-(\d{8})$/);
  if (!w) return null;
  const start = expand(w[1]), end = expand(w[2]);
  if (end < start) return null;
  if (kind === "hail" || kind === "wildfire") {
    if (p.length !== 5) return null;
    const r = Number(p[3]);
    if (!Number.isFinite(r) || r <= 0 || r > 200) return null;
    return { kind, place: p[2], radiusMi: r, start, end };
  }
  if (p.length !== 4 || !p[2]) return null;
  if (kind === "flood" && !/^\d{8,15}$/.test(p[2])) return null;
  return { kind, place: p[2], start, end };
}

// ---------- geo ----------
export function milesBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------- disk cache (.data/parametric-cache) ----------
export const cacheDir = () => path.resolve(process.env.HH_DATA_DIR || path.join(process.cwd(), ".data"), "parametric-cache");
const G = globalThis as { __hhParamMem?: Map<string, { t: number; v: unknown }>; __hhParamInflight?: Map<string, Promise<unknown>> };
const mem = (G.__hhParamMem ??= new Map());
const inflight = (G.__hhParamInflight ??= new Map());
const fileOf = (key: string) => path.join(cacheDir(), `${key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180)}.json`);

/** Memory + disk cache. Fresh for `ttlMs`; on fetch failure a stale copy (any age) is served; else the error is thrown. */
export async function cachedJson<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const m = mem.get(key);
  if (m && Date.now() - m.t < ttlMs) return m.v as T;
  const f = fileOf(key);
  let disk: { t: number; v: T } | null = null;
  try { disk = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* none */ }
  if (disk && Date.now() - disk.t < ttlMs) { mem.set(key, disk); return disk.v; }
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    try {
      const v = await fetcher();
      const row = { t: Date.now(), v };
      mem.set(key, row);
      try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(row)); fs.renameSync(`${f}.${process.pid}.tmp`, f); } catch { /* cache is best-effort */ }
      return v;
    } catch (e) {
      if (disk) { mem.set(key, { t: Date.now() - ttlMs + 10 * 60_000, v: disk.v }); return disk.v; } // stale; retry in 10 min
      throw e;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const UA = { "user-agent": "hedgehog-parametric/0.1 (hackathon demo)" };
export async function fetchText(url: string, ms = 20_000): Promise<string> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
  return r.text();
}
export async function fetchJson<T = any>(url: string, ms = 20_000): Promise<T> {
  return JSON.parse(await fetchText(url, ms)) as T;
}

export const DAY_MS = 86_400_000;
