// Builds a priced parametric MarketContract (+ metadata the explanations cite) for one ParamSpec.
// Price = clamp(p × 1.25 + 1¢, 2¢, 85¢) with p from the place's own history for this season (history.ts);
// if the live source is unreachable, from the conservative base-rate table (baseRates.ts), marked "base rate".
import type { MarketContract } from "../../types";
import { setMeta } from "../normalize";
import { baseRate } from "./baseRates";
import {
  AQI_THRESHOLD, FIRE_MIN_ACRES, HAIL_MIN_INCHES, KIND_PERIL, endOfDayIso, milesBetween, priceFromProb, probFromEpisodes, todayCentral,
  windowText, daysBetweenYmd, type ParamSpec, parametricId,
} from "./common";
import { nearestTablePlace, resolvePlace, type Place } from "./geo";
import { seasonalStats, type SeasonStats } from "./history";
import { AQI_HISTORY_FROM, FIRE_FIRST_YEAR, HAIL_FIRST_YEAR, aqiHistory, firesNear, gaugeInfo, hailYear, stageHistory, type Gauge } from "./sources";

export interface ParamMeta {
  id: string;
  kind: ParamSpec["kind"];
  method: "live" | "base-rate";
  source: string;            // "USGS daily max gage height 2006-2026 + NWS flood stage"
  sourceUrl: string;
  station: string;           // gauge / city the trigger is measured at
  lat: number; lon: number;
  radiusMi?: number;
  threshold: string;         // "≥ 17 ft (NWS flood stage)"
  prob: number;              // modelled chance the window pays
  hitRate: string;           // owner-facing history sentence
  stats?: SeasonStats;
  settlement: string;        // how it settles
  backing: string;
}

const G = globalThis as { __hhParamMeta?: Map<string, ParamMeta> };
const metas = (G.__hhParamMeta ??= new Map());
export const parametricMeta = (id: string): ParamMeta | undefined => metas.get(id);

export const BACKING_LABEL = "Underwritten by the Hedgehog pool · no exchange backing";
const pct = (p: number) => (p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);

function histSentence(what: string, s: SeasonStats, unit = "days"): string {
  const yrs = s.years ? ` In these exact dates: ${s.yearsHit} of the last ${s.years} years.` : "";
  return `${what} on ${s.eventDays} of ${s.observedDays.toLocaleString("en-US")} ${unit} around ${s.band}, ${s.firstYear}–${s.lastYear} (${s.episodes} separate event${s.episodes === 1 ? "" : "s"}).${yrs}`;
}

async function placeFor(spec: ParamSpec): Promise<Place | null> {
  return resolvePlace(spec.place);
}

function fallback(spec: ParamSpec, state: string | undefined, why: string): { p: number; text: string } {
  const L = daysBetweenYmd(spec.start, spec.end) + 1;
  const { q, region } = baseRate(spec.kind, state, spec.start, spec.end);
  const p = 1 - Math.pow(1 - q, L);
  return { p, text: `Base rate (live history unavailable: ${why}): ~${(q * 100).toFixed(1)}% chance per day for the ${region} region in this season.` };
}

