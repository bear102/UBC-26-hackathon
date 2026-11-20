// Exposure horizons: how long a business's risk really lasts, and which long-dated contracts fit it.
//
// Before this every risk was a "next 7 days" risk: a sports bar's real exposure is the whole season (a deep playoff
// run = weeks of packed game nights; missing the playoffs = a dead spring), a landscaper's is a soaked month, a fleet's
// is the fuel bill until its contracts reprice. This module is pure (no network, no LLM):
//  - parseHorizon: month names, quarters, "next N months", "through <month>", "this winter", "season"/"playoffs"
//  - horizonFit:   how much of the exposure window a contract's observation window covers (minus dilution)
//  - futuresSide:  which side of an own-team season future pays when the business is hurt
//  - stageWanted:  "miss the playoffs" -> playoffs/wins; "deep run ends" -> round/conference/title
//  - monthsOfCover: a season hedge is bought once but covers months (budget is monthly)
//  - futuresFallbackRisks / periodFallbackRisks: deterministic season / month risks when the LLM is unavailable
import type { BusinessProfile, MarketContract, Risk } from "../types";
import { LEAGUE_CALENDAR, type FutureKind } from "../markets/futures";
import { addDays, centralDate, contractMeta, daysBetween, type ContractMeta } from "../markets/normalize";

export type HorizonKind = "event" | "month" | "season";
export interface Horizon { start: string; end: string; kind: HorizonKind }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monIdx = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.slice(0, 3)));
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const clipStart = (start: string, today: string) => (start < today ? today : start);

/** League a window talks about ("NBA playoffs", "Longhorns season", "Stanley Cup"). */
export function leagueIn(text: string): string | undefined {
  const s = text.toLowerCase();
  if (/\blonghorns\b/.test(s) && /basketball|march madness|ncaa tournament/.test(s)) return "NCAAM"; // not the NBA
  if (/\bnba\b|basketball|spurs|rockets|mavs|mavericks/.test(s) && !/college basketball|march madness|ncaa/.test(s)) return "NBA";
  if (/college football|\bcfp\b|longhorns|\bncaaf\b|bowl season/.test(s)) return "NCAAF";
  if (/march madness|college basketball|\bncaam?\b/.test(s)) return "NCAAM";
  if (/\bnhl\b|hockey|stanley cup|\bstars\b/.test(s)) return "NHL";
  if (/\bnfl\b|football|texans|cowboys|super bowl/.test(s)) return "NFL";
  return undefined;
}

/**
 * Long-horizon windows only (returns null for anything short: "next 7 days", "Saturday", "Nov 30", ISO dates, so the
 * caller's existing short-window parser keeps its behavior). Dates are US-Central YYYY-MM-DD; start is never before today.
 */
