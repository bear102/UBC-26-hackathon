// Long-dated markets: sports futures (season wins, playoffs, division, conference, title) on Gemini + Kalshi,
// and a short list of month / quarter / year macro series on Kalshi.
//
// Pure module (types-only imports) so normalize.ts and dflow.ts can call it without an import cycle.
// The Gemini fetcher lives in futuresFetch.ts.
//
// Why: the category listing (`/events?category=Sports`) never returns futures, so before this every game
// contract in the universe settled within ~31 days. A sports bar's real exposure is the whole season:
// a deep playoff run = weeks of packed game nights; missing the playoffs = a dead spring.
import type { Peril } from "../types";
import type { SeriesSpec } from "./dflow";
import type { Bounds, ContractMeta } from "./normalize";

export type FutureKind = "playoffs" | "division" | "conference" | "round" | "title" | "wins";

/**
 * Gemini futures events, fetched by ticker (checked live 2026-11-19: all 19 answer 200 with quotes).
 * Season-specific: roll these when the 2027-28 tickers list.
 */
export const GEMINI_FUTURES_TICKERS = [
  "NBAF-2627CHAMP", "NBAF-2627CONF-WEST", "NBAPLAYOFFS26-27",
  "PROFB2027", "AFCCHAMP27", "NFCCHAMP27", "NFLPLAYOFF26-27", "NFLAFCSOUTH26", "NFLNFCEAST26", "NFLHOUWINS26", "NFLDALWINS26",
  "NHLPLAYOFFS26-27", "NHLWCF27", "NHLSTANLEYCUP27",
  "CFBPLAYOFF2627", "CFBSEC26", "CFBBIG1226", "CFBCHAMP2627",
  "NCAAMCHAMP27",
] as const;
/** Search terms for the fallback discovery pass (only events tagged `futures` are kept). */
export const GEMINI_FUTURES_SEARCH = ["Qualifiers", "Champion", "Conference", "Division", "Total Wins"];

// ---------- ticker -> league / kind ----------

const GEMINI_LEAGUE: [RegExp, string][] = [
  [/^(NBAF-|NBAPLAYOFFS)/, "NBA"],
  [/^(PROFB|AFCCHAMP|NFCCHAMP|NFLPLAYOFF|NFLAFC|NFLNFC|NFL[A-Z]{2,3}WINS)/, "NFL"],
  [/^CFB(PLAYOFF|SEC|BIG|ACC|CHAMP)/, "NCAAF"],
  [/^NCAAM(CHAMP|TOURN)/, "NCAAM"],
  [/^NHL(PLAYOFFS|WCF|ECF|STANLEYCUP)/, "NHL"],
];
const KALSHI_LEAGUE: [RegExp, string][] = [
  [/^KXNBA(PLAYOFF|WEST|EAST|WCFQUAL|ECFQUAL|WINS)?$/, "NBA"],
  [/^KXNFL(PLAYOFF|PLAYOFFHOST|NFCEAST|NFCWEST|NFCNORTH|NFCSOUTH|AFCEAST|AFCWEST|AFCNORTH|AFCSOUTH|WINS)$|^KXSB$/, "NFL"],
  [/^KXNHL(PLAYOFF|WEST|EAST)?$/, "NHL"],
  [/^KXNCAAF(PLAYOFF|SEC|BIG12|TOPSEED)?$/, "NCAAF"],
  [/^KXMARMAD$/, "NCAAM"],
];

/** "KXNBA-27-SAS" -> "KXNBA"; "GEMI-NBAF-2627CHAMP-SAS" -> "NBAF-2627CHAMP-SAS". */
const kalshiSeriesOf = (t: string) => t.split("-")[0];
const geminiBare = (t: string) => t.replace(/^GEMI-/, "");

