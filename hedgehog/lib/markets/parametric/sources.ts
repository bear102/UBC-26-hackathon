// Public data sources for parametric cover (no API keys). Each fetcher has a pure parser (unit-tested on saved
// real responses in tests/fixtures/parametric-*) and is cached on disk (.data/parametric-cache).
//   flood     USGS Water Services daily max gage height (pricing) + instantaneous values (settlement);
//             NWS flood stage + gauge name from the National Water Prediction Service (api.water.noaa.gov/nwps)
//   air       Open-Meteo Air Quality (US AQI, CAMS model; history since Aug 2022)  [EPA AirNow needs a key: not used]
//   hail      NOAA SPC severe-weather database (yearly CSV, pricing) + SPC daily storm reports (settlement)
//   wildfire  NIFC WFIGS incident locations (ArcGIS REST), all years since 2014, near-real-time
import { cachedJson, DAY_MS, fetchJson, fetchText, milesBetween } from "./common";

// ---------- flood ----------

export interface Gauge { usgsId: string; lid: string; name: string; lat: number; lon: number; floodStage: number; lroMinor?: string; lroInterval?: string }

/** Known good gauges (long USGS daily-max history + NWS flood stage), by city slug. */
export const PREFERRED_GAUGE: Record<string, string> = {
  "austin-tx": "08159000",       // Onion Creek at US 183, Austin (NWS ATIT2, flood stage 17 ft)
};
/** Offline fallback for preferred gauges (NWPS down). */
const GAUGE_FALLBACK: Record<string, Gauge> = {
  "08159000": { usgsId: "08159000", lid: "ATIT2", name: "Onion Creek at US 183", lat: 30.1778, lon: -97.6883, floodStage: 17 },
};

export function parseNwpsGauge(j: any): Gauge | null {
  const minor = Number(j?.flood?.categories?.minor?.stage);
  if (!j?.usgsId || !Number.isFinite(minor) || minor <= 0) return null;
  return {
    usgsId: String(j.usgsId), lid: String(j.lid), name: String(j.name ?? j.lid).trim(), lat: Number(j.latitude), lon: Number(j.longitude), floodStage: minor,
    lroMinor: j?.flood?.lro?.minorCS ? String(j.flood.lro.minorCS) : undefined, lroInterval: j?.flood?.lro?.interval ? String(j.flood.lro.interval) : undefined,
  };
}

export async function gaugeInfo(usgsId: string): Promise<Gauge | null> {
  try {
    return await cachedJson(`nwps-gauge-${usgsId}`, 7 * DAY_MS, async () => parseNwpsGauge(await fetchJson(`https://api.water.noaa.gov/nwps/v1/gauges/${usgsId}`, 12_000)));
  } catch {
    return GAUGE_FALLBACK[usgsId] ?? null;
  }
}

/** Nearest NWS gauge with a flood stage and >= 8 years of USGS daily-max stage, within ~30 miles. */
export async function gaugeNear(slug: string, lat: number, lon: number): Promise<Gauge | null> {
  if (PREFERRED_GAUGE[slug]) return gaugeInfo(PREFERRED_GAUGE[slug]);
  try {
    return await cachedJson(`gauge-near-${slug}`, 30 * DAY_MS, async () => {
      const d = 0.45;
      const j = await fetchJson<{ gauges?: { lid: string; latitude: number; longitude: number }[] }>(
        `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${lon - d}&bbox.ymin=${lat - d}&bbox.xmax=${lon + d}&bbox.ymax=${lat + d}&srid=EPSG_4326`, 15_000);
      const near = (j.gauges ?? []).map((g) => ({ lid: g.lid, mi: milesBetween(lat, lon, g.latitude, g.longitude) })).filter((g) => g.mi <= 30).sort((a, b) => a.mi - b.mi);
      for (const g of near.slice(0, 8)) {
        const info = parseNwpsGauge(await fetchJson(`https://api.water.noaa.gov/nwps/v1/gauges/${g.lid}`, 12_000).catch(() => null));
        if (!info) continue;
        const hist = await stageHistory(info.usgsId).catch(() => null);
        if (hist && Object.keys(hist).length >= 8 * 365) return info;
      }
      return null;
    });
  } catch {
    return null;
  }
}

