// City -> coordinates for parametric contracts. A static table for common cities (no network), else the free
// Open-Meteo geocoder (no key), cached on disk. Slugs ("austin-tx") are what contract ids carry.
import { cachedJson, fetchJson } from "./common";

export interface Place { slug: string; name: string; state: string; lat: number; lon: number }

const STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh",
  "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or",
  pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy", "district of columbia": "dc",
};

/** [name, state, lat, lon] */
const CITIES: [string, string, number, number][] = [
  ["Austin", "TX", 30.2672, -97.7431], ["Houston", "TX", 29.7604, -95.3698], ["Dallas", "TX", 32.7767, -96.797], ["San Antonio", "TX", 29.4241, -98.4936],
  ["Fort Worth", "TX", 32.7555, -97.3308], ["El Paso", "TX", 31.7619, -106.485], ["Round Rock", "TX", 30.5083, -97.6789], ["San Marcos", "TX", 29.8833, -97.9414],
  ["Denver", "CO", 39.7392, -104.9903], ["Colorado Springs", "CO", 38.8339, -104.8214], ["Oklahoma City", "OK", 35.4676, -97.5164], ["Tulsa", "OK", 36.154, -95.9928],
  ["Kansas City", "MO", 39.0997, -94.5786], ["Omaha", "NE", 41.2565, -95.9345], ["Wichita", "KS", 37.6872, -97.3301], ["Minneapolis", "MN", 44.9778, -93.265],
  ["Chicago", "IL", 41.8781, -87.6298], ["St. Louis", "MO", 38.627, -90.1994], ["Nashville", "TN", 36.1627, -86.7816], ["Atlanta", "GA", 33.749, -84.388],
  ["New Orleans", "LA", 29.9511, -90.0715], ["Miami", "FL", 25.7617, -80.1918], ["Tampa", "FL", 27.9506, -82.4572], ["Phoenix", "AZ", 33.4484, -112.074],
  ["Las Vegas", "NV", 36.1699, -115.1398], ["Salt Lake City", "UT", 40.7608, -111.891], ["Los Angeles", "CA", 34.0522, -118.2437], ["San Diego", "CA", 32.7157, -117.1611],
  ["San Francisco", "CA", 37.7749, -122.4194], ["Sacramento", "CA", 38.5816, -121.4944], ["Napa", "CA", 38.2975, -122.2869], ["Fresno", "CA", 36.7378, -119.7871],
  ["Portland", "OR", 45.5152, -122.6784], ["Seattle", "WA", 47.6062, -122.3321], ["Boise", "ID", 43.615, -116.2023], ["Bozeman", "MT", 45.677, -111.0429],
  ["New York", "NY", 40.7128, -74.006], ["Philadelphia", "PA", 39.9526, -75.1652], ["Washington", "DC", 38.9072, -77.0369], ["Boston", "MA", 42.3601, -71.0589],
  ["Detroit", "MI", 42.3314, -83.0458], ["Charlotte", "NC", 35.2271, -80.8431], ["Asheville", "NC", 35.5951, -82.5515], ["Albuquerque", "NM", 35.0844, -106.6504],
];

const slugify = (s: string) => s.toLowerCase().replace(/\./g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const placeSlug = (name: string, state: string) => `${slugify(name)}-${state.toLowerCase()}`.slice(0, 20);
const TABLE: Place[] = CITIES.map(([name, state, lat, lon]) => ({ slug: placeSlug(name, state), name, state, lat, lon }));

/** "Austin, TX" | "austin" | "Austin, Texas" -> { name, state? } */
function parseCity(text: string): { name: string; state?: string } {
  const [a, b] = text.split(",").map((x) => x.trim());
  const st = (b ?? "").toLowerCase().replace(/\./g, "");
  const state = st.length === 2 ? st : STATES[st];
  const name = /^(nyc|new york city)$/i.test(a) ? "New York" : /^(la)$/i.test(a) ? "Los Angeles" : /^(dc)$/i.test(a) ? "Washington" : a;
  return { name, state };
}

export function placeFromTable(text: string): Place | null {
  const { name, state } = parseCity(text);
  const n = name.toLowerCase();
  return TABLE.find((p) => p.name.toLowerCase() === n && (!state || p.state.toLowerCase() === state)) ?? null;
}

/** Resolve a business city (or a contract's city slug) to coordinates. Null when unknown / geocoder down. */
export async function resolvePlace(text: string): Promise<Place | null> {
  if (!text || /^(us|usa|national)$/i.test(text.trim())) return null;
  const bySlug = TABLE.find((p) => p.slug === text);
  if (bySlug) return bySlug;
  const hit = placeFromTable(text);
  if (hit) return hit;
  // slug "round-rock-tx" -> "round rock", "tx"
  const m = text.match(/^([a-z0-9-]+)-([a-z]{2})$/);
  const { name, state } = m ? { name: m[1].replace(/-/g, " "), state: m[2] } : parseCity(text);
  try {
    const res = await cachedJson(`geo-${slugify(name)}-${state ?? ""}`, 365 * 86_400_000, () =>
      fetchJson<{ results?: { name: string; latitude: number; longitude: number; country_code: string; admin1?: string }[] }>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json&countryCode=US`, 10_000));
    const rows = (res.results ?? []).filter((r) => r.country_code === "US");
    const r = rows.find((x) => !state || STATES[(x.admin1 ?? "").toLowerCase()] === state) ?? (state ? undefined : rows[0]);
    if (!r) return null;
    const st = STATES[(r.admin1 ?? "").toLowerCase()] ?? state ?? "us";
    return { slug: placeSlug(r.name, st), name: r.name, state: st.toUpperCase(), lat: r.latitude, lon: r.longitude };
  } catch {
    return null;
  }
}

/** Nearest table city within `maxMi` (labels a gauge with the town it serves). */
export function nearestTablePlace(lat: number, lon: number, maxMi = 40): Place | null {
  let best: Place | null = null, bd = Infinity;
  for (const p of TABLE) {
    const d = Math.hypot((p.lat - lat) * 69, (p.lon - lon) * 69 * Math.cos((lat * Math.PI) / 180));
    if (d < bd) { bd = d; best = p; }
  }
  return bd <= maxMi ? best : null;
}