export async function buildParametric(spec: ParamSpec, now = new Date()): Promise<{ contract: MarketContract; meta: ParamMeta } | null> {
  const id = parametricId(spec);
  const today = todayCentral(now);
  const thisYear = Number(today.slice(0, 4));
  const win = windowText(spec.start, spec.end);
  let contract: Omit<MarketContract, "yesAsk" | "noAsk">;
  let meta: Omit<ParamMeta, "prob">;
  let p: number;

  if (spec.kind === "flood") {
    const g: Gauge | null = await gaugeInfo(spec.place);
    if (!g) return null;
    const town = nearestTablePlace(g.lat, g.lon);
    let hitRate: string, method: ParamMeta["method"] = "live", stats: SeasonStats | undefined;
    try {
      const h = await stageHistory(g.usgsId);
      const years = Object.keys(h).map((d) => Number(d.slice(0, 4)));
      stats = seasonalStats({ isEvent: (d) => (h[d] ?? -Infinity) >= g.floodStage, observed: (d) => d in h, start: spec.start, end: spec.end, firstYear: Math.min(...years), lastYear: thisYear, today });
      p = stats.p; hitRate = histSentence(`${g.name} reached flood stage (${g.floodStage} ft)`, stats);
    } catch (e) {
      const f = fallback(spec, town?.state, (e as Error).message); p = f.p; hitRate = f.text; method = "base-rate";
    }
    const lroP = Number(g.lroMinor);
    const lro = g.lroInterval && g.lroMinor ? ` NWS long-range outlook: ${Number.isFinite(lroP) ? `${Math.round(lroP * 100)}%` : g.lroMinor.replace(/\s+/g, "")} chance of minor flooding in ${g.lroInterval}.` : "";
    contract = {
      id, venue: "hedgehog", eventTitle: `${g.name} above flood stage, ${win}`, label: `≥ ${g.floodStage} ft (flood stage)`, symbol: id.slice(9),
      eventTicker: `HEDGEHOG-FLOOD-${g.usgsId}`, peril: "flood", location: town?.name ?? g.name, expiry: endOfDayIso(spec.end),
      yesBid: null, noBid: null, url: `https://water.noaa.gov/gauges/${g.lid}`, tradable: true, status: "open",
    };
    meta = {
      id, kind: "flood", method, source: method === "live" ? "USGS daily max gage height + NWS flood stage" : "base rate", sourceUrl: `https://waterdata.usgs.gov/monitoring-location/${g.usgsId}/`,
      station: `${g.name} (USGS ${g.usgsId}, NWS ${g.lid})`, lat: g.lat, lon: g.lon, threshold: `≥ ${g.floodStage} ft (NWS flood stage)`, hitRate: hitRate + lro, stats,
      settlement: `Pays if the USGS gauge reads at or above ${g.floodStage} ft at any time ${win} (15-minute data). Settles YES the moment it does, NO a day after the window ends.`,
      backing: BACKING_LABEL,
    };
  } else {
    const pl = await placeFor(spec);
    if (!pl) return null;
    let hitRate: string, method: ParamMeta["method"] = "live", stats: SeasonStats | undefined, source: string, sourceUrl: string, title: string, label: string, threshold: string, settlement: string;
    try {
      if (spec.kind === "aqi") {
        const h = await aqiHistory(pl.lat, pl.lon, today);
        stats = seasonalStats({ isEvent: (d) => (h[d] ?? 0) > AQI_THRESHOLD, observed: (d) => d in h, start: spec.start, end: spec.end, firstYear: Number(AQI_HISTORY_FROM.slice(0, 4)), lastYear: thisYear, today });
        hitRate = histSentence(`${pl.name} air quality went above AQI ${AQI_THRESHOLD}`, stats);
      } else if (spec.kind === "hail") {
        const r = spec.radiusMi!;
        const days = new Set<string>();
        const yrs = Array.from({ length: thisYear - HAIL_FIRST_YEAR }, (_, i) => HAIL_FIRST_YEAR + i);
        const got = await Promise.allSettled(yrs.map((y) => hailYear(y)));
        let lastYear = HAIL_FIRST_YEAR;
        got.forEach((g, i) => {
          if (g.status !== "fulfilled") return;
          lastYear = Math.max(lastYear, yrs[i]);
          for (const [d, la, lo, mag] of g.value) if (mag >= HAIL_MIN_INCHES && milesBetween(pl.lat, pl.lon, la, lo) <= r) days.add(d);
        });
        if (!got.some((g) => g.status === "fulfilled")) throw new Error("SPC archive unreachable");
        const okYears = new Set(yrs.filter((_, i) => got[i].status === "fulfilled"));
        stats = seasonalStats({ isEvent: (d) => days.has(d), observed: (d) => okYears.has(Number(d.slice(0, 4))), start: spec.start, end: spec.end, firstYear: HAIL_FIRST_YEAR, lastYear, today });
        hitRate = histSentence(`Hail of 1 inch or more was reported within ${r} miles of ${pl.name}`, stats);
      } else {
        const r = spec.radiusMi!;
        const fires = await firesNear(pl.lat, pl.lon, r, FIRE_MIN_ACRES, 7 * 86_400_000);
        const days = new Set(fires.map((f) => f.date));
        stats = seasonalStats({ isEvent: (d) => days.has(d), observed: (d) => d >= `${FIRE_FIRST_YEAR}-01-01`, start: spec.start, end: spec.end, firstYear: FIRE_FIRST_YEAR, lastYear: thisYear, today });
        hitRate = histSentence(`A wildfire of ${FIRE_MIN_ACRES}+ acres started within ${r} miles of ${pl.name}`, stats);
      }
      p = stats.p;
    } catch (e) {
      const f = fallback(spec, pl.state, (e as Error).message); p = f.p; hitRate = f.text; method = "base-rate";
    }
    if (spec.kind === "aqi") {
      title = `${pl.name} air quality above AQI ${AQI_THRESHOLD} on any day, ${win}`; label = `AQI > ${AQI_THRESHOLD} any day`; threshold = `daily max US AQI > ${AQI_THRESHOLD}`;
      source = method === "live" ? "Open-Meteo Air Quality (US AQI, CAMS)" : "base rate"; sourceUrl = "https://open-meteo.com/en/docs/air-quality-api";
      settlement = `Pays if ${pl.name}'s US AQI goes above ${AQI_THRESHOLD} in any hour ${win}. Settles YES as soon as it does, NO a day after the window ends.`;
    } else if (spec.kind === "hail") {
      title = `Hail ≥1 inch within ${spec.radiusMi} miles of ${pl.name}, ${win}`; label = `≥1" hail within ${spec.radiusMi} mi`; threshold = `hail ≥ ${HAIL_MIN_INCHES} in, ≤ ${spec.radiusMi} mi`;
      source = method === "live" ? "NOAA SPC storm reports" : "base rate"; sourceUrl = "https://www.spc.noaa.gov/climo/reports/";
      settlement = `Pays if NOAA's Storm Prediction Center logs a hail report of 1 inch or more within ${spec.radiusMi} miles of ${pl.name} ${win}.`;
    } else {
      title = `New wildfire (${FIRE_MIN_ACRES}+ acres) within ${spec.radiusMi} miles of ${pl.name}, ${win}`; label = `${FIRE_MIN_ACRES}+ acre fire within ${spec.radiusMi} mi`;
      threshold = `wildfire ≥ ${FIRE_MIN_ACRES} acres discovered ≤ ${spec.radiusMi} mi`;
      source = method === "live" ? "NIFC wildland fire incidents (WFIGS)" : "base rate"; sourceUrl = "https://data-nifc.opendata.arcgis.com/";
      settlement = `Pays if NIFC records a wildfire discovered ${win} within ${spec.radiusMi} miles of ${pl.name} that reaches ${FIRE_MIN_ACRES} acres.`;
    }
    contract = {
      id, venue: "hedgehog", eventTitle: title, label, symbol: id.slice(9), eventTicker: `HEDGEHOG-${spec.kind.toUpperCase()}-${pl.slug.toUpperCase()}`,
      peril: KIND_PERIL[spec.kind], location: pl.name, expiry: endOfDayIso(spec.end), yesBid: null, noBid: null, url: sourceUrl, tradable: true, status: "open",
    };
    meta = { id, kind: spec.kind, method, source, sourceUrl, station: `${pl.name}, ${pl.state}`, lat: pl.lat, lon: pl.lon, radiusMi: spec.radiusMi, threshold, hitRate, stats, settlement, backing: BACKING_LABEL };
  }

  const prices = priceFromProb(p);
  const full: MarketContract = { ...contract, ...prices };
  const m: ParamMeta = { ...meta, prob: Math.round(p * 10000) / 10000 };
  metas.set(id, m);
  setMeta(id, {
    eventDate: spec.start, eventEnd: spec.end, station: m.station, series: `HEDGEHOG-${spec.kind.toUpperCase()}`, category: "Parametric",
    rules: `${m.settlement} History: ${m.hitRate} Modelled chance ${pct(p)}${m.method === "base-rate" ? " (base rate)" : ""}. ${BACKING_LABEL}.`,
  });
  return { contract: full, meta: m };
}

export { probFromEpisodes };