/** USGS daily values JSON (parameter 00065 gage height) -> { "YYYY-MM-DD": max stage ft } (statistic 00001 = daily max). */
export function parseUsgsDv(j: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ts of j?.value?.timeSeries ?? []) {
    const name: string = ts?.name ?? "";
    if (!/:00065:00001$/.test(name)) continue;
    for (const v of ts?.values?.[0]?.value ?? []) {
      const x = Number(v.value);
      if (Number.isFinite(x) && x > -999) out[String(v.dateTime).slice(0, 10)] = x;
    }
  }
  return out;
}

/** USGS instantaneous values JSON (00065) -> { local date: max stage } (timestamps carry the site's UTC offset). */
export function parseUsgsIv(j: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ts of j?.value?.timeSeries ?? []) {
    if (!/:00065:/.test(ts?.name ?? "")) continue;
    for (const v of ts?.values?.[0]?.value ?? []) {
      const x = Number(v.value);
      const d = String(v.dateTime).slice(0, 10);
      if (Number.isFinite(x) && x > -999) out[d] = Math.max(out[d] ?? -Infinity, x);
    }
  }
  return out;
}

/** ~20 years of daily max stage (refreshed daily). */
export async function stageHistory(usgsId: string): Promise<Record<string, number>> {
  return cachedJson(`usgs-dv-${usgsId}`, DAY_MS, async () => {
    const from = `${new Date().getUTCFullYear() - 20}-01-01`;
    const hist = parseUsgsDv(await fetchJson(`https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${usgsId}&parameterCd=00065&statCd=00001&startDT=${from}`, 60_000));
    if (!Object.keys(hist).length) throw new Error(`no USGS daily max stage for ${usgsId}`);
    return hist;
  });
}

