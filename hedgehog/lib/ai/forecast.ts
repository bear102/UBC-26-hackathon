// Weather forecast for the business's location: NWS (api.weather.gov: /points -> forecast + forecastHourly, and
// /alerts/active) with Open-Meteo as fallback. Cached ~30 min per location. Output: a compact per-day summary for the
// next 7 days, active alerts, and "signals" (rain >= 50%, heat / cold vs the business's thresholds, freeze, storms,
// watches and warnings) weighted by the owner's busy days.
// Used three ways, none of them an extra LLM call:
//  - forecastBlock(): folded into the risk-map + brainstorm prompts (lib/ai/advisor.ts)
//  - applySignals():  steers the deterministic fallback risks when the LLM is down
//  - attachForecast(): "forecast vs market" on weather quote lines (QuoteLine.forecast)
// Pure parsers/signals at the top (unit-tested on saved real responses in tests/fixtures/forecast-*); network at the
// bottom. No fs import at module level, so `import type` from client code is safe.
import type { BusinessProfile, MarketContract, Peril, Quote, QuoteLine, Risk } from "../types";
import { addDays, centralDate, contractMeta, daysBetween } from "../markets/normalize";
import { labelBound } from "./ideas";

export interface ForecastDay {
  date: string;              // YYYY-MM-DD (US Central)
  dow: string;               // "Sat"
  high: number | null;       // °F
  low: number | null;        // °F (the morning low of that date)
  pop: number | null;        // max chance of precipitation that day + evening, 0..100
  text: string;              // "Chance Showers And Thunderstorms"
}
export interface ForecastAlert { event: string; severity: string; onset: string | null; ends: string | null; headline: string }
export type SignalKind = "rain" | "storm" | "heat" | "cold" | "freeze" | "snow" | "flood" | "wind" | "fire";
export interface ForecastSignal {
  kind: SignalKind;
  peril: Peril;              // the market peril that hedges it
  date?: string;
  dow?: string;
  prob?: number;             // 0..100 (rain / storm)
  value?: number;            // °F (heat / cold / freeze)
  alert?: string;            // NWS event name ("Freeze Warning")
  busy: boolean;             // lands on one of the owner's busy days
  weight: number;            // sort key (busy days x2, alerts first)
  text: string;              // "Rain likely Sat (70%)"
}
export interface ForecastSummary {
  place: string;
  lat: number;
  lon: number;
  source: "NWS" | "Open-Meteo";
  fetchedAt: string;
  days: ForecastDay[];
  alerts: ForecastAlert[];
  signals: ForecastSignal[];
}
export interface Thresholds { heatF: number; coldHighF: number; freezeLowF: number; rainPct: number }

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dowOf = (ymd: string) => DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
const toF = (t: number | null | undefined, unit?: string) => (t == null || !Number.isFinite(Number(t)) ? null : /C$/i.test(unit ?? "") ? Math.round(Number(t) * 9 / 5 + 32) : Math.round(Number(t)));
const popOf = (p: any): number | null => { const v = p?.probabilityOfPrecipitation?.value ?? p?.probabilityOfPrecipitation; return v == null || !Number.isFinite(Number(v)) ? null : Number(v); };
const maxN = (...xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.max(...v) : null; };

// ---------- parsers (pure) ----------
type DayAcc = { high?: number | null; low?: number | null; popDay?: number | null; popNight?: number | null; textDay?: string; textNight?: string; hMax?: number; hMin?: number; hPop?: number };

