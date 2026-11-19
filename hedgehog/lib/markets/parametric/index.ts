// Hedgehog parametric cover: public API used by lib/markets (findCandidates / getContract), the explorer and the AI.
//   listParametric(perils, location, window?)  synthetic contracts for a place (default windows: next 7 and 30 days)
//   getParametric(id)                          fresh price + status/resolution from the settlement oracle (+ dev override)
//   parametricCandidates(risk, profile, win)   candidates for a risk whose peril no venue lists
import type { BusinessProfile, MarketContract, Peril, Risk } from "../../types";
import { FIRE_RADIUS_MI, HAIL_RADIUS_MI, PARAMETRIC_PERILS, PERIL_KIND, addDaysYmd, daysBetweenYmd, isParametricId, isParametricPeril, parseParametricId, todayCentral, type ParamSpec } from "./common";
import { resolvePlace } from "./geo";
import { buildParametric, parametricMeta, BACKING_LABEL, type ParamMeta } from "./price";
import { gaugeNear } from "./sources";
import { observe, overrideFor } from "./settle";

export { PARAMETRIC_PERILS, isParametricPeril, isParametricId, parseParametricId, parametricMeta, BACKING_LABEL };
export type { ParamMeta };

const MAX_WINDOW_DAYS = 120;

/** Specs for one place + window (flood needs a gauge near the place; others use the city). */
export async function specsFor(perils: Peril[], location: string, window: { start: string; end: string }): Promise<ParamSpec[]> {
  const place = await resolvePlace(location);
  if (!place) return [];
  let { start, end } = window;
  if (daysBetweenYmd(start, end) > MAX_WINDOW_DAYS) end = addDaysYmd(start, MAX_WINDOW_DAYS);
  const out: ParamSpec[] = [];
  for (const p of perils) {
    const kind = PERIL_KIND[p];
    if (!kind) continue;
    if (kind === "flood") {
      const g = await gaugeNear(place.slug, place.lat, place.lon);
      if (g) out.push({ kind, place: g.usgsId, start, end });
    } else out.push({ kind, place: place.slug, radiusMi: kind === "hail" ? HAIL_RADIUS_MI : kind === "wildfire" ? FIRE_RADIUS_MI : undefined, start, end });
  }
  return out;
}

export function defaultWindows(now = new Date()): { start: string; end: string }[] {
  const t = todayCentral(now);
  return [{ start: t, end: addDaysYmd(t, 6) }, { start: t, end: addDaysYmd(t, 29) }];
}

/** Synthetic contracts (open, priced) for perils no venue lists. Never throws; unknown places give []. */
export async function listParametric(perils: Peril[] = PARAMETRIC_PERILS, location = "Austin, TX", window?: { start: string; end: string }, now = new Date()): Promise<MarketContract[]> {
  const wins = window ? [window] : defaultWindows(now);
  const out: MarketContract[] = [];
  for (const w of wins) {
    const specs = await specsFor(perils.filter(isParametricPeril), location, w).catch(() => []);
    const built = await Promise.allSettled(specs.map((s) => buildParametric(s, now)));
    for (const b of built) if (b.status === "fulfilled" && b.value) out.push(b.value.contract);
  }
  return out;
}

/** Fresh contract for a hedgehog:* id: price from history, status/resolution from the oracle (or the dev override). */
export async function getParametric(id: string, now = new Date()): Promise<MarketContract | null> {
  const spec = parseParametricId(id);
  if (!spec) return null;
  const b = await buildParametric(spec, now).catch(() => null);
  if (!b) return null;
  const c = b.contract;
  const forced = overrideFor(id);
  if (forced) return { ...c, status: "settled", resolution: forced, yesAsk: null, noAsk: null, label: `${c.label} · forced ${forced.toUpperCase()} (dev override)` };
  const today = todayCentral(now);
  if (spec.start > today) return c;
  const obs = await observe(spec, now).catch(() => null);
  if (obs?.hit) return { ...c, status: "settled", resolution: "yes", yesAsk: null, noAsk: null, label: `${c.label} · ${obs.detail}` };
  if (spec.end < today) return obs?.final ? { ...c, status: "settled", resolution: "no", yesAsk: null, noAsk: null, label: `${c.label} · ${obs.detail}` } : { ...c, status: "closed", yesAsk: null, noAsk: null };
  return c;
}

/**
 * Candidates for a risk whose peril no prediction market lists (flood, smoke, hail, wildfire): the risk's own window,
 * plus a 30-day window when the risk window is short. The owner's city when the risk names no place.
 */
export async function parametricCandidates(risk: Risk, profile: BusinessProfile, win: { start: string; end: string }, now = new Date()): Promise<MarketContract[]> {
  if (!isParametricPeril(risk.peril)) return [];
  const loc = risk.location && !/^(us|usa|national)$/i.test(risk.location.trim()) ? risk.location : profile.city;
  const wins = [win];
  if (daysBetweenYmd(win.start, win.end) < 14) wins.push({ start: win.start, end: addDaysYmd(win.start, 29) });
  const out: MarketContract[] = [];
  for (const w of wins) out.push(...await listParametric([risk.peril], loc, w, now));
  if (!out.length && loc !== profile.city) for (const w of wins) out.push(...await listParametric([risk.peril], profile.city, w, now));
  return out;
}