/** Observed daily max stage for a window (instantaneous values, 15-min, near-real-time). Cached 15 min. */
export async function stageObserved(usgsId: string, start: string, end: string): Promise<Record<string, number>> {
  return cachedJson(`usgs-iv-${usgsId}-${start}-${end}`, 15 * 60_000, async () =>
    parseUsgsIv(await fetchJson(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${usgsId}&parameterCd=00065&startDT=${start}&endDT=${end}`, 30_000)));
}

// ---------- air quality ----------

export const AQI_HISTORY_FROM = "2022-08-01";

/** Open-Meteo hourly us_aqi (timezone=auto, local hours) -> { local date: daily max AQI }. */
export function parseOpenMeteoAqi(j: any): Record<string, number> {
  const out: Record<string, number> = {};
  const t: string[] = j?.hourly?.time ?? [], v: (number | null)[] = j?.hourly?.us_aqi ?? [];
  for (let i = 0; i < t.length; i++) {
    const x = v[i];
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    const d = t[i].slice(0, 10);
    out[d] = Math.max(out[d] ?? -Infinity, x);
  }
  return out;
}

const aqiUrl = (lat: number, lon: number, start: string, end: string) =>
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=us_aqi&timezone=auto&start_date=${start}&end_date=${end}`;

export async function aqiHistory(lat: number, lon: number, through: string): Promise<Record<string, number>> {
  return cachedJson(`aqi-hist-${lat.toFixed(2)}_${lon.toFixed(2)}`, 7 * DAY_MS, async () => parseOpenMeteoAqi(await fetchJson(aqiUrl(lat, lon, AQI_HISTORY_FROM, through), 60_000)));
}
export async function aqiObserved(lat: number, lon: number, start: string, end: string): Promise<Record<string, number>> {
  return cachedJson(`aqi-obs-${lat.toFixed(2)}_${lon.toFixed(2)}-${start}-${end}`, 30 * 60_000, async () => parseOpenMeteoAqi(await fetchJson(aqiUrl(lat, lon, start, end), 30_000)));
}

// ---------- hail ----------

/** [date, lat, lon, inches] */
export type HailRow = [string, number, number, number];
export const HAIL_FIRST_YEAR = 2012;

/** SPC severe-weather database yearly hail CSV (om,yr,mo,dy,date,time,tz,st,stf,stn,mag,...,slat,slon,...) -> rows >= minIn. */
export function parseSpcYearCsv(text: string, minIn = 1): HailRow[] {
  const lines = text.split(/\r?\n/);
  const h = lines[0].split(",");
  const iDate = h.indexOf("date"), iMag = h.indexOf("mag"), iLat = h.indexOf("slat"), iLon = h.indexOf("slon");
  const out: HailRow[] = [];
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(",");
    if (c.length <= iLon) continue;
    const mag = Number(c[iMag]), lat = Number(c[iLat]), lon = Number(c[iLon]);
    if (!(mag >= minIn) || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) continue;
    out.push([c[iDate], Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3, mag]);
  }
  return out;
}

/** SPC daily storm reports (Time,Size,Location,County,State,Lat,Lon,Comments; Size in 1/100 inch) -> [lat, lon, inches][]. */
export function parseSpcDailyCsv(text: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const c = line.split(",");
    if (c.length < 7) continue;
    const size = Number(c[1]) / 100, lat = Number(c[5]), lon = Number(c[6]);
    if (Number.isFinite(size) && Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon, size]);
  }
  return out;
}

export async function hailYear(year: number): Promise<HailRow[]> {
  const done = year < new Date().getUTCFullYear() - 1; // last year's file is still revised for a few months
  return cachedJson(`spc-hail-${year}`, done ? 3650 * DAY_MS : 30 * DAY_MS, async () => parseSpcYearCsv(await fetchText(`https://www.spc.noaa.gov/wcm/data/${year}_hail.csv`, 60_000)));
}

/** Hail reports for one SPC convective day (12Z ymd -> 12Z ymd+1). Final once the day is over; cached accordingly. */
export async function hailDay(ymd: string): Promise<[number, number, number][]> {
  const yymmdd = ymd.slice(2).replace(/-/g, "");
  const over = Date.now() > Date.parse(`${ymd}T12:00:00Z`) + 2 * DAY_MS;
  return cachedJson(`spc-day-${ymd}`, over ? 30 * DAY_MS : 30 * 60_000, async () => parseSpcDailyCsv(await fetchText(`https://www.spc.noaa.gov/climo/reports/${yymmdd}_rpts_hail.csv`, 20_000)));
}

// ---------- wildfire ----------

export interface Fire { date: string; acres: number; name: string }
export const FIRE_FIRST_YEAR = 2015;
const NIFC = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations/FeatureServer/0/query";

/** ArcGIS query JSON -> fires (discovery date as US-Central day). */
export function parseNifc(j: any): Fire[] {
  const out: Fire[] = [];
  for (const f of j?.features ?? []) {
    const a = f?.attributes ?? {};
    const t = Number(a.FireDiscoveryDateTime);
    if (!Number.isFinite(t)) continue;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
    out.push({ date, acres: Number(a.IncidentSize) || 0, name: String(a.IncidentName ?? "").trim() });
  }
  return out;
}

export function nifcUrl(lat: number, lon: number, radiusMi: number, minAcres: number, offset = 0): string {
  const q = new URLSearchParams({
    where: `IncidentTypeCategory='WF' AND IncidentSize>=${minAcres}`, geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", distance: String(radiusMi), units: "esriSRUnit_StatuteMile",
    outFields: "FireDiscoveryDateTime,IncidentSize,IncidentName", returnGeometry: "false", orderByFields: "FireDiscoveryDateTime", resultOffset: String(offset), f: "json",
  });
  return `${NIFC}?${q}`;
}

/** Every wildfire >= minAcres within radius since 2014 (history + settlement in one query). Cached `ttlMs`. */
export async function firesNear(lat: number, lon: number, radiusMi: number, minAcres: number, ttlMs = 6 * 3600_000): Promise<Fire[]> {
  return cachedJson(`nifc-${lat.toFixed(2)}_${lon.toFixed(2)}-${radiusMi}-${minAcres}`, ttlMs, async () => {
    const out: Fire[] = [];
    for (let off = 0; off < 20_000; off += 2000) {
      const j = await fetchJson(nifcUrl(lat, lon, radiusMi, minAcres, off), 30_000);
      if (j?.error) throw new Error(`NIFC: ${JSON.stringify(j.error).slice(0, 120)}`);
      out.push(...parseNifc(j));
      if (!j?.exceededTransferLimit) break;
    }
    return out;
  });
}
