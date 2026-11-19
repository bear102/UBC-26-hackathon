// Conservative base rates: used ONLY when a live history source is unreachable (contract metadata says "base rate").
// Units: chance per day that a NEW episode starts (flood rise above flood stage, AQI > 150 day, >= 1" hail within
// 25 mi, >= 100-acre wildfire within 30 mi), by month (Jan..Dec). Rounded UP from the live histories this module
// computes (Austin, Denver, Los Angeles, Houston; 2012-2025) and NOAA/NIFC climatology, so a fallback quote is
// never cheaper than the data-driven one would have been.
import type { ParamKind } from "./common";

type Monthly = [number, number, number, number, number, number, number, number, number, number, number, number];

const REGION_OF_STATE: Record<string, string> = {
  tx: "plains", ok: "plains", ks: "plains", ne: "plains", co: "plains", sd: "plains", nd: "plains", mo: "plains", ia: "plains", mn: "plains",
  ca: "west", or: "west", wa: "west", nv: "west", az: "west", ut: "west", id: "west", mt: "west", nm: "west", wy: "west",
  la: "south", ms: "south", al: "south", ga: "south", fl: "south", sc: "south", nc: "south", tn: "south", ar: "south", ky: "south",
};

const RATES: Record<ParamKind, Record<string, Monthly>> = {
  //            Jan    Feb    Mar    Apr    May    Jun    Jul    Aug    Sep    Oct    Nov    Dec
  flood: {
    plains:  [0.002, 0.002, 0.004, 0.006, 0.010, 0.008, 0.004, 0.004, 0.006, 0.008, 0.004, 0.002],
    south:   [0.004, 0.004, 0.006, 0.006, 0.006, 0.006, 0.004, 0.004, 0.006, 0.004, 0.004, 0.004],
    west:    [0.004, 0.004, 0.003, 0.002, 0.002, 0.001, 0.001, 0.001, 0.001, 0.002, 0.003, 0.004],
    default: [0.003, 0.003, 0.005, 0.006, 0.006, 0.005, 0.004, 0.003, 0.004, 0.004, 0.003, 0.003],
  },
  aqi: {
    plains:  [0.001, 0.001, 0.002, 0.003, 0.003, 0.003, 0.003, 0.003, 0.002, 0.001, 0.001, 0.001],
    south:   [0.001, 0.001, 0.002, 0.002, 0.002, 0.003, 0.003, 0.003, 0.002, 0.001, 0.001, 0.001],
    west:    [0.002, 0.001, 0.001, 0.001, 0.002, 0.004, 0.010, 0.015, 0.015, 0.008, 0.003, 0.002],
    default: [0.001, 0.001, 0.002, 0.002, 0.003, 0.004, 0.004, 0.004, 0.003, 0.002, 0.001, 0.001],
  },
  hail: {
    plains:  [0.002, 0.004, 0.015, 0.030, 0.040, 0.030, 0.010, 0.008, 0.008, 0.006, 0.003, 0.002],
    south:   [0.003, 0.005, 0.012, 0.015, 0.012, 0.008, 0.004, 0.003, 0.003, 0.003, 0.003, 0.002],
    west:    [0.001, 0.001, 0.002, 0.003, 0.005, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001, 0.001],
    default: [0.002, 0.003, 0.008, 0.015, 0.020, 0.020, 0.010, 0.008, 0.005, 0.004, 0.002, 0.002],
  },
  wildfire: {
    plains:  [0.006, 0.008, 0.008, 0.004, 0.002, 0.002, 0.004, 0.006, 0.004, 0.002, 0.003, 0.005],
    south:   [0.004, 0.006, 0.006, 0.004, 0.002, 0.002, 0.002, 0.003, 0.003, 0.003, 0.004, 0.004],
    west:    [0.002, 0.002, 0.002, 0.003, 0.006, 0.012, 0.020, 0.020, 0.015, 0.010, 0.004, 0.003],
    default: [0.003, 0.004, 0.004, 0.003, 0.003, 0.004, 0.006, 0.006, 0.005, 0.004, 0.003, 0.003],
  },
};

export function baseRegion(state: string | undefined): string {
  return REGION_OF_STATE[(state ?? "").toLowerCase()] ?? "default";
}

/** Daily episode rate for a window (mean over the window's days). */
export function baseRate(kind: ParamKind, state: string | undefined, start: string, end: string): { q: number; region: string } {
  const region = baseRegion(state);
  const table = RATES[kind][region] ?? RATES[kind].default;
  let sum = 0, n = 0;
  for (let t = Date.parse(`${start}T12:00:00Z`); t <= Date.parse(`${end}T12:00:00Z`); t += 86_400_000) { sum += table[new Date(t).getUTCMonth()]; n++; }
  return { q: n ? sum / n : table[0], region };
}