export function parseHorizon(w: string | undefined, now = new Date(), league?: string): Horizon | null {
  const s = (w ?? "").toLowerCase().trim();
  if (!s || /\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const today = centralDate(now);
  const [ty, tm] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  let m: RegExpMatchArray | null;

  // a window that names a day / this week is short even when it mentions the season ("Super Bowl Sunday",
  // "next 7 days (NBA season)", "the season opener on Saturday"): leave it to the caller's short-window parser
  const shortCue = /\b(next|coming)\s+\d{1,2}\s+days?\b|\b(this|next) (week|weekend)\b|\b(today|tonight|tomorrow)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\bopener\b|\bweekend\b/.test(s);
  // "holiday season": through Dec 31 (not a 6-month sports season)
  if (!shortCue && /\bholiday season\b/.test(s) && tm >= 9) return { start: today, end: ymd(ty, 11, 31), kind: daysBetween(today, ymd(ty, 11, 31)) > 45 ? "season" : "month" };
  // sports seasons: "through the NBA playoffs", "2026-27 NBA playoffs", "rest of the season", "postseason"
  if (!shortCue && /\b(season|playoffs?|postseason|finals|title run|championship|stanley cup|super bowl|march madness|bowl games?)\b/.test(s)) {
    const lg = league ?? leagueIn(s);
    const cal = lg ? LEAGUE_CALENDAR[lg] : undefined;
    if (cal) {
      let kind: FutureKind = "title";
      if (/regular season|rest of the (regular )?season|make the playoffs|playoff (race|qualif)|win total/.test(s) && !/through the playoffs|postseason/.test(s)) kind = cal.wins ? "wins" : "playoffs";
      else if (/conference finals|(west|east)(ern)? finals|conference (title|championship)/.test(s)) kind = "conference";
      else if (/\bplayoff selection|selection (day|sunday)/.test(s)) kind = "playoffs";
      const end = cal[kind] ?? cal.title ?? cal.playoffs!;
      if (end >= today) return { start: today, end, kind: "season" };
    }
    if (/\bseason\b/.test(s)) return { start: today, end: addDays(today, 180), kind: "season" };
  }
  // "this winter" / "winter": Dec 1 - Mar 31 (the coming or current one)
  if (/\bwinter\b/.test(s)) {
    const y = tm >= 3 ? ty : ty - 1; // Apr..Dec -> this year's Dec; Jan..Mar -> last year's Dec
    return { start: clipStart(ymd(y, 11, 1), today), end: ymd(y + 1, 2, 31), kind: "season" };
  }
  // quarters: "Q1", "Q1 2027", "first quarter"
  if ((m = s.match(/\bq([1-4])\b(?:\s*(20\d\d))?/)) || (m = s.match(/\b(first|second|third|fourth) quarter\b(?:\s*(?:of\s*)?(20\d\d))?/))) {
    const q = /^\d$/.test(m[1]) ? Number(m[1]) : ["first", "second", "third", "fourth"].indexOf(m[1]) + 1;
    let y = m[2] ? Number(m[2]) : ty;
    if (!m[2] && ymd(y, q * 3 - 1, lastDay(y, q * 3 - 1)) < today) y++;
    const end = ymd(y, q * 3 - 1, lastDay(y, q * 3 - 1));
    return { start: clipStart(ymd(y, q * 3 - 3, 1), today), end, kind: daysBetween(today, end) > 45 ? "season" : "month" };
  }
  // "next 3 months"
  if ((m = s.match(/\bnext\s+(\d+|two|three|four|five|six)\s+months?\b/))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ["", "", "two", "three", "four", "five", "six"].indexOf(m[1]);
    const end = addDays(today, Math.round(30.4 * n));
    return { start: today, end, kind: n >= 2 ? "season" : "month" };
  }
  // month ranges and months: "December", "Dec 2026", "Nov-Dec", "December through February", "by March", "through January"
  const monthOf = (name: string, year?: string, endOfRange = false): { y: number; m: number } => {
    const mi = monIdx(name);
    let y = year ? Number(year) : ty;
    if (!year && (mi < tm || (endOfRange && mi < tm))) y++;
    return { y, m: mi };
  };
  const NO_DAY = "(?!\\s*\\d{1,2}(?:st|nd|rd|th)?\\b(?!\\d))"; // "Nov 30" is a date, not a month
  const range = s.match(new RegExp(`\\b${MON_RE}${NO_DAY}\\s*(?:20(\\d\\d))?\\s*(?:-|–|to|through|thru|until)\\s*${MON_RE}${NO_DAY}\\s*(20\\d\\d)?\\b`));
  if (range) {
    const a = monthOf(range[1], range[2] ? `20${range[2]}` : undefined);
    let b = monthOf(range[3], range[4]);
    if (b.y * 12 + b.m < a.y * 12 + a.m) b = { y: a.y + 1, m: b.m };
    const end = ymd(b.y, b.m, lastDay(b.y, b.m));
    return { start: clipStart(ymd(a.y, a.m, 1), today), end, kind: daysBetween(today, end) > 45 ? "season" : "month" };
  }
  // "through May 31, 2027" / "until Jan 10": a long dated end (short ones stay with the caller's parser)
  const byDay = s.match(new RegExp(`\\b(?:by|through|thru|until|till|before)\\s+(?:the\\s+)?${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d\\d))?\\b`));
  if (byDay) {
    const b = monthOf(byDay[1], byDay[3]);
    const end = ymd(b.y, b.m, Math.min(Number(byDay[2]), lastDay(b.y, b.m)));
    const span = daysBetween(today, end);
    return span >= 20 ? { start: today, end, kind: span > 45 ? "season" : "month" } : null;
  }
  const by = s.match(new RegExp(`\\b(?:by|through|thru|until|till|before|into)\\s+(?:the\\s+end\\s+of\\s+)?${MON_RE}${NO_DAY}\\s*(20\\d\\d)?\\b`));
  if (by) {
    const b = monthOf(by[1], by[2]);
    const end = ymd(b.y, b.m, lastDay(b.y, b.m));
    if (end < today) return null;
    return { start: today, end, kind: daysBetween(today, end) > 45 ? "season" : "month" };
  }
  // a bare "may" is usually the verb: only "May 2027" / "in May" count
  const one = s.match(new RegExp(`(?:^|\\b(?:in|for|during|all of|rest of|whole|entire)\\s+|^)${MON_RE}${NO_DAY}\\s*(20\\d\\d)?\\b`));
  if (one && (one[1] !== "may" || one[2] || /\b(in|for|during) may\b/.test(s)) && !(one[1] === "march" && /march madness/.test(s))) {
    const a = monthOf(one[1], one[2]);
    const end = ymd(a.y, a.m, lastDay(a.y, a.m));
    if (end < today) return null;
    return { start: clipStart(ymd(a.y, a.m, 1), today), end, kind: "month" };
  }
  if (/\b(this|rest of the|whole|entire) month\b/.test(s)) return { start: today, end: ymd(ty, tm, lastDay(ty, tm)), kind: "month" };
  return null;
}

/** event (a day / a game / a week), month (2-6 weeks), season (longer). */
export function horizonKind(start: string, end: string): HorizonKind {
  const d = daysBetween(start, end);
  return d > 45 ? "season" : d >= 20 ? "month" : "event";
}

/** Horizon of a risk: its explicit tag, else parsed from its window ("event" when the window is short or unparsed). */
export function riskHorizon(risk: Pick<Risk, "window"> & { horizon?: HorizonKind }, now = new Date()): HorizonKind {
  return risk.horizon ?? parseHorizon(risk.window, now)?.kind ?? "event";
}

/**
 * 0..1: share of the exposure window that the contract's observation window covers, minus a dilution penalty when the
 * contract runs far past the exposure (a 9-month future for a 2-week exposure mostly pays on other things).
 */
export function horizonFit(contract: { start: string; end: string }, exposure: { start: string; end: string }): number {
  const eLen = Math.max(1, daysBetween(exposure.start, exposure.end) + 1);
  const s = contract.start > exposure.start ? contract.start : exposure.start;
  const e = contract.end < exposure.end ? contract.end : exposure.end;
  let fit = Math.max(0, daysBetween(s, e) + 1) / eLen;
  const cLen = Math.max(1, daysBetween(s, contract.end) + 1);
  if (cLen > 3 * eLen) fit -= Math.min(0.5, 0.1 * (cLen / eLen - 3));
  return Math.max(0, Math.min(1, fit));
}

/** Months a hedge covers from now (budget is monthly; a season hedge is bought once). 1..6. */
export function monthsOfCover(end: string | undefined, now = new Date()): number {
  if (!end) return 1;
  const d = daysBetween(centralDate(now), end.slice(0, 10));
  return Math.max(1, Math.min(6, Math.round((d / 30.4) * 10) / 10));
}

// ---------- own teams ----------

export interface OwnTeam { nick: string; city: string; names: string[]; league: string[]; conf?: string; homePerRound: number }
/** Texas teams the benchmark cares about. `homePerRound` = expected home games per playoff round (NBA/NHL best-of-7 ~2.5). */
export const OWN_TEAMS: (OwnTeam & { re: RegExp })[] = [
  { re: /\bspurs\b/i, nick: "Spurs", city: "San Antonio", names: ["san antonio", "san antonio spurs", "spurs"], league: ["NBA"], conf: "Western", homePerRound: 2.5 },
  { re: /\brockets\b/i, nick: "Rockets", city: "Houston", names: ["houston", "houston rockets", "rockets"], league: ["NBA"], conf: "Western", homePerRound: 2.5 },
  { re: /\bmavericks\b|\bmavs\b/i, nick: "Mavericks", city: "Dallas", names: ["dallas", "dallas mavericks", "mavericks"], league: ["NBA"], conf: "Western", homePerRound: 2.5 },
  { re: /\btexans\b/i, nick: "Texans", city: "Houston", names: ["houston", "houston texans", "texans"], league: ["NFL"], conf: "AFC", homePerRound: 0.5 },
  { re: /\bcowboys\b/i, nick: "Cowboys", city: "Dallas", names: ["dallas", "dallas cowboys", "cowboys"], league: ["NFL"], conf: "NFC", homePerRound: 0.5 },
  { re: /\blonghorns\b|\bUT Austin\b/i, nick: "Longhorns", city: "Austin", names: ["texas", "texas longhorns", "longhorns"], league: ["NCAAF", "NCAAM"], homePerRound: 0.5 },
  { re: /\bdallas stars\b|\bstars (game|hockey|playoff)/i, nick: "Stars", city: "Dallas", names: ["dallas", "dallas stars", "stars"], league: ["NHL"], conf: "Western", homePerRound: 2.5 },
];

/** Teams named in a text, in order of first mention. */
export function ownTeamsIn(text: string): OwnTeam[] {
  return OWN_TEAMS.map((t) => ({ t, i: text.search(t.re) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map(({ t: { re: _re, ...t } }) => t);
}

/** Is this contract (by its meta) a future on one of `owns`? League-aware: "Houston" is the Rockets only in the NBA. */
export function ownFutureTeam(meta: Pick<ContractMeta, "teams" | "league" | "futureKind"> | undefined, owns: OwnTeam[]): OwnTeam | undefined {
  if (!meta?.futureKind || !meta.teams?.length) return undefined;
  return owns.find((o) => (!meta.league || o.league.includes(meta.league)) && meta.teams!.some((t) => o.names.includes(t.toLowerCase().trim())));
}

const PROMO_STRONG = /\bpromo(tion)?s?\b|giveaway|free (drinks?|wings?|beers?|food|rounds?|meals?)|discount if|we (pay|comp) (out|for)/i;
const LOSS_WORDS = /\b(miss(es|ing)?|lose|loses|losing|lost|eliminat\w*|fail\w*|knocked out|bounced|early exit|run ends|ends early|slump|no playoffs)\b/i;
const PROMO = /\bpromo(tion)?s?\b|giveaway|free (drinks?|wings?|beers?|food|rounds?|meals?)|we (pay|comp) (out|for)|fund (a|the|our)\b|if (we|they|the \w+) wins?\b|discount if/i;

/**
 * Side of an own-team future that pays when the business is hurt. Revenue risks (miss the playoffs, run ends early,
 * losing season) are hurt by a BAD outcome: NO on the team's playoffs / round / conference / title / "N+ wins" contract.
 * A promo the business funds when the team wins ("free wings if the Texans make the playoffs") is hurt by a GOOD one: YES.
 * null when the contract is not a future on one of the owner's teams.
 */
export function futuresSide(risk: Pick<Risk, "title" | "trigger"> & { lossReasoning?: string }, meta: Pick<ContractMeta, "teams" | "league" | "futureKind"> | undefined, owns: OwnTeam[]): "yes" | "no" | null {
  if (!ownFutureTeam(meta, owns)) return null;
  const t = `${risk.title} ${risk.trigger}`;
  // strong promo words decide; the weak ones ("fund our ...", "if they win") only when the text is not about a bad season
  // ("Spurs miss the playoffs and we can't fund our payroll" is a revenue risk: NO)
  if (PROMO_STRONG.test(t)) return "yes";
  return PROMO.test(t) && !LOSS_WORDS.test(t) ? "yes" : "no";
}

/** Which futures stages fit the wording of a season risk (best first); [] = no preference. */
export function stageWanted(text: string): FutureKind[] {
  const s = text.toLowerCase();
  if (/\bhost(s|ing)? a (home )?playoff|home playoff game/.test(s)) return ["round", "playoffs"];
  // a deep-run wording wins over "miss ... playoff": "Rockets miss deep playoff run" is about the conference finals
  if (/deep (playoff )?run|first round|round one|bounced|one and done|conference finals|(west|east)(ern)? (conference )?finals|run ends|knocked out|eliminated|early (playoff )?exit|second round|before the (finals|conference)/.test(s)) return ["round", "conference"];
  if (/\bmiss(es|ing)?\b[^.]{0,20}\bplayoffs?\b|no playoffs|fail(s|ing)? to (make|reach|qualify)[^.]{0,20}playoffs?|out of the playoffs|playoff drought|don'?t make the playoffs|not make the playoffs/.test(s)) return ["playoffs", "wins", "division"];
  if (/losing season|win total|\bwins?\b.{0,12}\b(or fewer|under|below)\b/.test(s)) return ["wins", "playoffs"];
  if (/\b(title|championship|super bowl|stanley cup|finals)\b/.test(s)) return ["title", "conference"];
  return [];
}

// ---------- deterministic long-horizon risks ----------

const CROWD = /\bbars?\b|\bpub\b|tavern|taphouse|\bgrill\b|\bwings?\b|watch part|sports|game nights?|game days?|restaurant|brewery|\brentals?\b|airbnb|vrbo|\bstays\b|hotel|merch|jerseys?/i;
const r10 = (x: number) => Math.max(10, Math.round(x / 10) * 10);
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Price of an own-team future of `kind` on the given side (cheapest across venues), from a market list. */
function ownAsk(markets: MarketContract[], team: OwnTeam, kinds: FutureKind[], side: "yes" | "no"): number | null {
  let best: number | null = null;
  for (const c of markets) {
    const m = contractMeta(c.id);
    if (c.status !== "open" || !m?.futureKind || !kinds.includes(m.futureKind) || !ownFutureTeam(m, [team])) continue;
    const a = side === "yes" ? c.yesAsk : c.noAsk;
    if (a !== null && (best === null || a < best)) best = a;
  }
  return best;
}

/**
 * One season-long risk for a crowd business (bar, wing shop, STR host...) whose owner names a team:
 *  - a contender (make-playoffs >= 0.85) whose deep-run NO is an insurance price: "run ends before the conference finals"
 *  - otherwise: "misses the playoffs".
 * lossUsd = expected extra playoff nights lost x the lift a playoff night brings over a normal one (playbook table:
 * NBA/NHL ~2.5 home games per round, NFL a division winner hosts 1 wildcard game, CFP seeds 5-8 host a campus game).
 */
export function futuresFallbackRisks(profile: BusinessProfile, markets: MarketContract[] = [], now = new Date()): Omit<Risk, "id">[] {
  const text = `${profile.name} ${profile.description}`;
  if (!CROWD.test(text)) return [];
  // up to two teams (a wing shop that lives on Texans AND Cowboys Sundays), first-mentioned first; with a market list,
  // only teams that have a live season future (a risk nobody can hedge stays the LLM's call, not a canned fallback)
  const live = (team: OwnTeam) => !markets.length || markets.some((c) => c.status === "open" && !!ownFutureTeam(contractMeta(c.id), [team]));
  return ownTeamsIn(profile.description).filter(live).slice(0, 2).flatMap((team) => teamSeasonRisk(profile, team, markets, now));
}

function teamSeasonRisk(profile: BusinessProfile, team: OwnTeam, markets: MarketContract[], now: Date): Omit<Risk, "id">[] {
  const lg = team.league[0];
  const cal = LEAGUE_CALENDAR[lg];
  if (!cal) return [];
  const today = centralDate(now);
  const d = profile.avgDailyRevenueUsd;
  const lift = /double|twice|2x/i.test(profile.description) ? 1 : 0.8; // a playoff night vs a normal night
  const playoffsYes = ownAsk(markets, team, ["playoffs"], "yes");
  const deepNo = ownAsk(markets, team, ["round", "conference"], "no");
  const contender = playoffsYes !== null && playoffsYes >= 0.85;
  const season = lg === "NBA" ? "2026-27 NBA" : lg === "NFL" ? "2026 NFL" : lg === "NHL" ? "2026-27 NHL" : lg === "NCAAF" ? "College Football Playoff (2026-27)" : "2026-27 college basketball";
  const base = { peril: "game" as const, kind: "direct" as const, location: team.city, confidence: 0.5, horizon: "season" as const };

  if (contender && deepNo !== null && deepNo >= 0.1 && deepNo <= 0.7 && (cal.round ?? cal.conference)! >= today && (lg === "NBA" || lg === "NHL")) {
    const nights = 2 * team.homePerRound; // rounds 2 + 3 (conference finals) at home
    return [{ ...base, title: `${team.nick} playoff run ends before the ${team.conf ?? "conference"} finals`,
      trigger: `${team.nick} fail to reach the ${team.conf ?? ""} Conference finals`.replace(/\s+/g, " "),
      window: `through the ${season} playoffs`, lossUsd: r10(nights * lift * d),
      lossReasoning: `A deep run is ~${nights} extra home playoff nights at ~${Math.round(lift * 100)}% over a normal ${usd(d)} night: ${nights} x ${usd(lift * d)} = ${usd(nights * lift * d)}.` }];
  }
  if (lg === "NCAAF") {
    // CFP: missing it costs the December home game (seeds 5-8 host) + January watch parties
    const days = 2;
    return [{ ...base, title: `${team.nick} miss the College Football Playoff`, trigger: `${team.nick} fail to make the College Football Playoff`,
      window: `through the ${season}`, lossUsd: r10(days * lift * d),
      lossReasoning: `A CFP run is ~${days} big days (a campus playoff game for seeds 5-8, then watch parties): ${days} x ${usd(lift * d)} = ${usd(days * lift * d)}.` }];
  }
  const nights = lg === "NFL" ? 2 : team.homePerRound + 1; // NFL: wildcard + divisional weekends; NBA/NHL: first-round home games + the playoff push
  return [{ ...base, title: `${team.nick} miss the playoffs`, trigger: `${team.nick} fail to make the ${lg} playoffs`,
    window: `through the end of the ${season} regular season`, lossUsd: r10(nights * lift * d),
    lossReasoning: `Making the playoffs is ~${nights} extra ${lg === "NFL" ? "game days" : "home game nights"} at ~${Math.round(lift * 100)}% over a normal ${usd(d)} day: ${usd(nights * lift * d)}.` }];
}

const CREW = /landscap|lawn|mow(ing)?\b|\bcrews?\b|roof|install|construction|contractor|paint/i;
const WET = /rain|wet|soak|weather|storm/i;
/** A soaked month for crew businesses (landscapers, roofers): monthly rain total in the owner's city, this month (or next if < 7 days left). */
export function periodFallbackRisks(profile: BusinessProfile, now = new Date(), markets: MarketContract[] = []): Omit<Risk, "id">[] {
  if (!CREW.test(profile.description) || !WET.test(profile.description)) return [];
  const cityL = profile.city.split(",")[0].trim().toLowerCase();
  const period = (c: MarketContract) => { const m = contractMeta(c.id); return !!m?.eventDate && !!m.eventEnd && daysBetween(m.eventDate, m.eventEnd) >= 20; };
  if (markets.length && !markets.some((c) => c.peril === "rain" && c.status === "open" && (c.location ?? "").toLowerCase() === cityL && period(c))) return [];
  const today = centralDate(now);
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const left = lastDay(y, m) - Number(today.slice(8, 10));
  const mi = left >= 7 ? m : (m + 1) % 12;
  const month = MONTHS[mi][0].toUpperCase() + MONTHS[mi].slice(1);
  const city = profile.city.split(",")[0].trim();
  const d = profile.avgDailyRevenueUsd;
  const days = 2;
  return [{ peril: "rain", kind: "direct", horizon: "month", title: `A soaked ${month} rains out crew days`, trigger: `${city} gets more than 5 inches of rain in ${month}`,
    location: city, window: month, lossUsd: r10(days * 0.6 * d), confidence: 0.4,
    lossReasoning: `A wet month costs ~${days} crew days that can't be made up; crews are paid either way (~60% of a ${usd(d)} day each).` }];
}
