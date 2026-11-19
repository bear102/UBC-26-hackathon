// Seasonal hit-rate estimator: same calendar window (±15 days) in every past year of a daily history.
import { addDaysYmd, daysBetweenYmd, probFromEpisodes, windowText } from "./common";

export interface SeasonStats {
  p: number;               // chance of >= 1 episode in the window
  q: number;               // episode starts per observed day (smoothed)
  windowDays: number;
  observedDays: number;    // days with data in the seasonal band, all years
  eventDays: number;       // of those, days the trigger was met
  episodes: number;        // separate episodes (consecutive event days count once)
  yearsHit: number;        // years in which the EXACT window had an event
  years: number;           // complete years with data for the exact window
  band: string;            // "Nov 4–Dec 4"
  firstYear: number;
  lastYear: number;
}

/** Same month/day in another year (Feb 29 -> Feb 28). */
export function shiftYear(ymd: string, year: number): string {
  const md = ymd.slice(5);
  return md === "02-29" ? `${year}-02-28` : `${year}-${md}`;
}

export function seasonalStats(o: {
  isEvent: (d: string) => boolean; observed: (d: string) => boolean;
  start: string; end: string; firstYear: number; lastYear: number; today: string; padDays?: number;
}): SeasonStats {
  const L = daysBetweenYmd(o.start, o.end) + 1;
  const pad = o.padDays ?? (L >= 60 ? 0 : 15);
  let observedDays = 0, eventDays = 0, episodes = 0, yearsHit = 0, years = 0;
  let fy = Infinity, ly = -Infinity;
  for (let y = o.firstYear; y <= o.lastYear; y++) {
    const s = shiftYear(o.start, y), e = addDaysYmd(s, L - 1);
    const bs = addDaysYmd(s, -pad), be = addDaysYmd(e, pad);
    let prevEv = false, seen = 0;
    for (let d = bs; d <= be && d < o.today; d = addDaysYmd(d, 1)) {
      if (!o.observed(d)) { prevEv = false; continue; }
      seen++; observedDays++;
      const ev = o.isEvent(d);
      if (ev) { eventDays++; if (!prevEv) episodes++; }
      prevEv = ev;
    }
    if (seen) { fy = Math.min(fy, y); ly = Math.max(ly, y); }
    if (e < o.today) {
      let have = 0, hit = false;
      for (let d = s; d <= e; d = addDaysYmd(d, 1)) if (o.observed(d)) { have++; if (o.isEvent(d)) hit = true; }
      if (have >= 0.8 * L) { years++; if (hit) yearsHit++; }
    }
  }
  const { p, q } = probFromEpisodes(episodes, observedDays, L);
  const bandStart = addDaysYmd(o.start, -pad), bandEnd = addDaysYmd(o.end, pad);
  return { p, q, windowDays: L, observedDays, eventDays, episodes, yearsHit, years, band: windowText(bandStart, bandEnd), firstYear: Number.isFinite(fy) ? fy : o.firstYear, lastYear: Number.isFinite(ly) ? ly : o.lastYear };
}