/** NWS /gridpoints/.../forecast (12-hour periods) -> per-date high, low (the night before), day/evening PoP, text. */
export function parseNwsForecast(j: any, acc = new Map<string, DayAcc>()): Map<string, DayAcc> {
  for (const p of j?.properties?.periods ?? []) {
    const date = String(p.startTime ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const t = toF(p.temperature, p.temperatureUnit);
    const d = acc.get(date) ?? {}; acc.set(date, d);
    if (p.isDaytime) { d.high = t; d.popDay = popOf(p); d.textDay = String(p.shortForecast ?? ""); }
    else {
      d.popNight = popOf(p); d.textNight = String(p.shortForecast ?? "");
      const next = addDays(date, 1); const n = acc.get(next) ?? {}; acc.set(next, n); n.low = t; // overnight low = next morning's low
    }
  }
  return acc;
}

/** NWS forecastHourly -> per-date max PoP and hourly max/min temperature (fills gaps, e.g. "Tonight" has no daytime high). */
export function parseNwsHourly(j: any, acc = new Map<string, DayAcc>()): Map<string, DayAcc> {
  for (const p of j?.properties?.periods ?? []) {
    const date = String(p.startTime ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const d = acc.get(date) ?? {}; acc.set(date, d);
    const t = toF(p.temperature, p.temperatureUnit); const pop = popOf(p);
    if (t != null) { d.hMax = Math.max(d.hMax ?? -999, t); d.hMin = Math.min(d.hMin ?? 999, t); }
    if (pop != null) d.hPop = Math.max(d.hPop ?? 0, pop);
  }
  return acc;
}

/** Accumulated NWS data -> 7 days from `today`. */
export function nwsDays(acc: Map<string, DayAcc>, today: string, n = 7): ForecastDay[] {
  const out: ForecastDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(today, i); const d = acc.get(date);
    if (!d) continue;
    // today: hourly data starts now, so its max/min are not the day's high/low (the morning low is already past)
    out.push({ date, dow: dowOf(date), high: d.high ?? (i > 0 ? d.hMax ?? null : null), low: d.low ?? (i > 0 && d.hMin != null && d.hMin < 999 ? d.hMin : null),
      pop: maxN(d.popDay, d.popNight, d.hPop), text: d.textDay || d.textNight || "" });
  }
  return out;
}

const WMO: Record<number, string> = { 0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Cloudy", 45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 61: "Rain", 63: "Rain", 65: "Heavy Rain", 66: "Freezing Rain", 67: "Freezing Rain", 71: "Snow", 73: "Snow", 75: "Heavy Snow", 80: "Showers", 81: "Showers", 82: "Heavy Showers", 95: "Thunderstorms", 96: "Thunderstorms With Hail", 99: "Thunderstorms With Hail" };
/** Open-Meteo daily (precipitation_probability_max, temperature_2m_max/min, weather_code; °F) -> days. */
export function parseOpenMeteo(j: any, today: string, n = 7): ForecastDay[] {
  const d = j?.daily ?? {};
  const out: ForecastDay[] = [];
  (d.time ?? []).forEach((date: string, i: number) => {
    if (date < today || out.length >= n) return;
    const f = /C/.test(j?.daily_units?.temperature_2m_max ?? "°F") ? (x: number | null) => toF(x, "C") : (x: number | null) => toF(x, "F");
    out.push({ date, dow: dowOf(date), high: f(d.temperature_2m_max?.[i] ?? null), low: f(d.temperature_2m_min?.[i] ?? null),
      pop: d.precipitation_probability_max?.[i] ?? null, text: WMO[d.weather_code?.[i]] ?? "" });
  });
  return out;
}

/** NWS /alerts/active GeoJSON -> alerts (tests / statements dropped). */
export function parseNwsAlerts(j: any): ForecastAlert[] {
  return (j?.features ?? []).map((f: any) => f?.properties ?? {})
    .filter((p: any) => p.event && p.status !== "Test" && !/test message/i.test(p.event))
    .map((p: any) => ({ event: String(p.event), severity: String(p.severity ?? "Unknown"), onset: p.onset ?? p.effective ?? null, ends: p.ends ?? p.expires ?? null, headline: String(p.headline ?? p.event) }));
}

// ---------- signals (pure) ----------
/** The business's weather thresholds: stricter when the owner says heat / cold hurts. */
export function thresholdsFor(description = ""): Thresholds {
  return {
    heatF: /scorch|heat|\bhot\b|sun/i.test(description) ? 88 : 90,
    coldHighF: /cold|chill|freez|winter/i.test(description) ? 55 : 50,
    freezeLowF: 32,
    rainPct: 50,
  };
}

const ALERT_KIND: [RegExp, SignalKind, Peril][] = [
  [/freeze|frost/i, "freeze", "cold"], [/winter|ice storm|snow|blizzard|sleet/i, "snow", "snow"], [/wind chill|cold weather|extreme cold/i, "cold", "cold"],
  [/heat/i, "heat", "heat"], [/flood/i, "flood", "rain"], [/thunderstorm|tornado|hurricane|tropical/i, "storm", "rain"],
  [/wind/i, "wind", "storm"], [/red flag|fire weather/i, "fire", "wildfire"],
];
const SHORT_ALERT = /statement|small craft|marine|rip current|beach|surf|air quality|avalanche|dense fog|test/i;

/** Signals for the owner: rain >= 50%, storms, heat / cold vs thresholds, freeze nights, NWS watches/warnings. Busy days count double. */
export function computeSignals(days: ForecastDay[], alerts: ForecastAlert[], opts: { busyDays?: string[]; description?: string; thresholds?: Partial<Thresholds> } = {}): ForecastSignal[] {
  const th = { ...thresholdsFor(opts.description), ...(opts.thresholds ?? {}) };
  const busySet = new Set(opts.busyDays ?? []);
  const isBusy = (dow?: string) => !!dow && busySet.has(dow);
  const mult = (dow?: string) => (busySet.size === 0 ? 1.5 : isBusy(dow) ? 2 : 1);
  const out: ForecastSignal[] = [];
  for (const d of days) {
    const stormy = /thunder|severe|t-?storm/i.test(d.text);
    if (d.pop != null && d.pop >= th.rainPct) {
      const kind: SignalKind = stormy ? "storm" : "rain";
      out.push({ kind, peril: "rain", date: d.date, dow: d.dow, prob: d.pop, busy: isBusy(d.dow), weight: (d.pop / 100 + (stormy ? 0.2 : 0)) * mult(d.dow),
        text: `${stormy ? "Storms" : "Rain"} ${d.pop >= 70 ? "likely" : "possible"} ${d.dow} (${Math.round(d.pop)}%)` });
    }
    if (d.high != null && d.high >= th.heatF) out.push({ kind: "heat", peril: "heat", date: d.date, dow: d.dow, value: d.high, busy: isBusy(d.dow), weight: (0.6 + (d.high - th.heatF) / 20) * mult(d.dow), text: `Hot ${d.dow} (${d.high}°F)` });
    if (d.high != null && d.high <= th.coldHighF) out.push({ kind: "cold", peril: "cold", date: d.date, dow: d.dow, value: d.high, busy: isBusy(d.dow), weight: (0.6 + (th.coldHighF - d.high) / 20) * mult(d.dow), text: `Cold ${d.dow} (high ${d.high}°F)` });
    if (d.low != null && d.low <= th.freezeLowF) out.push({ kind: "freeze", peril: "cold", date: d.date, dow: d.dow, value: d.low, busy: isBusy(d.dow), weight: 0.8 * mult(d.dow), text: `Freeze ${d.dow} morning (${d.low}°F)` });
  }
  for (const a of alerts) {
    if (SHORT_ALERT.test(a.event)) continue;
    const k = ALERT_KIND.find(([re]) => re.test(a.event));
    if (!k) continue;
    const date = a.onset ? centralDate(a.onset) : undefined; const dow = date ? dowOf(date) : undefined;
    const until = a.ends ? ` until ${dowOf(centralDate(a.ends))}` : "";
    const sev = /extreme/i.test(a.severity) ? 1 : /severe/i.test(a.severity) ? 0.6 : 0.3;
    out.push({ kind: k[1], peril: k[2], date, dow, alert: a.event, busy: isBusy(dow), weight: (1.5 + sev) * mult(dow), text: `${a.event}${until}` });
  }
  // one signal per kind per day (alerts kept), strongest first
  const seen = new Set<string>();
  return out.sort((a, b) => b.weight - a.weight).filter((s) => { const k = s.alert ? `a:${s.alert}` : `${s.kind}:${s.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Compact prompt block (risk map + brainstorm). */
export function forecastBlock(s: ForecastSummary | null | undefined): string {
  if (!s || !s.days.length) return "";
  const days = s.days.map((d) => `${d.dow} ${d.date.slice(5)}: ${d.high ?? "?"}/${d.low ?? "?"}°F, rain ${d.pop ?? "?"}%${d.text ? `, ${d.text}` : ""}`).join("; ");
  const sig = s.signals.slice(0, 5).map((x) => `${x.text}${x.busy ? " [busy day]" : ""}`).join("; ");
  return [
    `\nWEATHER FORECAST for ${s.place} (${s.source}, next 7 days): ${days}.`,
    `Forecast signals (busy days weighted): ${sig || "none: no rain >= 50%, heat, cold or alerts on the coming days"}.`,
    `Active alerts: ${s.alerts.length ? s.alerts.slice(0, 3).map((a) => a.event).join(", ") : "none"}.`,
  ].join("\n");
}

/** Deterministic fallback risks steered by the forecast: a risky busy day moves its weather risk first, dated to that day. */
export function applySignals(risks: Risk[], s: ForecastSummary | null | undefined, profile: BusinessProfile): Risk[] {
  if (!s?.signals.length) return risks;
  const city = profile.city.split(",")[0].trim() || "Austin";
  const weathery = risks.some((r) => ["rain", "heat", "cold", "snow", "storm"].includes(r.peril))
    || /outdoor|outside|patio|truck|cart|crew|roof|rain|weather|cold|heat|event|tour|landscap|construction|pop-up/i.test(profile.description);
  if (!weathery) return risks;
  let out = [...risks];
  const d = profile.avgDailyRevenueUsd;
  const r10 = (x: number) => Math.max(10, Math.round(x / 10) * 10);
  const used = new Set<Peril>();
  for (const sig of s.signals.filter((x) => x.date && (x.busy || !profile.busyDays.length)).slice(0, 2)) {
    const peril: Peril = sig.peril === "snow" ? "cold" : sig.peril;
    if (!["rain", "heat", "cold"].includes(peril) || used.has(peril)) continue;
    used.add(peril);
    const day = `${sig.dow} ${sig.date!.slice(5).replace("-", "/")}`;
    const i = out.findIndex((r) => r.peril === peril && (r.horizon ?? "event") === "event");
    const trigger = peril === "rain" ? `Measurable rain in ${city} on ${day}` : peril === "heat" ? `${city} high >= ${Math.min(sig.value ?? 90, 95)}°F on ${day}` : `${city} high below ${Math.max((sig.value ?? 50) + 3, 40)}°F on ${day}`;
    const note = `Forecast: ${sig.text}.`;
    if (i >= 0) {
      const r = out[i];
      out.splice(i, 1);
      out = [{ ...r, title: `${peril === "rain" ? "Rain" : peril === "heat" ? "Heat" : "Cold"} on ${sig.dow}${sig.busy ? ", a busy day" : ""}`, trigger, window: sig.date, confidence: Math.min(0.9, r.confidence + 0.15), lossReasoning: `${r.lossReasoning} ${note}` }, ...out];
    } else {
      out = [{ id: "rf", peril, title: `${peril === "rain" ? "Rain" : peril === "heat" ? "Heat" : "Cold"} on ${sig.dow}${sig.busy ? ", a busy day" : ""}`, trigger, location: city, window: sig.date,
        lossUsd: r10(d * (peril === "rain" ? 0.35 : 0.15)), lossReasoning: `Assumes ~${peril === "rain" ? 35 : 15}% of a $${Math.round(d).toLocaleString("en-US")} day is lost. ${note}`, confidence: 0.5 }, ...out];
    }
  }
  return out.slice(0, 5).map((r, i) => ({ ...r, id: `r${i + 1}` }));
}

// ---------- forecast vs market (pure) ----------
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Dates a daily / weekend weather market observes (meta first, else its title). Null for months / unknown. */
export function marketDates(c: MarketContract): string[] | null {
  const m = contractMeta(c.id);
  if (m?.eventDate) {
    const end = m.eventEnd ?? m.eventDate;
    const n = daysBetween(m.eventDate, end);
    if (n < 0 || n > 3) return null;
    return Array.from({ length: n + 1 }, (_, i) => addDays(m.eventDate!, i));
  }
  const y = Number((c.eventTitle.match(/\b20\d\d\b/) ?? [])[0]) || new Date(c.expiry).getUTCFullYear();
  const ds = [...c.eventTitle.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi)]
    .map((x) => `${y}-${String(MON.indexOf(x[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-${String(Number(x[2])).padStart(2, "0")}`);
  if (!ds.length || !Number.isFinite(y)) return null;
  const a = ds[0], b = ds[ds.length - 1];
  const n = daysBetween(a, b);
  if (n < 0 || n > 3) return null;
  return Array.from({ length: n + 1 }, (_, i) => addDays(a, i));
}

const phi = (x: number) => { // standard normal CDF (Abramowitz-Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + e) / 2 : (1 - e) / 2;
};

/**
 * Forecast probability that a weather contract's YES resolves true. Null when the forecast can't speak to it.
 * Rain: NWS PoP (a calibrated probability). Daily highs: the point forecast with a lead-time spread, from tomorrow on
 * (today's market already sees the observed temperature); `pointYes` = the point forecast itself lands in the label.
 * Daily lows are skipped: the forecast grid point and the market's station can differ by several degrees overnight.
 */
export function forecastProbYes(c: MarketContract, s: ForecastSummary, today = s.days[0]?.date): { prob: number; date: string; dates: string[]; pointYes?: boolean } | null {
  const peril = c.peril;
  if (!["rain", "heat", "cold"].includes(peril)) return null;
  const dates = marketDates(c);
  if (!dates) return null;
  const days = dates.map((d) => s.days.find((x) => x.date === d));
  if (days.some((d) => !d)) return null;
  if (peril === "rain") {
    const nums = (c.label.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (nums.some((n) => n > 0.01) || /month|total/i.test(c.eventTitle)) return null; // monthly totals: not a daily rain call
    if (days.some((d) => d!.pop == null)) return null;
    const pNone = days.reduce((p, d) => p * (1 - d!.pop! / 100), 1);
    return { prob: Math.round((1 - pNone) * 100) / 100, date: dates[0], dates };
  }
  if (dates.length !== 1) return null;
  const d = days[0]!;
  if (/lowest|low temp|\blow\b/i.test(c.eventTitle)) return null;
  const f = d.high;
  if (f == null) return null;
  const b = labelBound(c.label);
  const lead = today ? daysBetween(today, d.date) : 1;
  if (lead < 1) return null;
  const sd = 2.5 + 0.7 * lead; // NWS max temperature error grows ~0.5-1°F per day of lead time
  const nums = (c.label.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let p: number | null = null;
  if (b.dir === "up" && b.v != null) p = 1 - phi((b.v - 0.5 - f) / sd);
  else if (b.dir === "down" && b.v != null) p = phi((b.v + 0.5 - f) / sd);
  else if (b.dir === "range" && nums.length >= 2) p = phi((nums[1] + 0.5 - f) / sd) - phi((nums[0] - 0.5 - f) / sd);
  if (p == null) return null;
  const pointYes = b.dir === "up" ? f >= b.v! : b.dir === "down" ? f <= b.v! : f >= nums[0] && f <= nums[1];
  return { prob: Math.round(Math.max(0, Math.min(1, p)) * 100) / 100, date: d.date, dates, pointYes };
}

export const FORECAST_GAP = 0.15;
/** Forecast vs market for one quote line (the probability THIS LINE pays). Note only when they differ by >= 15 pts. */
export function lineForecast(line: Pick<QuoteLine, "contract" | "side" | "impliedProb">, s: ForecastSummary): NonNullable<QuoteLine["forecast"]> | null {
  const f = forecastProbYes(line.contract, s);
  if (!f) return null;
  const prob = line.side === "yes" ? f.prob : Math.round((1 - f.prob) * 100) / 100;
  const market = line.impliedProb;
  const gap = prob - market;
  const pts = (x: number) => `${Math.round(x * 100)}%`;
  // temperatures: a note only when the point forecast and the market disagree on the outcome, not just on the spread
  const pointLine = f.pointYes === undefined ? undefined : line.side === "yes" ? f.pointYes : !f.pointYes;
  const disagree = pointLine === undefined || pointLine !== market >= 0.5;
  const note = disagree && Math.abs(gap) >= FORECAST_GAP - 1e-9 ? `Forecast ${pts(prob)} vs market ${pts(market)}: ${gap > 0 ? "cheap cover" : "pricey for now"}` : undefined;
  return { prob, marketProb: market, source: s.source, date: f.date, ...(note ? { note } : {}) };
}

/** Adds QuoteLine.forecast to every weather line (plan + every choice) whose date has a forecast. Mutates the quote. */
export function attachForecast(q: Quote, s: ForecastSummary | null | undefined): Quote {
  if (!s?.days.length) return q;
  const put = (l: QuoteLine) => { const f = lineForecast(l, s); if (f) l.forecast = f; };
  q.lines.forEach(put);
  for (const o of q.options ?? []) o.choices.forEach(put);
  return q;
}

// ---------- network ----------
const UA = { "user-agent": "Hedgehog-hackathon-demo", accept: "application/geo+json" };
const TTL = 30 * 60_000;
type Raw = { place: string; lat: number; lon: number; source: ForecastSummary["source"]; fetchedAt: string; days: ForecastDay[]; alerts: ForecastAlert[] };
const G = globalThis as { __hhForecast?: Map<string, { at: number; p: Promise<Raw | null> }> };
const cache = (G.__hhForecast ??= new Map());

/** Austin-area ZIPs (no network); other ZIPs go through the Open-Meteo geocoder. */
const ZIPS: Record<string, [number, number]> = {
  "78701": [30.2711, -97.7437], "78702": [30.2633, -97.7166], "78703": [30.2944, -97.7660], "78704": [30.2430, -97.7650], "78705": [30.2958, -97.7395],
  "78712": [30.2849, -97.7341], "78721": [30.2721, -97.6868], "78722": [30.2894, -97.7154], "78723": [30.3049, -97.6851], "78741": [30.2310, -97.7220],
  "78744": [30.1830, -97.7400], "78745": [30.2070, -97.7963], "78746": [30.2950, -97.8080], "78748": [30.1730, -97.8230], "78749": [30.2170, -97.8590],
  "78751": [30.3092, -97.7243], "78752": [30.3310, -97.7000], "78756": [30.3220, -97.7390], "78757": [30.3500, -97.7340], "78758": [30.3880, -97.7070],
  "78759": [30.4040, -97.7530], "78731": [30.3470, -97.7650], "78727": [30.4250, -97.7190], "78613": [30.5050, -97.8200], "78660": [30.4390, -97.6200],
};

async function getJson(url: string, ms = 8000, f: typeof fetch = fetch): Promise<any> {
  const r = await f(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
  return r.json();
}

export async function locate(loc: { zip?: string; city?: string }, f: typeof fetch = fetch): Promise<{ place: string; lat: number; lon: number } | null> {
  const zip = (loc.zip ?? "").trim().slice(0, 5);
  const city = (loc.city ?? "").trim() || "Austin, TX";
  if (ZIPS[zip]) return { place: `${city.split(",")[0]} ${zip}`, lat: ZIPS[zip][0], lon: ZIPS[zip][1] };
  if (/^\d{5}$/.test(zip)) {
    try {
      const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=1&language=en&format=json&countryCode=US`, 6000, f);
      const r = j?.results?.[0];
      if (r) return { place: `${r.name} ${zip}`, lat: r.latitude, lon: r.longitude };
    } catch { /* city below */ }
  }
  const { placeFromTable, resolvePlace } = await import("../markets/parametric/geo");
  const p = placeFromTable(city) ?? await resolvePlace(city).catch(() => null);
  return p ? { place: p.name, lat: p.lat, lon: p.lon } : null;
}

async function fetchRaw(pt: { place: string; lat: number; lon: number }, now: Date, f: typeof fetch): Promise<Raw | null> {
  const lat = pt.lat.toFixed(4), lon = pt.lon.toFixed(4);
  const today = centralDate(now);
  const alertsP = getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, 8000, f).then(parseNwsAlerts).catch(() => [] as ForecastAlert[]);
  try {
    const pts = await getJson(`https://api.weather.gov/points/${lat},${lon}`, 8000, f);
    const { forecast, forecastHourly } = pts?.properties ?? {};
    if (!forecast) throw new Error("no NWS grid");
    const [daily, hourly] = await Promise.all([getJson(forecast, 10_000, f), forecastHourly ? getJson(forecastHourly, 10_000, f).catch(() => null) : null]);
    const acc = parseNwsForecast(daily);
    if (hourly) parseNwsHourly(hourly, acc);
    const days = nwsDays(acc, today);
    if (days.length < 3) throw new Error("short NWS forecast");
    return { ...pt, source: "NWS", fetchedAt: now.toISOString(), days, alerts: await alertsP };
  } catch (e) {
    console.warn(`[forecast] NWS failed (${(e as Error).message.slice(0, 80)}), trying Open-Meteo`);
    try {
      const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=America%2FChicago&forecast_days=8`, 8000, f);
      const days = parseOpenMeteo(j, today);
      return days.length ? { ...pt, source: "Open-Meteo", fetchedAt: now.toISOString(), days, alerts: await alertsP } : null;
    } catch { return null; }
  }
}

/** Forecast + signals for a business location (cached ~30 min per location; signals depend on busy days + description). Never throws. */
export async function getForecast(loc: { zip?: string; city?: string }, opts: { busyDays?: string[]; description?: string; now?: Date; fetch?: typeof fetch } = {}): Promise<ForecastSummary | null> {
  const now = opts.now ?? new Date();
  const key = `${(loc.zip ?? "").trim()}|${(loc.city ?? "").trim().toLowerCase()}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL) {
    const p = (async () => { const pt = await locate(loc, opts.fetch).catch(() => null); return pt ? fetchRaw(pt, now, opts.fetch ?? fetch) : null; })();
    hit = { at: Date.now(), p };
    cache.set(key, hit);
    p.then((r) => { if (!r) hit!.at = Date.now() - TTL + 5 * 60_000; }).catch(() => cache.delete(key)); // retry a failure in 5 min
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
  }
  const raw = await hit.p.catch(() => null);
  if (!raw) return null;
  return { ...raw, signals: computeSignals(raw.days, raw.alerts, { busyDays: opts.busyDays, description: opts.description }) };
}

/** Forecast for a profile (advise() dependency). */
export const forecastFor = (p: BusinessProfile, now?: Date) => getForecast({ zip: p.zip, city: p.city }, { busyDays: p.busyDays, description: p.description, now });