/** League of a futures ticker (Gemini event / instrument ticker, or Kalshi series / event / market ticker). */
export function futureLeague(ticker: string): string | undefined {
  if (/^KX/.test(ticker)) return KALSHI_LEAGUE.find(([re]) => re.test(kalshiSeriesOf(ticker)))?.[1];
  const t = geminiBare(ticker);
  return GEMINI_LEAGUE.find(([re]) => re.test(t))?.[1];
}

/** Is this a season-long sports futures ticker (not a single game)? */
export function isFutureTicker(ticker: string | undefined): boolean {
  return !!ticker && futureLeague(ticker) !== undefined;
}

/** What the YES side is about: make the playoffs, win the division / conference / title, win N games, reach a round. */
export function futureKind(ticker: string, title = ""): FutureKind {
  const t = /^KX/.test(ticker) ? kalshiSeriesOf(ticker) : geminiBare(ticker);
  // ticker codes are matched case-sensitively, title words case-insensitively
  if (/WINS/.test(t) || /total wins/i.test(title)) return "wins";
  if (/PLAYOFFHOST|WCFQUAL|ECFQUAL|TOPSEED/.test(t) || /host a playoff|top \d+ seed|conference finals qualif/i.test(title)) return "round";
  if (/PLAYOFF/.test(t) || /qualifiers/i.test(title)) return "playoffs";
  if (/[AN]FC(SOUTH|NORTH|EAST|WEST)/.test(t) || /division/i.test(title)) return "division";
  if (/CONF|WEST|EAST|AFCCHAMP|NFCCHAMP|WCF|ECF|SEC|BIG1|ACC/.test(t) || /conference/i.test(title)) return "conference";
  return "title";
}

// ---------- calendar: when the observation really ends ----------

/**
 * 2026-27 season calendar (US Central dates). `start` = first day of the season (observation already running);
 * each kind = the day the outcome is known. Used for meta.eventEnd instead of venue close dates: Kalshi lists
 * placeholder closes in 2029 (KXNBA, KXSB, KXNHL), Gemini expiries can lag the real outcome by days.
 */
export const LEAGUE_CALENDAR: Record<string, { start: string } & Partial<Record<FutureKind, string>>> = {
  NBA: { start: "2026-10-20", wins: "2027-04-11", playoffs: "2027-04-17", round: "2027-05-17", conference: "2027-05-31", title: "2027-06-20" },
  NFL: { start: "2026-09-09", wins: "2027-01-10", playoffs: "2027-01-10", division: "2027-01-10", round: "2027-01-24", conference: "2027-01-31", title: "2027-02-14" },
  NCAAF: { start: "2026-08-29", conference: "2026-12-05", playoffs: "2026-12-06", round: "2026-12-06", title: "2027-01-25" },
  NHL: { start: "2026-10-06", wins: "2027-04-15", playoffs: "2027-04-15", division: "2027-04-15", round: "2027-05-20", conference: "2027-06-01", title: "2027-06-25" },
  NCAAM: { start: "2026-11-02", conference: "2027-03-14", playoffs: "2027-03-15", round: "2027-03-29", title: "2027-04-05" },
};

const centralDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** Observation window of a future. A venue expiry earlier than the calendar end (and inside the season) wins: it is more precise. */
export function futureWindow(league: string, kind: FutureKind, venueExpiry?: string): { eventDate: string; eventEnd: string } | undefined {
  const cal = LEAGUE_CALENDAR[league];
  if (!cal) return undefined;
  let end = cal[kind] ?? cal.title ?? cal.playoffs;
  if (!end) return undefined;
  const v = venueExpiry && Number.isFinite(Date.parse(venueExpiry)) ? centralDay(venueExpiry) : undefined;
  if (v && v >= cal.start && v < end) end = v;
  return { eventDate: cal.start, eventEnd: end };
}

// ---------- team identity from the rules text ----------

