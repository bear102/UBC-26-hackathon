import { normCdf, clamp } from "../math";

const UA = { "User-Agent": "kelly-agent (UBC 2026 hackathon)", accept: "application/geo+json" };

// Settlement stations (NWS climate sites commonly used for daily-high markets).
export const CITIES: Record<string, { name: string; lat: number; lon: number; station: string; tz: string }> = {
  ATL: { name: "Atlanta", lat: 33.6407, lon: -84.4277, station: "KATL", tz: "America/New_York" },
  AUS: { name: "Austin", lat: 30.1945, lon: -97.6699, station: "KAUS", tz: "America/Chicago" },
  BOS: { name: "Boston", lat: 42.3656, lon: -71.0096, station: "KBOS", tz: "America/New_York" },
  CHI: { name: "Chicago", lat: 41.7868, lon: -87.7522, station: "KMDW", tz: "America/Chicago" },
  DCA: { name: "Washington DC", lat: 38.8512, lon: -77.0402, station: "KDCA", tz: "America/New_York" },
  DEN: { name: "Denver", lat: 39.8561, lon: -104.6737, station: "KDEN", tz: "America/Denver" },
  DFW: { name: "Dallas", lat: 32.8998, lon: -97.0403, station: "KDFW", tz: "America/Chicago" },
  HOU: { name: "Houston", lat: 29.6454, lon: -95.2789, station: "KHOU", tz: "America/Chicago" },
  NYC: { name: "New York", lat: 40.7789, lon: -73.9692, station: "KNYC", tz: "America/New_York" },
  SEA: { name: "Seattle", lat: 47.4502, lon: -122.3088, station: "KSEA", tz: "America/Los_Angeles" },
  LAX: { name: "Los Angeles", lat: 33.9416, lon: -118.4085, station: "KLAX", tz: "America/Los_Angeles" },
  MIA: { name: "Miami", lat: 25.7959, lon: -80.287, station: "KMIA", tz: "America/New_York" },
  PHL: { name: "Philadelphia", lat: 39.8744, lon: -75.2424, station: "KPHL", tz: "America/New_York" },
};

export type WeatherData = {
  city: string; date: string; forecastHighF: number | null; observedMaxF: number | null;
  hoursRemaining: number; sigmaF: number; asOf: number;
};

const cToF = (c: number) => c * 9 / 5 + 32;
const localDate = (d: Date, tz: string) => d.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD

async function j(url: string) {
  const r = await fetch(url, { headers: UA, cache: "no-store" });
  if (!r.ok) throw new Error(`NWS ${url} -> ${r.status}`);
  return r.json();
}

/** Seller-side: NWS hourly forecast + today's observations for the settlement station. */
export async function computeWeather(cityCode: string, date: string): Promise<WeatherData> {
  const c = CITIES[cityCode];
  if (!c) throw new Error(`unknown city ${cityCode}`);
  const pt = await j(`https://api.weather.gov/points/${c.lat},${c.lon}`);
  const hourly = await j(pt.properties.forecastHourly);
  const temps: number[] = [];
  for (const p of hourly.properties.periods as { startTime: string; temperature: number; temperatureUnit: string }[]) {
    if (localDate(new Date(p.startTime), c.tz) !== date) continue;
    temps.push(p.temperatureUnit === "F" ? p.temperature : cToF(p.temperature));
  }
  let observedMaxF: number | null = null;
  if (localDate(new Date(), c.tz) === date) {
    try {
      const obs = await j(`https://api.weather.gov/stations/${c.station}/observations?limit=100`);
      for (const f of obs.features as { properties: { timestamp: string; temperature: { value: number | null } } }[]) {
        if (localDate(new Date(f.properties.timestamp), c.tz) !== date || f.properties.temperature.value == null) continue;
        const tf = cToF(f.properties.temperature.value);
        observedMaxF = observedMaxF == null ? tf : Math.max(observedMaxF, tf);
      }
    } catch {}
  }
  const forecastHighF = temps.length ? Math.max(...temps) : null;
  const hoursRemaining = temps.length;
  // Forecast error shrinks as the day plays out; ~2.5F day-ahead, ~1F late in the day.
  const sigmaF = hoursRemaining >= 20 ? 2.5 : hoursRemaining >= 10 ? 1.8 : hoursRemaining > 3 ? 1.2 : 0.8;
  return { city: cityCode, date, forecastHighF, observedMaxF, hoursRemaining, sigmaF, asOf: Date.now() };
}

/** Parse a contract into the integer-°F range [lo, hi] it pays on. */
export function parseBin(label: string, strike?: { type: string; value?: string } | null): [number, number] | null {
  if (strike?.type === "above" && strike.value) return [Number(strike.value), Infinity];
  if (strike?.type === "below" && strike.value) return [-Infinity, Number(strike.value)];
  const m = label.match(/(-?\d+)\s*°?F?\s*to\s*(-?\d+)/i);
  if (m) return [Number(m[1]), Number(m[2])];
  const a = label.match(/(-?\d+)\s*°?F?\s*or above/i); if (a) return [Number(a[1]), Infinity];
  const b = label.match(/(-?\d+)\s*°?F?\s*or below/i); if (b) return [-Infinity, Number(b[1])];
  return null;
}

/** Agent-side: P(daily high lands in [lo,hi]) with high ~ max(observed, Normal(forecast, sigma)). */
export function probBin(w: WeatherData, [lo, hi]: [number, number]) {
  if (w.forecastHighF == null && w.observedMaxF == null) return null;
  const mu = Math.max(w.forecastHighF ?? -Infinity, w.observedMaxF ?? -Infinity);
  const floor = w.observedMaxF ?? -Infinity;
  const sd = w.forecastHighF == null ? 0.6 : w.sigmaF;
  // Continuous approx with rounding to integer degrees: bin covers [lo-0.5, hi+0.5).
  const F = (x: number) => (x <= floor ? 0 : normCdf((x - mu) / sd));
  const p = (hi === Infinity ? 1 : F(hi + 0.5)) - (lo === -Infinity ? 0 : F(lo - 0.5));
  return clamp(p, 0.01, 0.99);
}

export function dateFromTitle(title: string): string | null {
  const m = title.match(/on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!m) return null;
  const d = new Date(m[1] + " 12:00 UTC");
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}
