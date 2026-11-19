// Settlement oracles for parametric contracts: read the same public data the price came from.
//   YES as soon as the trigger is observed inside the window; NO once the window has ended + SETTLE_LAG_H (data lag).
// Dev override (demo/testing only): force a resolution without waiting for the weather.
//   file .data/parametric-overrides.json   { "<contract id>": "yes" | "no", "hedgehog:hail:austin-tx:*": "yes" }
//   env  PARAMETRIC_FORCE="<id or prefix*>=yes;<id>=no"
//   CLI  npx tsx scripts/parametric-force.ts <id|prefix*> yes|no|clear
// Ignored when NODE_ENV=production unless PARAMETRIC_OVERRIDES=1.
import fs from "node:fs";
import path from "node:path";
import { AQI_THRESHOLD, DAY_MS, FIRE_MIN_ACRES, HAIL_MIN_INCHES, addDaysYmd, endOfDayIso, milesBetween, shortDay, todayCentral, type ParamSpec } from "./common";
import { aqiObserved, firesNear, gaugeInfo, hailDay, stageObserved } from "./sources";
import { resolvePlace } from "./geo";

export const SETTLE_LAG_H = 30;

export interface Observation { hit: boolean; final: boolean; detail: string; on?: string }

// ---------- overrides ----------

export const overridesFile = () => path.resolve(process.env.HH_DATA_DIR || path.join(process.cwd(), ".data"), "parametric-overrides.json");
export const overridesEnabled = () => process.env.NODE_ENV !== "production" || process.env.PARAMETRIC_OVERRIDES === "1";

export function readOverrides(): Record<string, "yes" | "no"> {
  const out: Record<string, "yes" | "no"> = {};
  try {
    const j = JSON.parse(fs.readFileSync(overridesFile(), "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(j)) if (v === "yes" || v === "no") out[k] = v;
  } catch { /* none */ }
  for (const part of (process.env.PARAMETRIC_FORCE ?? "").split(/[;,]/)) {
    const m = part.trim().match(/^(.+)=(yes|no)$/);
    if (m) out[m[1].trim()] = m[2] as "yes" | "no";
  }
  return out;
}

export function overrideFor(id: string, o = readOverrides()): "yes" | "no" | null {
  if (!overridesEnabled()) return null;
  if (o[id]) return o[id];
  for (const [k, v] of Object.entries(o)) if (k.endsWith("*") && id.startsWith(k.slice(0, -1))) return v;
  return null;
}

export function writeOverride(key: string, v: "yes" | "no" | null) {
  const f = overridesFile();
  let j: Record<string, string> = {};
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ }
  if (v) j[key] = v; else delete j[key];
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
}

// ---------- pure checks (unit-tested on saved responses) ----------

export function floodHit(dailyMax: Record<string, number>, floodStage: number, start: string, end: string): { hit: boolean; on?: string; peak?: number } {
  let peak = -Infinity, on: string | undefined;
  for (const [d, v] of Object.entries(dailyMax).sort()) {
    if (d < start || d > end) continue;
    if (v > peak) peak = v;
    if (v >= floodStage && !on) on = d;
  }
  return { hit: !!on, on, peak: Number.isFinite(peak) ? peak : undefined };
}

export function aqiHit(daily: Record<string, number>, start: string, end: string, thr = AQI_THRESHOLD): { hit: boolean; on?: string; peak?: number } {
  let peak = -Infinity, on: string | undefined;
  for (const [d, v] of Object.entries(daily).sort()) {
    if (d < start || d > end) continue;
    if (v > peak) peak = v;
    if (v > thr && !on) on = d;
  }
  return { hit: !!on, on, peak: Number.isFinite(peak) ? peak : undefined };
}

export function hailHit(reports: [number, number, number][], lat: number, lon: number, radiusMi: number, minIn = HAIL_MIN_INCHES): { hit: boolean; size?: number; miles?: number } {
  let best: { size: number; miles: number } | null = null;
  for (const [la, lo, s] of reports) {
    if (s < minIn) continue;
    const mi = milesBetween(lat, lon, la, lo);
    if (mi <= radiusMi && (!best || s > best.size)) best = { size: s, miles: Math.round(mi) };
  }
  return best ? { hit: true, ...best } : { hit: false };
}

// ---------- observe ----------

const G = globalThis as { __hhParamObs?: Map<string, { t: number; v: Observation }> };
const memo = (G.__hhParamObs ??= new Map());

/** Read the public data for the elapsed part of the window. Throws when the source is unreachable (caller keeps it open). */
export async function observe(spec: ParamSpec, now = new Date()): Promise<Observation> {
  const key = `${spec.kind}:${spec.place}:${spec.radiusMi ?? ""}:${spec.start}:${spec.end}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < 10 * 60_000) return hit.v;
  const today = todayCentral(now);
  const final = now.getTime() > Date.parse(endOfDayIso(spec.end)) + SETTLE_LAG_H * 3600_000;
  const upTo = spec.end < today ? spec.end : today;
  let v: Observation;
  if (spec.start > today) v = { hit: false, final: false, detail: "window not started" };
  else if (spec.kind === "flood") {
    const g = await gaugeInfo(spec.place);
    if (!g) throw new Error(`no gauge ${spec.place}`);
    const r = floodHit(await stageObserved(g.usgsId, spec.start, upTo), g.floodStage, spec.start, upTo);
    v = { hit: r.hit, final, on: r.on, detail: r.hit ? `${g.name} reached ${g.floodStage} ft on ${shortDay(r.on!)}` : `peak ${r.peak ?? "—"} ft (flood stage ${g.floodStage} ft)` };
  } else {
    const pl = await resolvePlace(spec.place);
    if (!pl) throw new Error(`unknown place ${spec.place}`);
    if (spec.kind === "aqi") {
      const r = aqiHit(await aqiObserved(pl.lat, pl.lon, spec.start, upTo), spec.start, upTo);
      v = { hit: r.hit, final, on: r.on, detail: r.hit ? `AQI above ${AQI_THRESHOLD} on ${shortDay(r.on!)}` : `peak AQI ${r.peak ?? "—"}` };
    } else if (spec.kind === "hail") {
      v = { hit: false, final, detail: `no hail ≥${HAIL_MIN_INCHES}" within ${spec.radiusMi} mi` };
      for (let d = spec.start; d <= upTo; d = addDaysYmd(d, 1)) {
        let reps: [number, number, number][];
        try { reps = await hailDay(d); } catch (e) { if (d >= addDaysYmd(today, -1)) continue; throw e; } // today's/yesterday's file may not exist yet
        const r = hailHit(reps, pl.lat, pl.lon, spec.radiusMi!);
        if (r.hit) { v = { hit: true, final, on: d, detail: `${r.size}" hail reported ${r.miles} mi away on ${shortDay(d)}` }; break; }
      }
    } else {
      const fires = (await firesNear(pl.lat, pl.lon, spec.radiusMi!, FIRE_MIN_ACRES, 30 * 60_000)).filter((f) => f.date >= spec.start && f.date <= upTo);
      v = fires.length ? { hit: true, final, on: fires[0].date, detail: `${fires[0].name || "Wildfire"} (${Math.round(fires[0].acres)} acres) discovered ${shortDay(fires[0].date)}` }
        : { hit: false, final, detail: `no ${FIRE_MIN_ACRES}+ acre wildfire within ${spec.radiusMi} mi` };
    }
  }
  memo.set(key, { t: Date.now(), v });
  return v;
}

export { DAY_MS };