const norm = (s: string) => s.toLowerCase().replace(/[.,'’?]/g, "").replace(/&/g, " and ").replace(/\s+/g, " ").trim();

/** Team named by a resolution rule: "This market resolves to Yes if San Antonio Spurs wins ..." -> "San Antonio Spurs". */
export function ruleTeam(rules: string | undefined): string | undefined {
  if (!rules) return undefined;
  const m = rules.match(/\bif\s+(?:the\s+)?(.+?)\s+(?:wins?|qualif(?:y|ies)|is\s|are\s|hosts?|makes?|reach(?:es)?|advances?)\b/i);
  if (!m) return undefined;
  const t = m[1].replace(/\s+Pro\s+(Basketball|Football|Hockey)\s+team$/i, "").trim();
  return t.length > 1 && t.length < 40 ? t : undefined;
}

/** Team in a wins-ladder title: "Houston Total Wins" / "Pro Basketball: Atlanta Total Wins" -> "Houston" / "Atlanta". */
export function titleTeam(title: string): string | undefined {
  const m = title.replace(/^.*?:\s*/, "").match(/^(.+?)\s+Total Wins\??$/i);
  return m?.[1].trim();
}

/**
 * Names that identify the YES team, or null when the label and the rules text disagree (drop the contract).
 * Gemini's NBAPLAYOFFS26-27 lists label "Sacramento" with rules "If San Antonio qualifies..." (and vice versa):
 * the rules text is what settles, the label is what a user reads; when they differ nothing is safe to sell.
 * Pro leagues: rules may add the nickname ("San Antonio" vs "San Antonio Spurs"). College: exact match only
 * ("Texas" is not "Texas A&M").
 */
export function futureTeams(o: { label: string; rules?: string; title?: string; league: string; kind: FutureKind; extra?: (string | undefined)[] }): string[] | null {
  const labelTeam = o.kind === "wins" ? titleTeam(o.title ?? "") ?? o.label : o.label;
  const rt = ruleTeam(o.rules);
  if (rt) {
    const a = norm(labelTeam), b = norm(rt);
    const college = o.league === "NCAAF" || o.league === "NCAAM";
    const ok = a === b || (!college && (b.startsWith(`${a} `) || a.startsWith(`${b} `)));
    if (!ok) return null;
  }
  const out: string[] = [];
  for (const x of [labelTeam, rt, ...(o.extra ?? [])]) if (x && !out.some((y) => norm(y) === norm(x))) out.push(x);
  return out;
}

/** "9+ wins" -> ≥9 wins, "17 wins" -> exactly 17. */
export function winsBounds(label: string): Bounds | undefined {
  let m = label.match(/^(\d+)\s*\+\s*wins?$/i);
  if (m) return { lo: Number(m[1]), loInclusive: true, hiInclusive: false, unit: "wins", text: `≥${m[1]} wins` };
  m = label.match(/^(\d+)\s*wins?$/i);
  if (m) return { lo: Number(m[1]), hi: Number(m[1]), loInclusive: true, hiInclusive: true, unit: "wins", text: `${m[1]} wins` };
  return undefined;
}

/**
 * Wins ladders must be monotonic: P(≥14 wins) can't exceed P(≥9 wins). Gemini's thin ladders sometimes show
 * stale asks far out of line ("14+ wins" YES 0.42 while "9+ wins" is 0.30): selling NO there would be a bad
 * hedge, so a rung whose YES ask is > 0.02 above a lower rung's ask is dropped.
 */
export function brokenWinsRung(rungs: { n: number; yesAsk: number | null }[], n: number): boolean {
  const me = rungs.find((r) => r.n === n);
  if (!me || me.yesAsk === null) return false;
  return rungs.some((r) => r.n < n && r.yesAsk !== null && me.yesAsk! > r.yesAsk + 0.02);
}

export type FutureMeta = Pick<ContractMeta, "eventDate" | "eventEnd" | "league" | "teams" | "opponents" | "bounds" | "rules" | "futureKind">;

/** Futures meta for one contract, or null when it must be dropped (label/rules disagree, broken wins rung). */
export function futureMeta(o: {
  ticker: string; title: string; label: string; rules?: string; venueExpiry?: string; extraNames?: (string | undefined)[];
  winsRungs?: { n: number; yesAsk: number | null }[];
}): FutureMeta | null {
  const league = futureLeague(o.ticker);
  if (!league) return null;
  const kind = futureKind(o.ticker, o.title);
  const teams = futureTeams({ label: o.label, rules: o.rules, title: o.title, league, kind, extra: o.extraNames });
  if (!teams) return null;
  const bounds = kind === "wins" ? winsBounds(o.label) : undefined;
  if (bounds && o.winsRungs && brokenWinsRung(o.winsRungs, bounds.lo!)) return null;
  const w = futureWindow(league, kind, o.venueExpiry);
  return {
    league, teams, opponents: [], futureKind: kind, bounds,
    eventDate: w?.eventDate, eventEnd: w?.eventEnd,
    rules: o.rules ? o.rules.slice(0, 300) : undefined,
  };
}

// ---------- Kalshi series ----------

const fut = (series: string, league: string): SeriesSpec => ({ series, peril: "game", league, period: "range", futures: true });

/**
 * Kalshi futures series (checked live 2026-11-19, open events with priced Texas-team strikes).
 * Fetched only when a risk names a team (findCandidates) or a caller asks for them (snapshot): 17 extra
 * requests per pass and Kalshi answers 429 above ~8 req/s.
 */
export const FUTURES_KALSHI: SeriesSpec[] = [
  fut("KXNBAPLAYOFF", "NBA"), fut("KXNBAWEST", "NBA"), fut("KXNBAWCFQUAL", "NBA"), fut("KXNBA", "NBA"), fut("KXNBAWINS", "NBA"),
  fut("KXNFLPLAYOFF", "NFL"), fut("KXNFLPLAYOFFHOST", "NFL"), fut("KXNFLNFCEAST", "NFL"), fut("KXNFLAFCSOUTH", "NFL"), fut("KXSB", "NFL"),
  fut("KXNHLPLAYOFF", "NHL"), fut("KXNHLWEST", "NHL"), fut("KXNHL", "NHL"),
  fut("KXNCAAFPLAYOFF", "NCAAF"), fut("KXNCAAFSEC", "NCAAF"), fut("KXNCAAFTOPSEED", "NCAAF"), fut("KXNCAAF", "NCAAF"),
];
/** The 8 deepest futures series (fallback if the full list is too slow / rate limited). */
export const FUTURES_KALSHI_CORE = ["KXNBA", "KXNBAWEST", "KXNBAPLAYOFF", "KXNFLPLAYOFF", "KXNFLNFCEAST", "KXNHL", "KXNCAAFPLAYOFF", "KXSB"];

/**
 * Month / quarter / year macro series matched to small-business exposure horizons (fuel budgets, a loan
 * refinancing next year, a recession hitting next year's sales). Existing perils only: PERIL_CODES is on-chain
 * and append-only.
 */
export const LONG_MACRO_KALSHI: SeriesSpec[] = [
  { series: "KXDIESELMON", peril: "gas" as Peril, period: "other" },     // diesel price on the last day of the month
  { series: "KXDIESELYE", peril: "gas" as Peril, period: "other" },      // diesel price at year end
  { series: "KXAAAGASMAX", peril: "gas" as Peril, period: "range" },     // max US gas price this year
  { series: "KXAAAGASMAXTX", peril: "gas" as Peril, period: "range" },   // max Texas gas price this year
  { series: "KXNATGASMON", peril: "natgas" as Peril, period: "other" },  // Henry Hub on the last day of the month
  { series: "KXMORTGAGERATE", peril: "fed" as Peril, period: "range" },  // max 30-yr mortgage rate over the year
  { series: "KXGOVTSHUTDOWN", peril: "other" as Peril, period: "other" },// shutdown on a funding deadline
  { series: "KXRECSSNBER", peril: "other" as Peril, period: "range" },   // recession (2 negative GDP quarters) this/next year
];
