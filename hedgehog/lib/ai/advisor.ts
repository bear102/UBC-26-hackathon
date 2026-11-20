// AI decision loop (DESIGN §4): risk map (LLM pro) || creative brainstorm (LLM pro) -> candidates (code)
// -> ONE batched match with tiered choices (LLM fast, candidate-id enforced) + strike ladders (code)
// -> sizing + packages (code) -> summary. At most 4 LLM calls per advise(). Server-only.
import { z } from "zod/v4";
import type { BusinessProfile, HedgeLeg, MarketContract, NaturalHedge, Peril, Quote, QuoteLine, Risk } from "../types";
import { generateJson as defaultLlm, type GenerateJson } from "./llm";
import { getPreset } from "./presets";
import { adjustByAnswers, answersBlock, profileWithAnswers, suppressByAnswers } from "./clarifyRules";
import { applySignals, attachForecast, forecastBlock, type ForecastSummary } from "./forecast";
import { gameDayRisks } from "./discovery";
import type { ClarifyAnswer } from "../types";
import {
  BRAINSTORM_SYSTEM, TIER_LABEL, brainstormPrompt, brainstormSchema, buildCatalog, buildPackages, directionalPick, evidenceText,
  fallbackIdeas, filterIdeaCandidates, ideasFromBrainstorm, ideasFromPlaybook, labelBound, ladderChoices, sameExposure, type Idea, type PlaybookSeed, type TieredLeg,
} from "./ideas";
import { OWN_TEAMS, futuresFallbackRisks, futuresSide, leagueIn, ownTeamsIn, periodFallbackRisks, riskHorizon, stageWanted } from "./horizon";
import { contractMeta } from "../markets/normalize";
import { findEquivalent } from "../markets/compare";
import { MIN_PAYOUT_USD } from "../markets/quote";
import { noMarketReason, parametricEnabled } from "../markets/proxies";
import { isLongContract, longUniverse, seasonCalendar } from "./longContext";
import { settleDefaultPlan } from "./defaultPlan";
import type { Coverage } from "../client/quote";

// ---------- injectable dependencies ----------
export type SizeQuoteFn = (a: {
  legs: HedgeLeg[]; risks: Risk[]; contracts: Map<string, MarketContract>; coveragePct: number; budgetUsd: number; crossCheck?: boolean; now?: Date;
}) => Promise<{ lines: QuoteLine[]; uncovered: { riskId: string; reason: string }[]; totalPremiumUsd: number; totalPayoutUsd: number }>;

export interface AdvisorDeps {
  llm: GenerateJson;
  findCandidates: (risk: Risk, profile: BusinessProfile, limit?: number) => Promise<MarketContract[]>;
  sizeQuote: SizeQuoteFn;
  /** Optional: live market universe, used to steer the risk map toward hedgeable risks. */
  listMarkets?: (opts?: any) => Promise<MarketContract[]>;
  /** Optional: settled-history backtest (lib/markets hitRate) for weather evidence. */
  /** Optional: industry playbook seeds (lib/ai/playbook playbookIdeas). Each seed carries real candidate contracts. */
  playbookIdeas?: (profile: BusinessProfile, markets: MarketContract[]) => PlaybookSeed[] | Promise<PlaybookSeed[]>;
  hitRate?: (peril: Peril, location?: string, days?: number, opts?: { threshold?: number }) => Promise<{ settled: number; yesCount: number; threshold?: number; source: string } | null>;
  /** Optional: 7-day weather forecast + signals for the business location (lib/ai/forecast.ts). No LLM call. */
  forecast?: (profile: BusinessProfile, now: Date) => Promise<ForecastSummary | null>;
  now?: () => Date;
}

/** Fills missing deps; lib/markets is only imported when a market fn was not injected. */
async function resolveDeps(d: Partial<AdvisorDeps> = {}): Promise<AdvisorDeps> {
  if (d.findCandidates && d.sizeQuote) return { ...d, llm: d.llm ?? defaultLlm } as AdvisorDeps;
  const markets = await import("../markets/index");
  const quote = await import("../markets/quote");
  let playbookIdeas: AdvisorDeps["playbookIdeas"];
  try { playbookIdeas = (await import("./playbook/index")).playbookIdeas; } catch { /* optional: a broken playbook never breaks advise() */ }
  // Hedgehog parametric cover (flood / air quality / hail / wildfire) for the owner's city joins the playbook's universe
  if (playbookIdeas && parametricEnabled()) { // OFF by default: real markets only (HEDGEHOG_PARAMETRIC=1 re-enables)
    const pb = playbookIdeas, par = await import("../markets/parametric");
    playbookIdeas = async (p, m) => pb(p, [...m, ...await Promise.race([par.listParametric(par.PARAMETRIC_PERILS, p.city).catch(() => []), new Promise<MarketContract[]>((r) => setTimeout(() => r([]), 3000))])]);
  }
  let forecast: AdvisorDeps["forecast"];
  try { forecast = (await import("./forecast")).forecastFor; } catch { /* optional */ }
  return {
    playbookIdeas,
    forecast,
    llm: defaultLlm,
    findCandidates: markets.findCandidates,
    sizeQuote: quote.sizeQuote,
    listMarkets: markets.listMarkets as AdvisorDeps["listMarkets"],
    hitRate: markets.hitRate,
    ...d,
  };
}

export interface AdviseOpts {
  coveragePct?: number;
  deps?: Partial<AdvisorDeps>;
  /** Owner's answers to the clarifying questions (lib/ai/clarify.ts). Folded into the prompts; no extra LLM call. */
  answers?: ClarifyAnswer[];
}

// ---------- schemas ----------
export const PERILS = ["heat", "cold", "rain", "game", "oil", "gas", "fed", "cpi", "crypto", "other", "snow", "power", "water", "quake", "storm", "natgas", "metals", "flood", "smoke", "hail", "wildfire"] as const satisfies readonly Peril[];

export const riskMapSchema = z.object({
  risks: z.array(z.object({
    peril: z.enum(PERILS),
    title: z.string().min(3).describe("short, e.g. 'Rain on Saturday night'"),
    trigger: z.string().min(3).describe("measurable, market-like condition"),
    location: z.string().describe("where it is measured: 'Austin', 'San Antonio', 'US'"),
    window: z.string().describe("a date or range in the next 7 days for single events, OR the exposure period the owner actually feels: a calendar month for losses that pile up ('December'), through the season/playoffs for team runs ('through the 2026-27 NBA playoffs'), the meeting before a loan reprices ('through the Jan 27 2027 FOMC')"),
    horizon: z.enum(["event", "month", "season"]).optional().describe("event = a day/game/week; month = a month or quarter total; season = a season, playoff run or rate path"),
    lossUsd: z.number().positive().describe("USD lost per occurrence (event) or extra loss over the whole window (month/season)"),
    lossReasoning: z.string().min(10).describe("the arithmetic from the revenue numbers"),
    confidence: z.number().min(0).max(1),
  })).min(3).max(5),
});

export const matchSchema = z.object({
  picks: z.array(z.object({
    contractId: z.string().describe("copied exactly from CANDIDATES"),
    side: z.enum(["yes", "no"]).describe("the side that PAYS when the bad thing happens"),
    rationale: z.string(),
    basisRisk: z.string().describe("one honest sentence on mismatch"),
  })).max(2),
  noMatchReason: z.string().optional().describe("required when picks is empty"),
});

/** One call for every risk: 1-3 tiered picks each. */
export const batchMatchSchema = z.object({
  matches: z.array(z.object({
    riskId: z.string().describe("the RISK id, e.g. 'r1'"),
    picks: z.array(z.object({
      contractId: z.string().describe("copied exactly from this risk's CANDIDATES"),
      side: z.enum(["yes", "no"]).describe("the side that PAYS when the bad thing happens"),
      tier: z.enum(["recommended", "cheap-tail", "broad", "other-date", "other-side"]).optional(),
      rationale: z.string(),
      basisRisk: z.string().describe("one honest sentence on mismatch"),
    })).max(3),
    noMatchReason: z.string().optional().describe("required when picks is empty"),
  })),
});

const summarySchema = z.object({ summary: z.string().min(20) });

// ---------- helpers ----------
const TZ = "America/Chicago";
function todayLabel(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function dayLabel(d: Date) {
  return d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
}
export function nextDays(now: Date, n = 7): string[] {
  return Array.from({ length: n }, (_, i) => dayLabel(new Date(now.getTime() + i * 86_400_000)));
}
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const px = (n: number | null) => (n == null ? "-" : n.toFixed(2));

function profileBlock(p: BusinessProfile, answers: ClarifyAnswer[] = []) {
  const ans = answersBlock(answers);
  return [
    `Business: ${p.name}`,
    `Owner says: "${p.description}"`,
    `City: ${p.city}${p.zip ? ` (ZIP ${p.zip})` : ""}`,
    `Average daily revenue: ${usd(p.avgDailyRevenueUsd)}`,
    `Busy days: ${p.busyDays.join(", ") || "not given"}`,
    `Monthly hedge budget: ${usd(p.monthlyBudgetUsd)}`,
    ...(ans ? [ans] : []),
  ].join("\n");
}

/** Compact one-line-per-contract candidate list for the matcher prompt. */
export function candidateLines(cands: MarketContract[]): string {
  return cands.map((c) => {
    const exp = new Date(c.expiry);
    const expS = isNaN(exp.getTime()) ? c.expiry : exp.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric" }) + " CT";
    // season futures / period markets: the day observation ends (meta.eventEnd), not a placeholder venue expiry (Kalshi futures say 2029)
    const m = contractMeta(c.id);
    const when = m?.eventEnd && (m.futureKind || isLongContract(c)) ? `settles ${m.eventEnd}${m.futureKind ? ` (season future: ${m.futureKind})` : ""}` : `expires ${expS}`;
    // single games: say who is home and when the game is played (venue titles say "A vs B" with the away team first,
    // and the expiry is a settlement deadline days later; the model read both wrong in demo QA)
    const g = c.peril === "game" && !m?.futureKind ? gameSides(c) : null;
    const st = g ? gameStartCT(c) : null;
    const game = g ? ` | game: ${g.away} AT ${g.home} (home: ${g.home})${st ? `, played ${st}` : ""}` : "";
    return `- ${c.id} | ${c.venue}${c.tradable || (c.venue === "polymarket" && c.status === "open") ? " (buyable)" : " (advice-only)"} | "${c.eventTitle}" | label "${c.label}" | YES ask ${px(c.yesAsk)} / NO ask ${px(c.noAsk)} | ${when}${game}${c.proxyNote ? ` | proxy: ${c.proxyNote}` : ""}`;
  }).join("\n");
}

const WEATHER = new Set(["heat", "cold", "rain"]);
/** Summarizes the live market universe (steers the risk map toward risks that can be hedged).
 *  Per peril: event count + up to 6 example events (relevant city/teams first) with a few labels. */
export function marketUniverse(markets: MarketContract[], profile: BusinessProfile, perPeril = 6, nowMs = Date.now()): string {
  const all = markets.filter((m) => m.status === "open");
  const open = all.filter((m) => !isLongContract(m, nowMs)); // season futures / period markets: own section below (game nights must not crowd them out)
  if (!all.length) return "";
  const city = profile.city.split(",")[0].trim().toLowerCase();
  const words = new Set([...(profile.description.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? []).map((w) => w.toLowerCase()), ...teamWords(profile.description)]);
  words.delete(city);
  const byPeril = new Map<string, Map<string, MarketContract[]>>();
  for (const m of open) {
    const ev = byPeril.get(m.peril) ?? new Map<string, MarketContract[]>(); byPeril.set(m.peril, ev);
    const d = new Date(m.expiry); const closes = isNaN(d.getTime()) ? "" : `, closes ${d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })}`;
    const k = `${m.eventTitle} [${m.venue}${closes}]`; ev.set(k, [...(ev.get(k) ?? []), m]);
  }
  const out: string[] = [];
  for (const [peril, events] of byPeril) {
    const score = (t: string) => { const l = (t + " " + (events.get(t) ?? []).map((c) => c.label).join(" ")).toLowerCase(); return (l.includes(city) ? 2 : 0) + (!WEATHER.has(peril) && [...words].some((w) => l.includes(w)) ? 3 : 0); };
    let list = [...events.entries()].sort((x, y) => score(y[0]) - score(x[0]));
    if (peril === "game") list = list.filter(([t]) => score(t) >= 3);
    else if (list.some(([t]) => score(t) > 0)) list = list.filter(([t]) => score(t) > 0); // local markets only when they exist
    const ex = list.slice(0, perPeril).map(([t, cs]) => `  - ${t}: ${cs.slice(0, 4).map((c) => c.label).join(" / ")}${cs.length > 4 ? " / ..." : ""}`);
    out.push(`${peril}: ${events.size} live events${ex.length ? "\n" + ex.join("\n") : ""}`);
  }
  const long = longUniverse(all, profile, nowMs);
  if (long) out.push(`SEASON FUTURES & PERIOD MARKETS (settle in 1-12 months; for season / month exposures):\n${long}`);
  return out.join("\n");
}

/** Venues list teams by city ("San Antonio"), owners say nicknames ("Spurs"). */
export const TEAM_CITY: Record<string, string> = {
  spurs: "san antonio", texans: "houston", rockets: "houston", astros: "houston", dynamo: "houston",
  mavericks: "dallas", mavs: "dallas", cowboys: "dallas", stars: "dallas", rangers: "texas", longhorns: "texas",
  aggies: "texas a&m", "austin fc": "austin", verde: "austin", baylor: "baylor", "red raiders": "texas tech",
};
export function teamWords(text: string): string[] {
  const l = text.toLowerCase(); const out = new Set<string>();
  for (const [nick, city] of Object.entries(TEAM_CITY)) if (new RegExp(`\\b${nick}\\b`).test(l)) { out.add(nick); out.add(city); }
  for (const t of ownTeamsIn(text)) { out.add(t.nick.toLowerCase()); out.add(t.names[0]); } // every league's teams (city-aware for "Heat", "Wild"...)
  return [...out];
}

/** teamWords + team cities written out ("Los Angeles C beats our team (Los Angeles C vs San Antonio)" = Spurs). */
export function teamKeys(text: string): string[] {
  const out = new Set(teamWords(text)); const l = text.toLowerCase();
  for (const city of new Set(Object.values(TEAM_CITY))) if (new RegExp(`\\b${city}\\b(?! a&m| tech)`).test(l)) out.add(city);
  return [...out];
}

const MATCHUP = /([A-Z][A-Za-z.&']*(?: [A-Z][A-Za-z.&']*)*) (?:vs\.?|v\.?|at|@) ([A-Z][A-Za-z.&']*(?: [A-Z][A-Za-z.&']*)*)/;
/** Same exposure, with games compared by matchup when both name one ("Southern Utah vs Texas" is not "Arkansas vs Texas"),
 *  else by team/city keys ("Los Angeles C beats our team (... San Antonio)" = "Spurs lose"). */
export function sameExposureX(a: Risk, b: Risk): boolean {
  // next week's game / this week's pump price is not the season / the rate path to year end: different exposures
  const ha = riskHorizon(a), hb = riskHorizon(b);
  if (ha !== hb && (ha === "season" || hb === "season" || (ha === "month") !== (hb === "month"))) return false;
  if (a.peril === "game" && b.peril === "game") {
    const pair = (r: Risk) => { const m = `${r.trigger} ${r.title}`.match(MATCHUP); return m ? [m[1], m[2]].map((x) => x.toLowerCase().trim()).sort().join("|") : null; };
    const pa = pair(a), pb = pair(b);
    if (pa && pb) return pa === pb;
    const la = leagueIn(`${a.title} ${a.trigger}`), lb = leagueIn(`${b.title} ${b.trigger}`);
    if (la && lb && la !== lb) return false; // Texans (NFL) and Rockets (NBA) share a city, not an exposure
    const ta = ownTeamsIn(`${a.title} ${a.trigger}`), tb = ownTeamsIn(`${b.title} ${b.trigger}`);
    const oa = ta.map((t) => t.nick), ob = tb.map((t) => t.nick);
    if (oa.length && ob.length && !oa.some((t) => ob.includes(t))) return false;
    // school / city name on one side, nickname on the other ("Michigan misses the CFP" = "Wolverines miss the CFP")
    const named = (ts: typeof ta, text: string) => ts.some((t) => t.names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)));
    if ((!oa.length && named(tb, `${a.title} ${a.trigger}`)) || (!ob.length && named(ta, `${b.title} ${b.trigger}`))) return true;
  }
  return sameExposure(a, b, teamKeys);
}

const words = (t: string) => new Set((t.toLowerCase().match(/[a-z0-9.]{3,}/g) ?? []).filter((w) => !["the", "and", "for", "our", "with", "than", "from"].includes(w)));
/**
 * One risk per exposure (QA cycle 1: "Celtics miss the playoffs" twice, two Thanksgiving-rain risks, two December-snow NO
 * risks). Duplicates = same peril + horizon + exposure, and the same window or mostly the same trigger words; a season
 * risk about a different stage ("miss the playoffs" vs "deep run ends") is a different exposure. The first one wins.
 */
export function dedupeRisks<R extends Risk>(rs: R[], now = new Date()): R[] {
  const out: R[] = [];
  for (const r of rs) {
    const dup = out.find((o) => {
      if (o.peril !== r.peril || riskHorizon(o, now) !== riskHorizon(r, now) || !sameExposureX(o, r)) return false;
      if (r.peril === "game") return (stageWanted(`${o.title} ${o.trigger}`)[0] ?? "") === (stageWanted(`${r.title} ${r.trigger}`)[0] ?? "") && riskHorizon(r, now) !== "event";
      // same month / season window = same exposure; event windows ("next 7 days") are too generic to tell days apart
      if (riskHorizon(r, now) !== "event" && (o.window ?? "").trim().toLowerCase() === (r.window ?? "").trim().toLowerCase()) return true;
      // distinctive words only: the place, the month and the peril itself say nothing about WHICH day / strike
      const common = new Set([...words(`${r.location ?? ""} ${o.location ?? ""} ${r.peril}`), "rain", "snow", "cold", "heat", "day", "days", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]);
      const strip = (x: Set<string>) => new Set([...x].filter((w) => !common.has(w)));
      const a = strip(words(`${o.title} ${o.trigger}`)), b = strip(words(`${r.title} ${r.trigger}`));
      const inter = [...a].filter((w) => b.has(w)).length;
      return inter / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
    });
    if (dup) { console.warn(`[advise] risk "${r.title}" dropped: same exposure as "${dup.title}"`); continue; }
    out.push(r);
  }
  return out;
}

/**
 * Two risks whose recommended picks are the same market (same contract, or the same event on another venue) are one
 * exposure (QA cycle 3: "Rain on Thanksgiving" + a proxy "Rain empties the patio" on the same contract; "Chiefs host a
 * playoff game" + "Chiefs miss the playoffs" both landing on the playoff qualifier). The survivor is the risk whose wording
 * names the stage the contract pays on (season futures), else the direct one, else the bigger loss. Mutates `choices`;
 * returns the ids merged away.
 */
export function mergeSameMarketRisks(risks: Risk[], choices: Map<string, TieredLeg[]>, contracts: Map<string, MarketContract>): Set<string> {
  const gone = new Set<string>();
  const rec = (id: string) => { const l = choices.get(id)?.[0]; const c = l && contracts.get(l.contractId); return l && c ? { l, c } : null; };
  const fits = (r: Risk, c: MarketContract) => { const k = contractMeta(c.id)?.futureKind; return k && stageWanted(`${r.title} ${r.trigger}`)[0] === k ? 0 : 1; };
  for (let i = 0; i < risks.length; i++) {
    const a = risks[i], ra = rec(a.id);
    if (!ra || gone.has(a.id)) continue;
    for (let j = i + 1; j < risks.length; j++) {
      const b = risks[j], rb = rec(b.id);
      if (!rb || gone.has(b.id) || a.peril !== b.peril) continue;
      // ... or another strike of the same ladder (QA cycle 4: "Wet November" on ">5 in" and a proxy "very wet month" on ">6 in")
      const ladder = a.peril !== "game" && ra.c.venue === rb.c.venue && !!ra.c.eventTicker && ra.c.eventTicker === rb.c.eventTicker && ra.l.side === rb.l.side;
      const same = ra.c.id === rb.c.id || ladder || (ra.c.venue !== rb.c.venue && ra.l.side === rb.l.side
        ? findEquivalent(ra.c, ra.l.side, [rb.c])?.match === "same" && findEquivalent(ra.c, ra.l.side, [rb.c])?.side === rb.l.side : false);
      if (!same) continue;
      const score = (r: Risk) => [fits(r, ra.c), r.kind === "proxy" ? 1 : 0, -r.lossUsd];
      const [sa, sb] = [score(a), score(b)];
      const keepA = sa[0] !== sb[0] ? sa[0] < sb[0] : sa[1] !== sb[1] ? sa[1] < sb[1] : sa[2] <= sb[2];
      const [keep, drop] = keepA ? [a, b] : [b, a];
      console.warn(`[advise] risk "${drop.title}" merged into "${keep.title}": same market`);
      gone.add(drop.id); choices.delete(drop.id);
      if (!keepA) break; // a is gone
    }
  }
  return gone;
}

/**
 * The default plan's choice for one risk, from its insurance-priced choices: the first free one (not a thin book), then
 *  - a depth-capped pick yields to another rung covering 2x+ the contracts at a similar price (QA cycle 3: DEC-8 NO capped at
 *    52 contracts on a $15,000 loss; the 12-inch Miami strike capped at 108 while 13 inches paid $286);
 *  - a pick above COIN_FLIP_ASK yields to a funded cheap tail at <= 25c (QA cycle 3: a 52c monthly-rain line crowded out
 *    8-10c tails and paid less than the Essentials package).
 */
export function pickPlanChoice(priced: QuoteLine[], free: (x: QuoteLine) => boolean, thin: (x: QuoteLine) => boolean, want: number): QuoteLine | undefined {
  let c = priced.find((x) => free(x) && !thin(x)) ?? priced.find(free);
  if (c && c.maxCoverable !== undefined) {
    const c0 = c;
    const deeper = priced.filter((x) => x !== c0 && free(x) && x.contracts >= 2 * c0.contracts && x.impliedProb <= Math.max(COIN_FLIP_ASK, c0.impliedProb + 0.05))
      .sort((a, b) => b.contracts - a.contracts)[0];
    if (deeper) c = deeper;
  }
  if (c && c.impliedProb > COIN_FLIP_ASK) {
    const c0 = c;
    const tail = priced.find((x) => x !== c0 && free(x) && x.tier === TIER_LABEL["cheap-tail"] && x.impliedProb <= 0.25 && x.contracts >= Math.min(want, MIN_PAYOUT_USD));
    if (tail) c = tail;
  }
  return c;
}

/** Words that show the owner named a weather peril themselves. */
const PERIL_WORDS: Partial<Record<string, RegExp>> = {
  cold: /\bcold|freez|frigid|chill|frost|winter|below \d+\s*°?\s*f?\b/i, heat: /\bheat|\bhot\b|scorch|summer|above 9\d|1[01]\d\s*°?f/i,
  rain: /\brain|wet\b|storm|downpour|shower/i, snow: /\bsnow|blizzard|lake[- ]effect|ice storm|\bstorms?\b/i,
};

/** Macro exposures that move together: diesel, pump gas and Brent are one fuel bill; the Fed path and CPI one rate path
 *  (QA cycle 2: three fuel hedges took 95% of a boat-rental budget; Fed twice for a roofer). */
const FAMILY: Partial<Record<string, string>> = { gas: "fuel", oil: "fuel", fed: "rates", cpi: "rates" };
export function sameFamily(a: Risk, b: Risk): boolean {
  const fa = FAMILY[a.peril], fb = FAMILY[b.peril];
  return !!fa && fa === fb;
}

const STOP = new Set(["lose", "loses", "lost", "game", "home", "night", "their", "next", "with", "against", "this", "week", "match"]);

/** basisRisk is for the owner: venue talk ("Gemini is our primary venue", "a backup") is dropped (QA cycle 2). */
export function ownerBasis(text: string, c?: Pick<MarketContract, "peril">): string {
  const kept = text.trim().split(/(?<=[.!?])\s+/).filter((x) => x && !/\b(gemini|kalshi|polymarket|venue|backup)\b/i.test(x));
  if (kept.length) return kept.join(" ");
  return c?.peril === "game" ? "Pays on the official result, not on your crowd: a bad night can come without it, and it can pay on a good night."
    : "Pays on the market's official data, which may not match your exact loss.";
}

/** HARD RULE: picks must reference a candidate id; unknown/closed/duplicate ids are dropped. */
export function enforceCandidates(riskId: string, picks: z.infer<typeof matchSchema>["picks"], candidates: MarketContract[]): { legs: HedgeLeg[]; dropped: string[] } {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const legs: HedgeLeg[] = []; const dropped: string[] = []; const seen = new Set<string>();
  for (const p of picks) {
    const raw = p.contractId.trim();
    // models sometimes drop the "venue:" prefix; resolve a bare symbol only if exactly one candidate has it
    const bare = byId.has(raw) ? [] : candidates.filter((x) => x.id.slice(x.id.indexOf(":") + 1) === raw);
    const id = byId.has(raw) ? raw : bare.length === 1 ? bare[0].id : raw;
    const c = byId.get(id);
    if (!c || c.status !== "open" || seen.has(id)) { dropped.push(raw); continue; }
    seen.add(id);
    legs.push({ riskId, contractId: id, side: p.side, rationale: p.rationale.trim(), basisRisk: ownerBasis(p.basisRisk, c) });
  }
  return { legs, dropped };
}

const DOWN_RE = /\b(below|under|drops?|falls?|falling|crash(es)?|lower|declines?|dips?|plunges?|slides?|slumps?|sell-?offs?|bear market|short of|stays? (below|under))\b|\bfail(s|ed|ing)? to (reach|hit|top|exceed|clear|get to)\b|\bnever (reach|hit|top)(es|s)?\b|\b(does ?n[o']?t|won'?t|doesn'?t) (reach|hit|top|exceed)\b|<|≤/i;
const UP_RE = /\b(above|over|exceeds?|tops?|rises?|rising|spikes?|jumps?|climbs?|higher|surges?|soars?|at least|or more|reach(es)?|hits?)\b|>|≥/i;
/**
 * HARD RULE (eval iter 2): the side must PAY when the risk's bad thing happens. For threshold contracts on a price or
 * temperature ("$73 or above", "69°F or below") the right side follows from the trigger's direction; a wrong side is
 * flipped when the other side has an insurance price, else the leg is dropped. NO on a range bucket ("74-75°F") pays
 * mostly in harmless outcomes, so it is dropped. Games, Fed, rain and categorical labels are left to the matcher.
 */
export function guardSide<L extends HedgeLeg>(risk: Risk, leg: L, c: MarketContract | undefined, ownText = ""): L | null {
  const fm = c ? contractMeta(c.id) : undefined;
  if (c && fm?.futureKind) {
    // own-team season future: NO pays on a bad season (miss / early exit / few wins); YES only for a win-funded promo
    // the risk's own team; else the owner's ("home team misses the playoffs" names no team, the profile does)
    const named = ownTeamsIn(`${risk.title} ${risk.trigger}`);
    const side = futuresSide(risk, fm, named.length ? named : ownTeamsIn(ownText));
    if (!side || side === leg.side) return leg;
    const ask = side === "yes" ? c.yesAsk : c.noAsk;
    if (ask == null || ask > 0.85) return null;
    return { ...leg, side, rationale: `${leg.rationale} (Side corrected to ${side.toUpperCase()}: that is the side that pays when ${c.label} ${side === "no" ? "falls short" : "gets there"}.)` };
  }
  if (!c || ["game", "fed", "rain"].includes(risk.peril) || ["game", "fed", "rain"].includes(c.peril)) return leg;
  const b = labelBound(c.label);
  // the trigger's direction; a trigger with no direction word at all leaves the matcher's side alone (QA cycle 1: "S&P fails
  // to reach 8,000" read as "up" and flipped a correct NO into a YES that pays on a rally)
  let down = DOWN_RE.test(risk.trigger), up = UP_RE.test(risk.trigger.replace(DOWN_RE, " "));
  // a slowdown / recession is not hot inflation (QA cycle 5: "slowdown cuts wholesale orders" bought YES CPI above 3.7%)
  if (/\b(slowdown|recession|downturn|layoffs?|weak(er)? (demand|economy))\b/i.test(`${risk.title} ${risk.trigger}`) && /\bcpi\b|inflation/i.test(`${c.eventTitle} ${c.id}`)
    && (labelBound(c.label).dir === "up") === (leg.side === "yes")) return null;
  // a compound trigger ("at least 3 inches of snow ... or several days below 30F"): the direction comes from the clause that
  // names the contract's own measure; still mixed = the matcher's side stands (QA cycle 5: snow cover flipped to NO "Above 4 in")
  if (down && up && risk.peril !== "heat" && risk.peril !== "cold") {
    const measure = MEASURE_WORDS[c.peril] ?? MEASURE_WORDS[risk.peril];
    const own = measure ? risk.trigger.split(/\s*(?:\bor\b|\band\b|[;,])\s*/i).filter((x) => measure.test(x)).join(" ") : "";
    const d1 = DOWN_RE.test(own), u1 = UP_RE.test(own.replace(DOWN_RE, " "));
    if (!own || d1 === u1) return leg;
    down = d1; up = u1;
  }
  // an open-topped bucket: the market prices reaching its lower edge as unlikely and its top is 2x+ that edge, so the tail
  // above it is remote (QA cycle 5: "10 or more snow days" vs YES "Indianapolis · 10-33 days" at 23c was "no market pays")
  if (b.dir === "range" && leg.side === "yes" && openTopBucket(risk, c)) return leg;
  // a bounded bucket ("7-19 days", "6-25 days") misses the extreme beyond its top: never cover for "too much" / a heavy tail,
  // even when the trigger has no direction word (QA cycle 4: "high bucket (e.g. 20+ days)" bought YES "7-19 days")
  if (b.dir === "range" && leg.side === "yes" && !down && (up || /\+|\bheavy\b|\bhigh\b|\bsnowy\b|\bwet\b|\bmore\b/i.test(`${risk.title} ${risk.trigger}`))
    && risk.peril !== "heat" && risk.peril !== "cold") return null;
  if (risk.peril !== "heat" && risk.peril !== "cold" && !down && !up) return leg;
  // heat / cold follow the peril unless the trigger says the other way outright (QA cycle 2: a "warm night, low stays ABOVE
  // 32°F" risk filed as peril cold was flipped to YES on "31°F or below", which pays when the HVAC business does well)
  const tt = `${risk.title} ${risk.trigger}`;
  const warmBad = risk.peril === "cold" && up && !down && /\b(stays?|remains?|holds?|keeps?) (above|over)\b|\b(warm|mild)\b/i.test(tt);
  const coolBad = risk.peril === "heat" && down && !up && /\b(stays?|remains?|holds?|keeps?) (below|under)\b|\b(cool|mild)\b/i.test(tt);
  const wantUp = risk.peril === "heat" ? !coolBad : risk.peril === "cold" ? warmBad : !down;
  if (b.dir === "range") {
    if (leg.side === "no") return null;
    // YES on a bucket only if the whole bucket is on the bad side of the trigger ("45-46°F" does not pay for "low <= 44°F")
    const [lo, hi] = (c.label.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const t = Number((risk.trigger.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/) ?? [])[0]);
    // no threshold to check against: a bounded bucket misses the extreme case beyond it (QA cycle 3: YES "7-19 days" sold as
    // heavy-snow cover pays nothing in a 20+ day winter); only a bucket starting at zero is safe for a "too little" risk
    if (!Number.isFinite(t) && hi !== undefined) return !wantUp && lo <= 0 ? leg : null;
    if (!Number.isFinite(t) || hi === undefined) return leg;
    // "too much": a bucket with a top never covers the tail above it (QA cycle 4: YES "6-25 days" for "6 or more snow days")
    if (wantUp && risk.peril !== "heat") return null;
    return (wantUp ? lo >= t - 1 : hi <= t + 1) ? leg : null;
  }
  if (b.dir !== "up" && b.dir !== "down") return leg;
  // the owner's own temperature threshold ("under 45°F thins the crowd"): a strike 10+ degrees milder pays on days that
  // hurt nobody (QA cycle 2: "high 67°F or below" sold as cold cover in New Orleans)
  if ((risk.peril === "heat" || risk.peril === "cold") && /°F|degrees/i.test(c.label) && b.v !== null) {
    const T = ownTempThreshold(ownText, wantUp) ?? ownTempThreshold(risk.trigger, wantUp);
    if (T !== null && (wantUp ? b.v < T - 10 : b.v > T + 10)) return null;
  }
  const side: "yes" | "no" = (b.dir === "up") === wantUp ? "yes" : "no";
  if (side === leg.side) return leg;
  const ask = side === "yes" ? c.yesAsk : c.noAsk;
  if (ask == null || ask > 0.85) return null;
  return { ...leg, side, rationale: `${leg.rationale} (Side corrected to ${side.toUpperCase()}: that is the side that pays when ${wantUp ? "it goes above" : "it stays below"} "${c.label}".)` };
}

const MEASURE_WORDS: Partial<Record<string, RegExp>> = { snow: /snow|inch/i, rain: /rain|inch|precip/i, gas: /gas|diesel|fuel|\$/i, oil: /oil|crude|brent|wti|\$/i };
/** "N or more" / "at least N" in a "too much" trigger; null when the trigger has no such threshold. */
export function upThreshold(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(?:\+|or more|or above|or higher)|\b(?:at least|more than|above|over)\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1] ?? m[2]) : null;
}
/** YES on a bucket "lo-hi" for a "lo or more" risk when the market prices reaching lo as unlikely (<= 30c) and hi >= 2 lo. */
export function openTopBucket(risk: Risk, c: MarketContract): boolean {
  const t = upThreshold(risk.trigger);
  const [lo, hi] = (c.label.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  return t !== null && hi !== undefined && lo > 0 && lo >= t - 1 && lo <= t + 1 && hi >= 2 * lo && c.yesAsk != null && c.yesAsk <= 0.3;
}

/** A "more snow" season risk whose only snow-day market for the city is a bucket from zero to a few days ("0-2 days"). */
export function snowlessCity(risk: Risk, cands: MarketContract[]): boolean {
  if (risk.peril !== "snow" || /\b(snowless|little|less|fewer|no snow|dry|mild|warm)\b/i.test(`${risk.title} ${risk.trigger}`)) return false;
  const days = cands.filter((c) => /snow days/i.test(c.eventTitle));
  return days.length > 0 && days.length === cands.length && days.every((c) => { const m = c.label.match(/(?:^|\D)0\s*[-–]\s*(\d+)/); return !!m && Number(m[1]) <= 6; });
}

/** Proxy / macro lines priced above this are near coin flips: offered as options, kept out of the default plan. */
export const COIN_FLIP_ASK = 0.4;
const COIN_FLIP_PERILS = new Set(["cpi", "fed", "gas", "oil", "natgas", "metals", "crypto"]);
/** "below 45°F" / "under 40 degrees" (cold) or "over 100°F" (heat) in free text; null when none. */
export function ownTempThreshold(text: string, up: boolean): number | null {
  const re = up ? /\b(?:above|over|hits?|tops?|more than|>=?|≥)\s*(\d{2,3})\s*(?:°|degrees|deg|f\b)/gi : /\b(?:below|under|less than|drops? (?:below|under|to)|<=?|≤)\s*(-?\d{1,2})\s*(?:°|degrees|deg|f\b)/gi;
  const m = [...text.matchAll(re)].map((x) => Number(x[1])).filter(Number.isFinite);
  return m.length ? (up ? Math.min(...m) : Math.max(...m)) : null;
}

/**
 * The default plan leaves out a line the owner would mostly prepay: >= PREPAY_ASK at the top of the book or at the walked
 * price (QA cycle 3), and season / month cover above 50c, more likely than not (QA cycle 4: NO "host a playoff game" at 57c
 * bought $355 of payout for $202 while a 48c line was dropped as a coin flip); a game loss above 50c is expected, not a tail
 * (QA cycle 4 confirm run: NO Kentucky at 59c took 94% of a bar's budget).
 */
export function prepaidLine(r: { horizon?: Risk["horizon"]; peril?: Risk["peril"] } | undefined, x: Pick<QuoteLine, "impliedProb" | "pricePerContract">): boolean {
  return x.impliedProb >= PREPAY_ASK - 1e-9 || (x.impliedProb >= 0.5 && x.pricePerContract >= PREPAY_ASK - 1e-9)
    || ((r?.peril === "game" || (r?.horizon !== undefined && r.horizon !== "event")) && x.impliedProb > 0.5 + 1e-9);
}

/** A "cheap tail" choice costs at most this per $1; a pricier further strike is labelled "Further strike". */
export const CHEAP_TAIL_MAX = 0.25;
/** Above this ask the owner mostly prepays the payout: another choice at an insurance price is recommended instead. */
export const PREPAY_ASK = 0.6;
/** Above this ask (and no cheaper choice) the risk is "already likely" and left uncovered rather than prepaid. */
export const ALREADY_LIKELY_ASK = 0.75;
const askFor = (l: HedgeLeg, cands: MarketContract[]) => { const c = cands.find((x) => x.id === l.contractId); return c ? (l.side === "yes" ? c.yesAsk : c.noAsk) : null; };
/**
 * Insurance pricing (QA cycle 1: 84% of a budget on YES 0.84, NO 0.84 on a title "as insurance"): when the recommended
 * choice costs more than PREPAY_ASK and another choice is an insurance price (3-60c), that one becomes recommended;
 * choices above ALREADY_LIKELY_ASK are dropped. [] = nothing worth buying.
 */
export function insuranceFirst<L extends HedgeLeg & { tier: string }>(legs: L[], cands: MarketContract[]): L[] {
  const kept = legs.filter((l) => { const a = askFor(l, cands); return a == null || a <= ALREADY_LIKELY_ASK; });
  if (!kept.length) return [];
  const a0 = askFor(kept[0], cands);
  // at or above PREPAY_ASK (QA cycle 3: a 0.60 top ask slipped past a strict ">" and took 99.9% of a budget)
  if (a0 != null && a0 >= PREPAY_ASK - 1e-9) {
    const j = kept.findIndex((l, i) => { const a = askFor(l, cands); return i > 0 && l.tier !== "other-date" && a != null && a >= 0.03 && a <= PREPAY_ASK; });
    if (j > 0) { const [best] = kept.splice(j, 1); kept.unshift(best); }
    // no choice at an insurance price: a 60-75c sole pick mostly prepays the payout (QA cycle 2: NO 62c on one college
    // game took 86% of a budget; Sabres NO 72c) -> "already likely", not a line
    else return [];
  }
  return kept.map((l, i) => ({ ...l, tier: i === 0 ? "recommended" : l.tier === "recommended" ? "broad" : l.tier }));
}

/**
 * Strike-ladder sanity (QA cycle 2: YES ">6 in" bought at 41c while ">4 in" asked 30c; ">6 in" pays only when ">4 in"
 * also pays): a sibling strike on the same event that pays in every case the pick does, and more, at the same or a lower
 * ask dominates the pick. The cheapest such sibling replaces it.
 */
export function undominated<L extends HedgeLeg>(leg: L, cands: MarketContract[]): L {
  const c0 = cands.find((c) => c.id === leg.contractId);
  if (!c0) return leg;
  const b0 = labelBound(c0.label), a0 = leg.side === "yes" ? c0.yesAsk : c0.noAsk;
  if ((b0.dir !== "up" && b0.dir !== "down") || b0.v === null || a0 == null) return leg;
  // the paid region grows with the strike when (YES on "X or below") or (NO on "X or above"), else it shrinks
  const growsUp = (b0.dir === "down") === (leg.side === "yes");
  const better = cands.filter((c) => {
    if (c.id === c0.id || c.eventTicker !== c0.eventTicker || c.status !== "open") return false;
    const b = labelBound(c.label), a = leg.side === "yes" ? c.yesAsk : c.noAsk;
    // within 2c counts as "no more money" (QA cycle 4: "Above 8 in" at 28c kept over "Above 4 in" at 30c)
    if (b.dir !== b0.dir || b.v === null || a == null || a < 0.03 || a > a0 + 0.02 + 1e-9) return false;
    return growsUp ? b.v > b0.v! : b.v < b0.v!;
  }).sort((x, y) => ((leg.side === "yes" ? x.yesAsk : x.noAsk)! - (leg.side === "yes" ? y.yesAsk : y.noAsk)!)
    || (growsUp ? labelBound(y.label).v! - labelBound(x.label).v! : labelBound(x.label).v! - labelBound(y.label).v!));
  const c = better[0];
  if (!c) return leg;
  const a = leg.side === "yes" ? c.yesAsk! : c.noAsk!;
  return { ...leg, contractId: c.id, rationale: `${leg.rationale} (Switched to "${c.label}" at ${Math.round(a * 100)}¢: it pays in every case "${c0.label}" pays, and more, for ${a <= a0 + 1e-9 ? "no more money" : "about the same money"}.)` };
}

/** Deterministic pick used only if the matcher LLM is unreachable. Conservative: may return nothing. */
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Weekdays a daily/weekend market observes, from its title ("... this weekend", "... on Nov 19, 2026?"); null = unknown/longer. */
export function marketDays(c: MarketContract): string[] | null {
  if (/weekend/i.test(c.eventTitle)) return ["Sat", "Sun"];
  if (/thanksgiving/i.test(c.eventTitle)) return ["Thu"];
  const m = c.eventTitle.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (!m) return null;
  const y = Number((c.eventTitle.match(/\b20\d\d\b/) ?? [])[0]) || new Date(c.expiry).getUTCFullYear();
  return [DOW[new Date(Date.UTC(y, MON.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), 12)).getUTCDay()]];
}

export function heuristicPick(risk: Risk, candidates: MarketContract[], busyDays: string[] = []): HedgeLeg | null {
  const open = candidates.filter((c) => c.status === "open");
  // month / season price or total (a soaked month, fuel into year end): the strike nearest a 25c insurance price, not the cheapest tail
  if (!["game", "fed"].includes(risk.peril) && riskHorizon(risk) !== "event") {
    const strikes = open.filter((c) => { const b = labelBound(c.label); return b.dir === "up" || b.dir === "down"; }); // totals / levels, not "will it rain Saturday"
    const d = directionalPick(risk, strikes.length ? strikes : open);
    if (d) return d;
  }
  const ok = (a: number | null) => a != null && a >= 0.03 && a <= 0.85;
  const note = "Heuristic pick (AI matcher unavailable); review before buying.";
  if (risk.peril === "game" && riskHorizon(risk) !== "event") {
    // season risk: an own-team future (candidates are ranked by stage + horizon fit), protective side at an insurance price
    const owns = ownTeamsIn(`${risk.title} ${risk.trigger}`);
    const futs = open.map((c) => ({ c, side: futuresSide(risk, contractMeta(c.id), owns) })).filter((x): x is { c: MarketContract; side: "yes" | "no" } => !!x.side)
      .map((x) => ({ ...x, ask: x.side === "yes" ? x.c.yesAsk : x.c.noAsk, depth: x.side === "yes" ? x.c.depthYes : x.c.depthNo }))
      .filter((x) => ok(x.ask) && (x.depth === undefined || x.depth >= 50)); // a 4-contract book is not a season hedge
    // the stage the risk names (deep run -> round/conference, miss -> playoffs/wins) at a real insurance price first
    // (nearest 35c: a 0.70 "misses" NO mostly prepays the payout), then up to 0.70, then any stage, then anything
    const stages = stageWanted(`${risk.title} ${risk.trigger}`);
    const staged = stages.length ? futs.filter((x) => stages.includes(contractMeta(x.c.id)?.futureKind as never)) : futs;
    const near = (xs: typeof futs) => [...xs].sort((a, b) => Math.abs(a.ask! - 0.35) - Math.abs(b.ask! - 0.35))[0];
    const f = near(staged.filter((x) => x.ask! >= 0.1 && x.ask! <= 0.6)) ?? staged.find((x) => x.ask! >= 0.08 && x.ask! <= 0.7)
      ?? near(futs.filter((x) => x.ask! >= 0.1 && x.ask! <= 0.6)) ?? futs[0];
    if (f) {
      const stage = contractMeta(f.c.id)?.futureKind;
      return { riskId: risk.id, contractId: f.c.id, side: f.side,
        rationale: `Season-long cover: pays if "${f.c.label}" ${f.side === "no" ? "does NOT" : "does"} come true on "${f.c.eventTitle}"${stage ? ` (${stage})` : ""}.`,
        basisRisk: `Pays on the team's result, not your nights: a run can end on a road game, and a hot regular season still fills the bar. ${note}` };
    }
    return null; // one game is not a season: leave it uncovered rather than hedge a playoff run with next week's game
  }
  const beat = risk.peril === "game" ? risk.trigger.match(/^(.+?)\s+beats our team\b/i) : null;
  if (beat) {
    const opp = open.find((c) => c.label.trim().toLowerCase() === beat[1].trim().toLowerCase() && ok(c.yesAsk));
    if (opp) return { riskId: risk.id, contractId: opp.id, side: "yes", rationale: `Pays if ${opp.label} wins (${opp.eventTitle}).`, basisRisk: `A loss does not always empty the room. ${note}` };
  }
  if (risk.peril === "game") {
    const words = [...(`${risk.title} ${risk.trigger}`.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []), ...teamWords(`${risk.title} ${risk.trigger}`)];
    // "X wins / beats Y" hurts the business (rival crowd): YES on X; otherwise "our team loses": NO on our team
    const text = `${risk.title} ${risk.trigger}`;
    const win = /\b(wins?|beats?|upsets?)\b/i.test(text) && !/\b(lose|loses|losing|loss|lost)\b/i.test(text);
    // an exact label match first ("Texas" is the Longhorns; "Texas A&M" merely contains the word)
    const exact = (c: MarketContract) => (words.includes(c.label.trim().toLowerCase()) ? 1 : 0);
    const own = [...open].sort((a, b) => exact(b) - exact(a)).find((c) => words.some((w) => c.label.toLowerCase().includes(w)) && ok(win ? c.yesAsk : c.noAsk));
    if (!own) return null;
    return win
      ? { riskId: risk.id, contractId: own.id, side: "yes", rationale: `Pays if ${own.label} wins.`, basisRisk: `A result does not always move your crowd. ${note}` }
      : { riskId: risk.id, contractId: own.id, side: "no", rationale: `Pays if ${own.label} does not win.`, basisRisk: `A loss does not always mean an empty venue. ${note}` };
  }
  if (risk.peril === "fed") {
    // categorical Fed labels ("Hike 25bps", "Cut >25bps", "Fed maintains rate"): ">" in "Cut >25bps" is not "above"
    const text = `${risk.title} ${risk.trigger}`;
    const hike = /\bhike|raise/i.test(text) && !/no (rate )?hike/i.test(text);
    const isHold = (l: string) => /maintain|hold|no change|unchanged|pause/i.test(l), isCut = (l: string) => /\bcut/i.test(l), isHike = (l: string) => /hike|raise|increase/i.test(l);
    const yesOn = (f: (l: string) => boolean) => { const c = open.find((x) => f(x.label) && ok(x.yesAsk)); return c ? { c, side: "yes" as const } : null; };
    const noOnCut = () => { const c = open.find((x) => isCut(x.label) && ok(x.noAsk)); return c ? { c, side: "no" as const } : null; };
    const pick = hike ? yesOn(isHike) : yesOn(isHold) ?? noOnCut();
    if (pick) return { riskId: risk.id, contractId: pick.c.id, side: pick.side, rationale: `Pays if the Fed ${pick.side === "yes" ? `outcome is "${pick.c.label}"` : `does not "${pick.c.label}"`}.`, basisRisk: `Your loan or deal flow follows market rates, which move before and after the Fed. ${note}` };
    if (open.some((c) => isHold(c.label) || isCut(c.label) || isHike(c.label))) return null;
  }
  if (risk.peril === "rain" && riskHorizon(risk) === "event") {
    // "Will it rain in <city> on <day> / this weekend" (label = the city) beats monthly rainfall totals; candidates are already ranked by date fit
    const onBusyDay = (c: MarketContract) => { const d = marketDays(c); return !busyDays.length || !d || d.some((x) => busyDays.includes(x)); };
    const evs = open.filter((c) => !/\d/.test(c.label) && ok(c.yesAsk) && onBusyDay(c));
    const ev = evs.find((c) => marketDays(c)) ?? evs[0]; // a market on a known busy day first
    if (ev) return { riskId: risk.id, contractId: ev.id, side: "yes", rationale: `Pays if "${ev.eventTitle}" resolves YES for ${ev.label}.`, basisRisk: `Rain at the official station may miss your site or your busiest hours. ${note}` };
  }
  const dirRe = risk.peril === "cold" ? /below|under|or less|lower/i : /above|over|or more|higher|at least|≥|>/i;
  const pool = open.filter((c) => dirRe.test(c.label) && ok(c.yesAsk)).sort((a, b) => (a.yesAsk ?? 1) - (b.yesAsk ?? 1));
  const c = pool[0];
  return c ? { riskId: risk.id, contractId: c.id, side: "yes", rationale: `Pays if "${c.eventTitle}" resolves ${c.label}.`, basisRisk: `Threshold and date may not match the trigger exactly. ${note}` } : null;
}

/** The business runs its own vehicles / engines (a hotel whose guests drive in does not). */
const OWN_FLEET = /\bdeliver|\bfleet\b|\bvans?\b|\btrucks?\b|\bsemis?\b|courier|\bhaul|\broutes?\b|\btractors?\b|generator|\bboats?\b|jet ?skis?|\bdrivers\b|\bmowers?\b|\bequipment\b|\bplows?\b/i;

/** The owner's own fuel (QA cycle 2: gasoline trucks / jet skis hedged with diesel): the other fuel's contracts are dropped
 *  when the owner names only one of them (crude, a driver of both, stays). Not strict: unchanged when nothing else is left. */
export function ownFuel(cands: MarketContract[], description: string, strict = false): MarketContract[] {
  const d = /diesel/i.test(description), g = /gasoline|\bgas\b|\bpetrol\b|pump prices?|jet ?skis?/i.test(description);
  const other = d && !g ? /\b(gas(oline)?|aaa)\b/i : g && !d ? /diesel/i : null;
  const keep = other ? cands.filter((c) => !other.test(`${c.eventTitle} ${c.id}`) || (d && /diesel/i.test(c.eventTitle))) : cands;
  return keep.length || strict ? keep : cands;
}

/** Macro perils need a hook in the owner's own words (eval iter 4: the risk map kept adding "US gas prices" for a
 *  mortgage broker, a coffee cart and an online merch shop because a gas market exists). */
const GROUNDING: Partial<Record<string, RegExp>> = {
  // word-bounded: "contractor" is not a tractor (QA cycle 3: every contractor got a diesel hedge)
  gas: /fuel|\bgas\b|gasoline|diesel|petrol|\bvans?\b|\btrucks?\b|\bcars?\b|vehicle|\bdriv(e|es|er|ers|ing|en)\b|\bdeliver|\bmiles?\b|\bfleet|generator|equipment|\bhaul|\btractors?\b|commut|courier|\broutes?\b|\bboats?\b|jet ?skis?/i,
  fed: /loan|credit line|line of credit|credit card|mortgage|debt|financ|refi|interest|variable[- ]rate/i, // not bare "rates": "nightly rates" are prices
  // metal prices only for a business that buys metal (QA cycle 3: copper hedges for asphalt roofers and a parcel fleet)
  metals: /metal|copper|silver|\bgold\b|jewel|\bwir(e|es|ing)\b|flashing|gutters?|\bpipes?\b|plumb|electric(al|ian)|line[- ]sets?|scrap|\bsteel\b|alumin|bullion|smith/i,
  cpi: /inflation|food costs?|ingredient|milk|bean|menu|wholesale|supplier|input costs?|cost of goods|\bcpi\b|mortgage|chicken|beef|eggs?\b|produce/i,
};
GROUNDING.oil = GROUNDING.gas;
export function groundedRisk(peril: string, profile: BusinessProfile): boolean {
  const re = GROUNDING[peril];
  return !re || re.test(profile.description);
}

/** An event risk dated only to days before today (QA cycle 2: "Cold Thursday Nov 19 night" listed on Nov 20). */
export function pastDated(r: { window: string; trigger: string; title: string; horizon?: string }, today: string, lateEvening = false): boolean {
  if (r.horizon && r.horizon !== "event") return false;
  const y = Number(today.slice(0, 4));
  const days = [...`${r.window} ${r.title} ${r.trigger}`.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi)]
    .map((m) => { const mi = MON.indexOf(m[1].toLowerCase().slice(0, 3)); let yy = y; if (mi < Number(today.slice(5, 7)) - 6) yy += 1; return `${yy}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; });
  // after ~5 pm the day is mostly over too (today's daily markets are already decided)
  return days.length > 0 && days.every((d) => d < today || (lateEvening && d === today));
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HOLIDAY = /thanksgiving|christmas|new year'?s day|independence day|labor day|memorial day/i;
/** A weekday-only business (crews, offices) does not work on public holidays: holiday weather costs it nothing. */
export const weekdayOnly = (busyDays: string[]) => busyDays.length > 0 && busyDays.every((d) => WEEKDAYS.includes(d));
/**
 * A one-off weather risk dated only to days the business is not busy (QA cycle 3: "Cold Wednesday Nov 25" for Thu-Sat bars,
 * Thanksgiving rain for a Mon-Fri roofing crew). Dates ("Nov 24-26") and weekday names count; no date = kept.
 */
export function offBusyDays(r: { peril: string; window?: string; trigger: string; title: string; horizon?: string }, busyDays: string[], today: string): boolean {
  if (!["rain", "cold", "heat", "snow", "storm"].includes(r.peril) || (r.horizon && r.horizon !== "event") || !busyDays.length) return false;
  const text = `${r.window ?? ""} ${r.title} ${r.trigger}`;
  if (weekdayOnly(busyDays) && HOLIDAY.test(text)) return true;
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
  const days = new Set<string>();
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2})\b)?/gi)) {
    const mi = MON.indexOf(m[1].toLowerCase().slice(0, 3)), yy = mi < m0 - 6 ? y + 1 : y;
    const a = Number(m[2]), b = m[3] ? Math.min(Number(m[3]), a + 6) : a;
    for (let d = a; d <= Math.max(a, b); d++) days.add(DOW[new Date(Date.UTC(yy, mi, d, 12)).getUTCDay()]);
  }
  // a calendar date is exact; weekday words count only without one (QA cycle 4: "Cold Saturday" titled over a "Tue Nov 24" trigger)
  if (!days.size) for (const m of text.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|nesday|sday|rsday|urday|s)?\b/gi)) days.add(m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase());
  // "weekend" only when no day is named ("Thanksgiving-week weekend run-up ... Wed Nov 25" is a Wednesday)
  if (!days.size && /\bweekend\b/i.test(text)) { days.add("Sat"); days.add("Sun"); }
  return days.size > 0 && ![...days].some((d) => busyDays.includes(d));
}

/** Regional markets need the region: ERCOT is the Texas grid (QA cycle 2: an ERCOT power trigger for a Phoenix car wash). */
export function regionOk(r: { peril: string; trigger: string; title: string }, profile: BusinessProfile): boolean {
  if (!/\bercot\b|\btexas\b/i.test(`${r.title} ${r.trigger}`) || r.peril === "game") return true;
  return /\b(tx|texas)\b|austin|dallas|houston|san antonio|fort worth|el paso|lubbock|waco|corpus christi|arlington|plano/i.test(profile.city);
}

/**
 * A trigger is a market-style condition, not commentary (QA cycle 4: "high at or above 40F on Mon Nov 23 (forecast 36F, so
 * unlikely; no live market for that date)", "(Flood Watch, 44% chance of showers)", "(YES ~28c)"): asides about forecasts,
 * odds, prices or markets are cut.
 */
export function cleanTrigger(t: string): string {
  const aside = /forecast|\bchance\b|\d\s*%|unlikely|\blikely\b|\bmarkets?\b|\bnws\b|\bwatch\b|\bwarning\b|\badvisory\b|\d\s*(?:¢|cents\b|c\b)/i;
  const out = t.trim()
    .replace(/\s*\(([^)]*)\)/g, (m, inner: string) => (aside.test(inner) || /\b(YES|NO)\b/.test(inner) ? "" : m))
    .replace(/\s*[;,–—-]\s+(?:forecast|currently|the market|markets?|no live market|priced|odds)\b[^;]*$/i, "")
    .replace(/\s{2,}/g, " ").trim();
  return out || t.trim();
}

function sanitizeRisks(raw: z.infer<typeof riskMapSchema>["risks"], profile: BusinessProfile, now = new Date()): Risk[] {
  // an event risk loses at most a week of revenue; a month / season risk (a playoff run, a soaked month) up to 30 days
  const capFor = (window: string) => Math.max(100, profile.avgDailyRevenueUsd * (riskHorizon({ window }, now) === "event" ? 7 : 30));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const grounded = raw.filter((r) => groundedRisk(r.peril, profile) && !pastDated(r, today, Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(now)) >= 17) && regionOk(r, profile)
    && !offBusyDays({ ...r, horizon: riskHorizon(r, now) }, profile.busyDays, today));
  if (grounded.length < raw.length) console.warn(`[advise] dropped ungrounded risks: ${raw.filter((r) => !grounded.includes(r)).map((r) => r.title).join("; ")}`);
  return (grounded.length ? grounded : raw).slice(0, 5).map((r, i) => ({
    id: `r${i + 1}`,
    peril: r.peril,
    title: r.title.trim(),
    trigger: cleanTrigger(r.trigger),
    location: r.location.trim() || undefined,
    window: r.window.trim() || undefined,
    lossUsd: Math.max(10, Math.round(Math.min(r.lossUsd, capFor(r.window)) / 10) * 10),
    lossReasoning: r.lossReasoning.trim(),
    confidence: Math.round(Math.min(1, Math.max(0, r.confidence)) * 100) / 100,
  }));
}

const FIXED_TERMS = /fixed[- ](price|rate)|fixed by contract|can'?t reprice|until next year|annual contracts?|price(s|d)? (are )?locked/i;
/** Hand-written risks when the LLM fails: preset's map, else a generic weather map scaled to revenue. */
export function fallbackRisks(profile: BusinessProfile): Risk[] {
  const preset = getPreset(profile.presetId) ?? getPreset(profile.id);
  if (preset) return preset.fallbackRisks.map((r) => ({ ...r }));
  const d = profile.avgDailyRevenueUsd, t = profile.description;
  const days = profile.busyDays.length ? profile.busyDays.join("/") : "a busy day";
  const city = profile.city.split(",")[0].trim() || "Austin";
  const r10 = (x: number) => Math.max(10, Math.round(x / 10) * 10);
  const out: Omit<Risk, "id">[] = [];
  if (/outdoor|outside|patio|cart|truck|roof|crew|deliver|courier|market|park|rain|weather|cold|heat|\bhot\b|event|tour|lake|garden|nursery|landscap|construction|pop-up|rental|guests|drivers?/i.test(t)) {
    out.push({ peril: "rain", title: `Rain on ${days}`, trigger: `Measurable rain in ${city} on ${days}`, location: city, window: "next 7 days", lossUsd: r10(d * 0.35), lossReasoning: `Assumes ~35% of a ${usd(d)} day is lost to rain.`, confidence: 0.4 });
    if (/cold|winter|freez|chill|outdoor|outside|patio|cart|market|pop-up|crew|roof/i.test(t)) out.push({ peril: "cold", title: "Cold snap", trigger: `${city} daily high at or below 55°F`, location: city, window: "next 7 days", lossUsd: r10(d * 0.15), lossReasoning: `Assumes ~15% of a ${usd(d)} day is lost on a cold day.`, confidence: 0.3 });
    if (/heat|\bhot\b|\bsun|summer/i.test(t)) out.push({ peril: "heat", title: "Extreme heat", trigger: `${city} daily high >= 90°F`, location: city, window: "next 7 days", lossUsd: r10(d * 0.15), lossReasoning: `Assumes ~15% of a ${usd(d)} day is lost when it is very hot.`, confidence: 0.3 });
  }
  if (groundedRisk("fed", profile)) out.push({ peril: "fed", title: "Fed hikes more than priced", trigger: "The Fed hikes more than priced at the meeting before your rate resets (next FOMC)", location: "US", window: "next FOMC meeting", lossUsd: r10(d * (/mortgage|refi|loan officer/i.test(t) ? 0.3 : 0.05)), lossReasoning: "A bigger-than-priced hike pushes variable-rate costs (or rate-driven demand) the wrong way before your rate resets.", confidence: 0.35 });
  if (/crypto|bitcoin|\bbtc\b|solana|\bsol\b/i.test(t)) out.push({ peril: "crypto", title: "Bitcoin drawdown", trigger: "BTC falls below this week's lower strikes", location: "US", window: "next 7 days", lossUsd: r10(d * 0.3), lossReasoning: "Crypto-paying customers pull back and coins held as revenue lose value.", confidence: 0.35 });
  if (groundedRisk("gas", profile) && /fuel|gas|diesel|vans?|truck|cars?|vehicle|deliver|miles?|fleet|courier|drivers?/i.test(t)) {
    // prices fixed by contract / bid until they reprice: the fuel exposure runs to year end, not one week
    if (FIXED_TERMS.test(t)) {
      const fuel = /diesel/i.test(t) ? "diesel" : "gas";
      out.push({ peril: "gas", title: `${fuel === "diesel" ? "Diesel" : "Fuel"} stays high until prices reprice`, trigger: fuel === "diesel" ? "US diesel price above today's level at year end" : "US gas prices climb above this year's high strikes by year end",
        location: "US", window: "through December", horizon: "month", lossUsd: r10(d * (fuel === "diesel" ? 0.2 : 0.05) * 20 * 0.15),
        lossReasoning: `Fuel is ~${fuel === "diesel" ? 20 : 5}% of a ${usd(d)} day's costs; a ~15% rise over the ~20 working days left before prices reprice.`, confidence: 0.35 });
    }
    else out.push({ peril: "gas", title: "Fuel price spike", trigger: "US gas prices above this week's top strike", location: "US", window: "this week", lossUsd: r10(d * 0.05), lossReasoning: `Assumes fuel is ~5% of a ${usd(d)} day's costs.`, confidence: 0.35 });
  }
  if (/inflation|cpi|food cost|milk|bean|ingredient|mortgage/i.test(t)) out.push({ peril: "cpi", title: "Hot inflation print", trigger: "CPI above consensus at the next release", location: "US", window: "next CPI release", lossUsd: r10(d * 0.1), lossReasoning: "Input costs (or rates) rise faster than prices can follow.", confidence: 0.3 });
  if (out.length >= 2) return out.slice(0, 4).map((r, i) => ({ ...r, id: `r${i + 1}` }));
  return [
    { id: "r1", peril: "rain", title: "Rain on a busy day", trigger: `Measurable rain in ${city} on a busy day`, location: city, window: "next 7 days", lossUsd: Math.round(d * 0.35 / 10) * 10, lossReasoning: `Assumes ~35% of a ${usd(d)} day is lost to rain-driven no-shows.`, confidence: 0.4 },
    { id: "r2", peril: "heat", title: "Extreme heat", trigger: `${city} daily high >= 90°F`, location: city, window: "next 7 days", lossUsd: Math.round(d * 0.15 / 10) * 10, lossReasoning: `Assumes ~15% of a ${usd(d)} day is lost when it is very hot.`, confidence: 0.3 },
    { id: "r3", peril: "cold", title: "Cold snap", trigger: `${city} daily high below 50°F`, location: city, window: "next 7 days", lossUsd: Math.round(d * 0.15 / 10) * 10, lossReasoning: `Assumes ~15% of a ${usd(d)} day is lost on a cold day.`, confidence: 0.3 },
  ];
}

// ---------- prompts ----------
const RISK_SYSTEM = `You are Hedgehog's risk analyst for US small businesses (the owner's city is in the profile; markets are measured there, never in another city).
Find the business's worst exposures that a binary prediction market could hedge: near-term bad days AND the season / month exposures the owner really feels (a playoff run that ends early, a soaked month, a fuel bill until contracts reprice, a rate path until a loan resets). Estimate the dollars lost.
Rules:
- Return 3 to 5 risks, most material first.
- Only objective, publicly settled events: official daily high/low temperature, rain, snowfall or snow days, a named team's game result, WTI/Brent oil, US gas or diesel price, natural gas, metals, Texas (ERCOT) power prices/peak demand (Texas businesses only), lake/river water levels, earthquakes, tornado counts, Fed decision, CPI print. Never "staff quits" or "bad review". ${parametricEnabled() ? 'Flood (river above flood stage), hail (1 inch+ nearby), wildfire (100+ acres nearby) and air quality (AQI above 150, peril "smoke") have no exchange market, but Hedgehog sells parametric cover on them (priced from public history, settled from USGS / NOAA / NIFC / AQI data): list them when they really threaten this business.' : 'Flood, hail, wildfire and air quality (peril "smoke") have no direct market: list them only when they really threaten this business. Code matches them to the closest real market (rain totals, river levels, tornado counts, a dry spell) with a basis-risk note, or marks them not coverable.'}
- peril is one of: heat, cold, rain, snow, game, oil, gas (incl. diesel), natgas, metals, power, water, quake, storm, fed, cpi, crypto, flood, smoke (air quality), hail, wildfire, other.
- trigger is plain English (no venue names, brackets, prices, odds or forecast numbers) and reads like a market question with a concrete threshold or team, on the busy day the owner names, e.g. "Austin high >= 85°F on Sat Nov 22", "Spurs lose to the Lakers on Fri Nov 21". Use thresholds that fit the season and the owner's city.
- window: a single event = a date or range inside the next 7 days (dates are given). An exposure that piles up = the period the owner feels: "December", "through the 2026-27 NBA playoffs", "through the Jan 27 2027 FOMC" (the meeting before a loan reprices); use the Season calendar. horizon = event | month | season.
- If the owner mentions a team, playoffs, a busy or booking season, monthly totals, fuel contracts, or a loan / lease / rate reset, include at least 1 month or season risk (see SEASON FUTURES & PERIOD MARKETS). Keep one-off days (a rainy Saturday, this week's game) as event risks.
- Examples: Spurs bar -> "Spurs fail to reach the Western Conference finals" (~5 lost playoff nights); landscaper -> "Austin rain above 5 inches in December"; box-truck fleet -> "Diesel above $5.60 at the end of the latest listed month"; mortgage broker -> "30-year mortgage rate tops 7% in 2027".
- location is where the event is measured: "Austin", the team's city, or "US".
- lossUsd = revenue lost (or extra cost) per occurrence for an event, grounded in the given average daily revenue and busy days; show the arithmetic in lossReasoning (e.g. "Sat ~1.5x avg = $6,300; 80% patio; -40% => ~$2,000"). One event should rarely exceed two days of revenue. Month / season window: lossUsd = the EXTRA loss in the bad scenario vs a normal one over the whole window (e.g. "~5 home playoff nights x $3,200 lift = $16,000").
- confidence (0..1) = how sure you are that the event causes that loss.
- Align triggers and windows with the LIVE MARKETS (same dates, thresholds and games), but write them in your own plain English: a trigger a live market settles beats a more precise one nobody trades. E.g. if a market asks where it will rain this weekend, write "Rain in Austin this weekend (Nov 21-22)", not ">= 0.25 in on Saturday". Use absolute price thresholds from the market labels, not "+$0.50". Daily weather markets often exist only for today/tomorrow; if the risky day has no market, still list the risk.
- Prefer risks the LIVE MARKETS can hedge, but still include a material risk if no market is listed. Never stretch a one-off exposure (one game, one rainy day) into a season risk.
- Relevance beats coverage: every risk must follow from something the owner said or an obvious trait of the business (outdoor seats, vans, a loan, crypto revenue, game-night crowds). A market existing is NOT a reason to list a risk: no fuel/gas-price risk unless the business buys meaningful fuel (vehicles, generators, equipment); no Fed/CPI risk unless it carries variable-rate debt or its revenue moves with rates/prices.
- Weather risks must land on the owner's BUSY DAYS (or the days it operates); check each date's weekday in the Next 7 days list and name the busy day in the title (a Fri/Sat venue's weekend risk is "rainy Saturday", not Sunday). A weekend weather market does not hedge a Monday-Friday business: pick a weekday market or list the risk without one.
- If a WEATHER FORECAST is given, weather risks follow it: a risky busy day in the forecast (rain >= 50%, a cold front, heat, an NWS alert) comes first, dated to that day, with the forecast in lossReasoning. A dry, mild week makes this week's weather risks less likely: keep them only if a market prices them cheaply, and prefer later dates or month totals.
- A team the owner says fills the place gets its next game on a busy day as an event risk when a live market lists it, in the sport the owner names: never another sport's game or opponent (football Saturdays are never an NCAAM game) and no sport the owner did not mention.
- Seasonal-demand businesses (heating fuel, snow removal, ski): list the warm or snowless month that cuts demand even when no market prices it.
- Game-day answers: "more customers on game days" -> add the local team's game risks (the next game lost; a lot or stand at the stadium: the next HOME game, and a season risk such as missing the playoffs / CFP, i.e. fewer home game days); "fewer customers" or "no difference" -> no game risk. Fuel / propane costs "No" -> no fuel risk. Big events "No difference" -> no event risk.
- If the owner answered quick questions, treat the answers as facts: use them to size losses (e.g. "mostly outdoor seating", "3 vans") and drop risks they rule out (no outdoor seating -> no patio-weather risk; no own vehicles -> no fuel risk; fixed-rate loan -> no Fed risk for the loan; game result doesn't matter -> no game risk).`;

const MATCH_SYSTEM = `You pick prediction-market contracts that hedge business risks (several risks at once, each with its own CANDIDATES list). Each contract is binary: a YES share pays $1 if the label resolves true, a NO share pays $1 if it resolves false.
Rules:
1. contractId MUST be copied exactly from THAT risk's CANDIDATES. Never invent or edit an id, never use another risk's candidates.
2. side = the side that PAYS when the bad thing in the risk happens (for a proxy risk: when the driver moves against the business, e.g. crude rises above X).
   - "Team X loses": teams are often listed by city ("San Antonio" = Spurs, "Houston" = Texans/Rockets). NO on the "Team X" contract, or YES on the opponent's contract (pick the cheaper ask).
   - "high >= T": YES on a threshold contract like "T°F or above" near T. Avoid narrow range buckets ("88-89°F") unless nothing else exists.
   - "cold / high below T": YES on "below T" contracts, or NO on "T or above".
   - Price rising above X: YES on "above X" / "X or above". Falling below X: NO on "above X", or YES on "below X".
   - Own-team season futures (playoffs, conference finals/title, championship, "N+ wins"): NO pays if the run stops (lost playoff nights); YES only funds a win promo. Match the stage ("miss the playoffs" -> playoff qualifiers or a wins rung; "run ends early" -> conference finals / title).
   - A season or month contract covers months, is bought once and can be sold before it settles; never cover a season or month risk with a single game or day.
   - "Rates stay high / no cut": a hold AND a hike both hurt; YES on a funds-rate level "above X%" pays in both, "maintains" alone misses a hike.
   - Weather: the contract's day or period must be the risk's day(s); one day never covers a weekend, a Thursday never covers Fri/Sat.
3. Prefer: date inside the risk window and on the owner's busy days (a weekend market beats a month total for a weekend-only business), threshold closest to the trigger, ask between 0.05 and 0.85, ideally 0.10-0.50. An ask above ~0.60 means the bad outcome is already likely, so the owner mostly prepays the payout: make the further-out strike the "recommended" pick and offer the pricey one as "broad". Prefer gemini contracts when they are otherwise equal or close in price (Gemini = our primary venue; kalshi only when Gemini lacks the market). Polymarket candidates are buyable too (best price wins), but prefer gemini/kalshi when prices are close. A candidate with "proxy:" is the closest real market for a risk no market lists directly: pick it only if the note fits the loss, take the side the note describes, and put the note in basisRisk.${parametricEnabled() ? " hedgehog candidates are Hedgehog parametric cover (flood, hail, wildfire, air quality; YES pays when the trigger happens, priced from local history): buyable, use them for those risks." : ""}
4. Imperfect is OK: if a contract pays in most of the scenarios where the loss happens (e.g. "rain this weekend" for "rain Saturday", a nearby threshold, the same team's next game), pick it and explain the gap in basisRisk.
5. Give the owner CHOICES. For each risk return 1 to 3 picks:
   - picks[0] tier "recommended": the best hedge.
   - optional tier "cheap-tail": same event, more extreme threshold (cheaper, pays only in the bad tail).
   - optional tier "broad": same event, less extreme threshold (pricier, pays more often).
   - optional tier "other-date" (same kind of market on another date) or "other-side" (games: the opponent's YES instead of your team's NO).
   Return picks: [] with a short noMatchReason only if no candidate pays in the loss scenario (wrong direction, wrong team, or dates that do not overlap at all).
6. basisRisk: one honest sentence about the mismatch (measured at the airport not the patio, threshold differs from trigger, a loss does not always empty the bar, a proxy only loosely tracks costs, etc.).
7. rationale: one plain-English sentence a small-business owner understands, saying why this pick (and this strike) fits.
8. Return one entry in "matches" per RISK id given.`;

// ---------- main ----------
const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/**
 * The analysis chain (at most 4 LLM calls, typically 4):
 *  0. live market universe (code) -> compact summary + catalog of every series
 *  1. risk map (LLM pro)  ||  2. creative brainstorm over the catalog (LLM pro): proxies + natural hedges   [parallel]
 *  3. candidates per risk (code), then ONE batched matcher call (LLM fast) returning 1-3 tiered picks per risk
 *     (+ deterministic strike-ladder / other-date / other-side choices), backtest evidence (hitRate)
 *  4. sizing (code): every choice, then the default plan inside the budget; 3 packages (code)
 *  5. summary (LLM fast, skipped near the route's time limit)
 */
export async function advise(owner: BusinessProfile, opts: AdviseOpts = {}): Promise<Quote> {
  const answers = cleanAnswers(opts.answers);
  // `profile` carries the answers' facts (grounding hooks, busy days) for every code path; prompts quote the owner's own words + answers.
  const profile = profileWithAnswers(owner, answers);
  const pb = profileBlock({ ...owner, busyDays: profile.busyDays }, answers);
  const deps = await resolveDeps(opts.deps);
  const coveragePct = opts.coveragePct ?? 50;
  const now = deps.now?.() ?? new Date();
  const t0 = Date.now();
  const models = new Set<string>();

  // (0) market universe (+ the forecast, fetched in parallel; never blocks more than 6 s)
  const forecastP = deps.forecast ? timeout(deps.forecast(profile, now), 6000).catch(() => null) : Promise.resolve(null);
  let all: MarketContract[] = [];
  if (deps.listMarkets) {
    try { all = await timeout(deps.listMarkets(), 8000); } catch { /* optional context */ }
  }
  const universe = all.length ? marketUniverse(all, profile, 6, now.getTime()) : "";
  const catalog = all.length ? buildCatalog(all, profile, teamWords(profile.description), now.getTime()) : [];
  const today = todayLabel(now);
  // optional industry playbook seeds (deterministic, validated against live markets); never breaks advise()
  let playbook: { ideas: Idea[]; naturalHedges: NaturalHedge[] } = { ideas: [], naturalHedges: [] };
  if (deps.playbookIdeas) {
    try { playbook = ideasFromPlaybook(await timeout(Promise.resolve(deps.playbookIdeas(profile, all)), 4000), profile); }
    catch (e) { console.warn(`[advise] playbook failed: ${(e as Error).message.slice(0, 120)}`); }
  }

  const fc = await forecastP;
  const fcBlock = forecastBlock(fc);

  // (1) risk map || (2) brainstorm
  const [riskRes, ideaRes] = await Promise.allSettled([
    deps.llm({
      tier: "pro",
      system: RISK_SYSTEM,
      schema: riskMapSchema,
      prompt: [
        pb,
        `\nToday is ${today}. Next 7 days: ${nextDays(now).join(", ")}.`,
        fcBlock,
        all.length ? seasonCalendar(all, profile, now.getTime()) : "",
        universe ? `\nLIVE MARKETS (what can be hedged right now):\n${universe}` : "",
        `\nReturn {"risks":[...]}.`,
      ].join("\n"),
    }),
    deps.llm({ tier: "pro", system: BRAINSTORM_SYSTEM, schema: brainstormSchema, prompt: brainstormPrompt(pb, `${today}. Next 7 days: ${nextDays(now).join(", ")}${fcBlock}${all.length ? `\n${seasonCalendar(all, profile, now.getTime())}` : ""}`, catalog, playbook.ideas) }),
  ]);
  let risks: Risk[];
  if (riskRes.status === "fulfilled") {
    risks = sanitizeRisks(riskRes.value.data.risks, profile, now);
    models.add(riskRes.value.model);
  } else {
    console.warn(`[advise] risk map LLM failed, using fallback risks: ${String((riskRes.reason as Error)?.message).slice(0, 200)}`);
    risks = applySignals(fallbackRisks(profile), fc, profile); // a risky busy day in the forecast goes first
    models.add("fallback-risk-map");
  }
  if (answers.length) {
    const kept0 = suppressByAnswers(risks, answers);
    if (kept0.length < risks.length) console.warn(`[advise] answers ruled out: ${risks.filter((r) => !kept0.includes(r)).map((r) => r.title).join("; ")}`);
    risks = adjustByAnswers(kept0.length ? kept0 : suppressByAnswers(fallbackRisks(profile), answers), answers).map((r, i) => ({ ...r, id: `r${i + 1}` }));
  }
  // long horizon (code, no LLM call): a season risk for a crowd business that names its team, a month-total risk for crews
  // + "More customers on game days" (discovery answer): the team's next game, when no risk covers it yet
  const longRisks = [...futuresFallbackRisks(profile, all, now), ...periodFallbackRisks(profile, now, all), ...gameDayRisks(profile, answers, all, now).filter((g) => !risks.some((r) => r.peril === "game" && sameExposureX(r, g as Risk)))]
    .map((r, i) => ({ ...r, id: `lh${i}` }) as Risk)
    // a season risk on another stage is another exposure (QA cycle 2: "Celtics don't win the title" hid "Celtics miss the playoffs",
    // the 4c tail the pub actually needs)
    .filter((x) => !risks.some((r) => r.peril === x.peril && riskHorizon(r, now) !== "event" && (x.peril !== "game"
      || (sameExposureX(r, x) && (stageWanted(`${r.title} ${r.trigger}`)[0] ?? "") === (stageWanted(`${x.title} ${x.trigger}`)[0] ?? "")))));
  const longKept = answers.length ? suppressByAnswers(longRisks, answers) : longRisks;
  risks = dedupeRisks([...risks, ...longKept], now).map((r, i) => ({ ...r, id: `r${i + 1}` }));
  risks = risks.map((r) => { const h = r.horizon ?? riskHorizon(r, now); return { ...r, kind: r.kind ?? "direct", ...(h !== "event" ? { horizon: h } : {}) }; });

  let ideas: Idea[] = [];
  let naturalHedges: NaturalHedge[] = [];
  if (ideaRes.status === "fulfilled") {
    ideas = ideasFromBrainstorm(ideaRes.value.data, catalog, profile);
    naturalHedges = ideaRes.value.data.naturalHedges.map((n) => ({ ...n, title: n.title.trim(), explanation: n.explanation.trim() }));
    models.add(ideaRes.value.model);
  } else {
    console.warn(`[advise] brainstorm LLM failed, using fallback ideas: ${String((ideaRes.reason as Error)?.message).slice(0, 200)}`);
  }
  const fb = fallbackIdeas(profile);
  naturalHedges = [...naturalHedges, ...playbook.naturalHedges].slice(0, 4);
  if (!naturalHedges.length) naturalHedges = fb.naturalHedges;
  // de-duplicate against the direct risks and each other
  const kept: Idea[] = [];
  // natural hedge vs direct risk on the same peril (QA cycle 2): the owner's own words win ("lake-effect storms kill whole
  // weekends" keeps the snow risk and drops "snow lifts takeout"); a risk the owner never hinted at yields to the advice
  {
    const said = (p: string) => !!PERIL_WORDS[p]?.test(owner.description);
    const wx = (p: string) => !!PERIL_WORDS[p]; // weather only: "Spurs wins already pay you" does not contradict "Spurs lose"
    naturalHedges = naturalHedges.filter((n) => n.advice !== "dont-hedge" || !wx(n.peril) || !risks.some((r) => r.peril === n.peril) || !said(n.peril));
    const no = new Set(naturalHedges.filter((n) => n.advice === "dont-hedge" && wx(n.peril)).map((n) => n.peril));
    const keep = risks.filter((r) => !no.has(r.peril) || said(r.peril));
    if (keep.length && keep.length < risks.length) {
      console.warn(`[advise] risks dropped (natural hedge says don't hedge): ${risks.filter((r) => !keep.includes(r)).map((r) => r.title).join("; ")}`);
      risks = keep.map((r, i) => ({ ...r, id: `r${i + 1}` }));
    }
  }
  // any peril but games ("Spurs wins already pay you" says nothing about a loss): high gas prices that HELP a pawn shop mean no
  // gas idea (QA cycle 4: "Gas prices squeeze customer spending" bought next to the advisor's own "don't hedge gas")
  const dontHedge = new Set(naturalHedges.filter((n) => n.advice === "dont-hedge" && n.peril !== "game").map((n) => n.peril));
  const addIdeas = (xs: Idea[]) => {
    for (const idea of xs) {
      // the same grounding as the risk map (QA cycle 2: Fed / CPI ideas for businesses with no loan; cold cover next to
      // "don't hedge cold" advice)
      if (!groundedRisk(idea.risk.peril, profile) && (FAMILY[idea.risk.peril] === "rates" || idea.risk.peril === "metals" || idea.risk.correlation === "weak"
        // a fuel idea about the business's own vehicles the owner never mentioned (QA cycle 3: "diesel for truck and dump
        // costs" for a roofer); a supplier surcharge story (keg delivery off Brent) can stand
        || (FAMILY[idea.risk.peril] === "fuel" && /\b(trucks?|vans?|fleet|dump|vehicles?|equipment|crews?)\b/i.test(`${idea.risk.title} ${idea.risk.causalStory ?? ""}`)))
        // a story about the business's own driving with no fleet in the owner's words (QA cycle 4: "every delivery mile costs
        // more" for a hotel)
        // (a supplier's delivery surcharge is not the owner's driving)
        || (FAMILY[idea.risk.peril] === "fuel" && /\bdelivery (miles?|vans?|trucks?|routes?|drivers?|runs?)\b|\bour (vans?|trucks?|fleet|vehicles?|deliver\w*)\b|\bfleet\b|\bmiles?\b/i.test(`${idea.risk.title} ${idea.risk.causalStory ?? ""}`) && !OWN_FLEET.test(owner.description))) { console.warn(`[advise] idea "${idea.risk.title}" dropped: not grounded in the owner's words`); continue; }
      // a one-off weather idea on a day the business is not busy (QA cycle 4: Thanksgiving-Thursday rain for a Fri/Sat bar)
      if (offBusyDays({ ...idea.risk, horizon: riskHorizon(idea.risk, now) }, profile.busyDays, new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now))) { console.warn(`[advise] idea "${idea.risk.title}" dropped: not on a busy day`); continue; }
      if (dontHedge.has(idea.risk.peril) && !risks.some((r) => r.peril === idea.risk.peril)) { console.warn(`[advise] idea "${idea.risk.title}" dropped: natural hedge says don't hedge ${idea.risk.peril}`); continue; }
      const dup = [...risks, ...kept.map((k) => k.risk)].find((r) => sameExposureX(idea.risk, r) || sameFamily(idea.risk, r));
      if (dup) { console.warn(`[advise] idea "${idea.risk.title}" dropped: same exposure as "${dup.title}"`); continue; }
      idea.risk.trigger = cleanTrigger(idea.risk.trigger); // ideas too (confirm run: "Government shutdown ... (priced about 28 cents)")
      kept.push(idea);
    }
  };
  const allowed = (xs: Idea[]) => (answers.length ? xs.filter((x) => suppressByAnswers([x.risk], answers).length) : xs);
  addIdeas(allowed([...ideas, ...playbook.ideas]));
  // top up with the hand-written ideas when too few survive or none has a strong link
  if (kept.length < 2 || !kept.some((i) => i.risk.correlation === "strong")) addIdeas(allowed(fb.ideas));
  const rank = { strong: 0, medium: 1, weak: 2 } as const;
  kept.splice(0, kept.length, ...kept.map((idea, i) => ({ idea, i })).sort((a, b) => rank[a.idea.risk.correlation ?? "medium"] - rank[b.idea.risk.correlation ?? "medium"] || a.i - b.i).map((x) => x.idea).slice(0, 5));
  kept.forEach((k, i) => { k.risk.id = `idea${i + 1}`; }); // final ids (r<n>) once market-less ideas are dropped

  // (3a) candidates (code)
  const contracts = new Map<string, MarketContract>();
  const uncovered: { riskId: string; reason: string }[] = [];
  const candsByRisk = new Map<string, MarketContract[]>();
  const noExposure = new Set<string>();
  await Promise.all(risks.map(async (risk) => {
    let cands: MarketContract[] = [];
    try {
      cands = (await deps.findCandidates(risk, profile, 12)).filter((c) => c.status === "open");
      // one retry: a parallel cold-cache listMarkets can come back empty for a moment (QA cycle 1: "no live market for diesel"
      // while 19 diesel strikes were live)
      if (!cands.length) { await new Promise((r) => setTimeout(r, 300)); cands = (await deps.findCandidates(risk, profile, 12)).filter((c) => c.status === "open"); }
      // A risk about a named month ("Rainy December") must be hedged with THAT month's market, never a neighbour's.
      const want = monthsNamed(`${risk.title} ${risk.trigger} ${risk.window ?? ""}`);
      if (want.size === 1) {
        const before = cands.length;
        const all0 = cands;
        cands = cands.filter((c) => { const have = monthsNamed(`${c.eventTitle} ${c.label}`); return !have.size || [...have].some((m) => want.has(m)); });
        // an ongoing cost (fuel, metals, gas bills) with no market for that month yet: the latest month-end print before it is
        // the nearest live measure (QA cycle 3: a gasoline fleet's #1 risk left uncovered while November gas strikes were live)
        if (before && !cands.length && COST_PERILS.has(risk.peril)) {
          const prev = ([...want][0] + 11) % 12;
          cands = all0.filter((c) => monthsNamed(`${c.eventTitle} ${c.label}`).has(prev));
        }
        if (before && !cands.length) {
          // the current month has no "not listed yet" excuse (QA cycle 4: "No November market is listed yet" on Nov 20)
          const m = [...want][0], cur = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric" }).format(now)) - 1;
          uncovered.push({ riskId: risk.id, reason: m === cur
            ? noMarketReason(risk.peril, `${risk.location ? ` in ${risk.location}` : ""} (${risk.window ?? MONTH_NAMES[m]})`)
            : `No ${MONTH_NAMES[m]} market is listed yet; venues usually open the next month near month-end.` });
          return;
        }
      }
      // the owner's own fuel (QA cycle 2: gasoline trucks / jet skis hedged with diesel): drop the other fuel's contracts when
      // the owner names only one of them
      // a direct fuel risk too: only diesel listed for a gasoline truck is not its fuel (QA cycle 5: a food truck's "gas for the
      // generator and the truck" bought year-end diesel)
      if (risk.peril === "gas") {
        const k = ownFuel(cands, owner.description, true);
        if (cands.length && !k.length) { uncovered.push({ riskId: risk.id, reason: "Only the other fuel's price markets fit this window; they don't track what you buy." }); return; }
        cands = k;
      }
      // a weekday-only business is closed on the holiday: Thanksgiving-day weather is not its loss (QA cycle 3)
      if (["rain", "cold", "heat", "snow"].includes(risk.peril) && weekdayOnly(profile.busyDays)) {
        const before = cands.length;
        cands = cands.filter((c) => !HOLIDAY.test(c.eventTitle));
        if (before && !cands.length) {
          uncovered.push({ riskId: risk.id, reason: "The only market is for the holiday itself, when your crews don't work." });
          return;
        }
      }
      // one-day weather: the contract's day must be one the risk names (QA cycle 4: a Saturday cold risk offered Friday's low;
      // a Wednesday rain risk priced off the Thanksgiving Thursday market)
      if (["rain", "cold", "heat", "snow"].includes(risk.peril) && riskHorizon(risk, now) === "event") {
        const before = cands.length;
        cands = cands.filter((c) => weatherDayFits(risk, c, now, profile.busyDays));
        if (before && !cands.length) {
          const days = namedDays(`${risk.title} ${risk.trigger} ${risk.window ?? ""}`, now).map((d) => new Date(d).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }));
          uncovered.push({ riskId: risk.id, reason: `No live market for ${risk.peril} on ${days.join(" / ") || "that day"}${risk.location ? ` in ${risk.location}` : ""}; the listed ones are for other days.` });
          return;
        }
      }
      // one game: the contract's game day must be the risk's (QA cycle 2: a "Sun Nov 29" risk bought the Nov 26 game) and,
      // for a business tied to the stadium (parking, tailgates), a home game
      if (risk.peril === "game" && riskHorizon(risk, now) === "event") {
        const before = cands.length;
        cands = cands.filter((c) => gameFits(risk, c, profile, now));
        if (before && !cands.length) {
          uncovered.push({ riskId: risk.id, reason: "No live market for that game (the listed games are on other dates or away from your venue)." });
          return;
        }
      }
      // An ongoing cost (monthly fuel bill, margins) isn't hedged by a price on ONE day: a 1-day contract barely moves
      // a month's bill. Cost risks need a contract that settles >= ~3 days out (weekly / monthly price markets).
      if (COST_PERILS.has(risk.peril) && ONGOING_COST.test(`${risk.title} ${risk.trigger} ${risk.lossReasoning}`)) {
        const before = cands.length;
        const horizonOk = (c: MarketContract) => { const t = Date.parse(c.expiry); return !Number.isFinite(t) || t - now.getTime() >= 3 * 86_400_000; };
        cands = cands.filter(horizonOk);
        if (before && !cands.length) {
          uncovered.push({ riskId: risk.id, reason: "Only one-day price markets are listed for this; they don't track a monthly cost." });
          return;
        }
      }
    } catch (e) {
      uncovered.push({ riskId: risk.id, reason: `Market search failed: ${(e as Error).message.slice(0, 120)}` });
      return;
    }
    if (!cands.length) {
      uncovered.push({ riskId: risk.id, reason: noMarketReason(risk.peril, `${risk.location ? ` in ${risk.location}` : ""} ${risk.window ? `(${risk.window})` : "this week"}`) });
      return;
    }
    // a snowy-winter risk where the city's own snow-day market is a bucket from zero ("Houston · 0-2 days"): snow days are
    // near zero there, so it is not a real exposure (QA cycle 5: "winter freeze-day season cover" for Austin and Houston)
    if (snowlessCity(risk, cands)) { noExposure.add(risk.id); return; }
    candsByRisk.set(risk.id, cands);
  }));
  if (noExposure.size) {
    console.warn(`[advise] dropped snow risks in near-snowless cities: ${risks.filter((r) => noExposure.has(r.id)).map((r) => r.title).join("; ")}`);
    const keep = risks.filter((r) => !noExposure.has(r.id));
    const ren = new Map(keep.map((r, i) => [r.id, `r${i + 1}`]));
    const cs0 = new Map(candsByRisk); candsByRisk.clear();
    for (const [id, cs] of cs0) if (ren.has(id)) candsByRisk.set(ren.get(id)!, cs);
    for (let i = uncovered.length - 1; i >= 0; i--) { const id = ren.get(uncovered[i].riskId); if (id) uncovered[i].riskId = id; else uncovered.splice(i, 1); }
    risks = keep.map((r) => ({ ...r, id: ren.get(r.id)! }));
  }
  // a creative idea naming one month ("December CPI") gets that month's contracts only, like the direct risks (QA cycle 1)
  const sameMonth = (r: Risk, cs: MarketContract[]) => {
    const want = monthsNamed(`${r.title} ${r.trigger} ${r.window ?? ""}`);
    return want.size !== 1 ? cs : cs.filter((c) => { const have = monthsNamed(`${c.eventTitle} ${c.label}`); return !have.size || [...have].some((m) => want.has(m)); });
  };
  const ideaCands = await Promise.all(kept.map(async (idea) => {
    let base: MarketContract[] = [];
    // ideas too (QA cycle 5: a food truck that buys gasoline and BBQ vans burning "400 gallons of gas" got year-end diesel)
    const fuel = (cs: MarketContract[]) => (idea.risk.peril === "gas" || idea.risk.peril === "oil" ? ownFuel(cs, owner.description, true) : cs);
    if (idea.fixed) return fuel(sameMonth(idea.risk, idea.fixed.filter((c) => c.status === "open" && (c.yesAsk !== null || c.noAsk !== null)))).slice(0, 10);
    try { base = await deps.findCandidates(idea.risk, profile, 12); } catch { /* fall back to the catalog */ }
    return fuel(sameMonth(idea.risk, filterIdeaCandidates(idea, base, all, now.getTime()))).slice(0, 10);
  }));
  const anyIdeaMarket = ideaCands.some((c) => c.length);
  const ideaRisks: Risk[] = [];
  kept.forEach((idea, i) => {
    if (ideaCands[i].length && ideaRisks.length >= 4) return; // max 4 creative ideas with markets
    if (ideaCands[i].length) { candsByRisk.set(idea.risk.id, ideaCands[i]); ideaRisks.push(idea.risk); return; }
    if (anyIdeaMarket) return; // drop market-less ideas when others have markets
    ideaRisks.push(idea.risk);
    uncovered.push({ riskId: idea.risk.id, reason: "No live market for this idea right now; we'll keep watching." });
  });
  ideaRisks.forEach((r, i) => {
    const id = `r${risks.length + i + 1}`;
    const cs = candsByRisk.get(r.id);
    if (cs) { candsByRisk.delete(r.id); candsByRisk.set(id, cs); }
    for (const u of uncovered) if (u.riskId === r.id) u.riskId = id;
    r.id = id;
  });
  risks = [...risks, ...ideaRisks];
  for (const cs of candsByRisk.values()) for (const c of cs) contracts.set(c.id, c);

  // (3b) one batched matcher call
  const matchable = risks.filter((r) => candsByRisk.has(r.id));
  const choicesByRisk = new Map<string, TieredLeg[]>();
  const seedSides = new Map(kept.filter((k) => k.sides).map((k) => [k.risk, k.sides!] as const));
  const heuristic = (risk: Risk): TieredLeg | null => {
    const cands = candsByRisk.get(risk.id)!;
    // a playbook idea already resolved its contract + side (its trigger text names that contract): use it
    const sides = seedSides.get(risk);
    const seed = sides ? cands.find((c) => sides[c.id] && (sides[c.id] === "yes" ? c.yesAsk : c.noAsk) != null && (sides[c.id] === "yes" ? c.yesAsk! : c.noAsk!) <= 0.85) : undefined;
    if (seed) return { riskId: risk.id, contractId: seed.id, side: sides![seed.id], tier: "recommended",
      rationale: `Pays if "${seed.eventTitle}" resolves ${sides![seed.id] === "yes" ? "" : "NOT "}${seed.label}.`,
      basisRisk: `${risk.worthIt ?? "Proxy hedge: the market moves with your cost/demand driver, not your exact loss."} Heuristic pick (AI matcher unavailable); review before buying.` };
    const leg = risk.kind === "proxy" && risk.peril !== "game" ? directionalPick(risk, cands) : heuristicPick(risk, cands, profile.busyDays) ?? (risk.peril !== "game" ? directionalPick(risk, cands) : null);
    return leg ? { ...leg, tier: "recommended" } : null;
  };
  if (matchable.length) {
    let matched: z.infer<typeof batchMatchSchema>["matches"] | null = null;
    try {
      const { data, model } = await deps.llm({
        tier: "fast",
        system: MATCH_SYSTEM,
        schema: batchMatchSchema,
        timeoutMs: 30_000,
        prompt: [
          `Business: ${profile.name} (${profile.city}). Busy days: ${profile.busyDays.join(", ")}.`,
          `Today is ${today}.`,
          ...matchable.map((risk) => [
            `\nRISK ${risk.id}${risk.kind === "proxy" ? ` [creative proxy, ${risk.correlation ?? "medium"} link: ${risk.causalStory ?? ""}]` : ""}: ${risk.title}`,
            `Trigger: ${risk.trigger}`,
            `Where: ${risk.location ?? "-"} | When: ${risk.window ?? "next 7 days"} | Loss if it happens: ${usd(risk.lossUsd)}`,
            `CANDIDATES for ${risk.id} (id | venue | event | label | asks | expiry):\n${candidateLines(candsByRisk.get(risk.id)!)}`,
          ].join("\n")),
          `\nReturn {"matches":[{"riskId":"r1","picks":[...],"noMatchReason"?:string}, ...]} with one entry per risk.`,
        ].join("\n"),
      });
      models.add(model);
      matched = data.matches;
    } catch (e) {
      console.warn(`[advise] matcher failed, using heuristics: ${(e as Error).message.slice(0, 200)}`);
    }
    for (const risk of matchable) {
      const cands = candsByRisk.get(risk.id)!;
      const m = matched?.find((x) => x.riskId.trim() === risk.id);
      let legs: TieredLeg[] = [];
      if (m) {
        const { legs: ok, dropped } = enforceCandidates(risk.id, m.picks, cands);
        if (dropped.length) console.warn(`[advise] ${risk.id}: dropped non-candidate picks ${dropped.join(", ")}`);
        legs = ok.map((l, i): TieredLeg => ({ ...l, tier: i === 0 ? "recommended" : m.picks.find((p) => p.contractId.trim() === l.contractId)?.tier ?? "broad" }))
          .map((l) => guardSide(risk, l, cands.find((c) => c.id === l.contractId), owner.description)).filter((l): l is TieredLeg => !!l);
        if (legs.length) legs[0] = { ...legs[0], tier: "recommended" };
        if (!legs.length) {
          uncovered.push({ riskId: risk.id, reason: m.noMatchReason?.trim() || "None of the live markets pays out when this loss happens." });
          continue;
        }
      } else {
        const h0 = heuristic(risk);
        const h = h0 && guardSide(risk, h0, cands.find((c) => c.id === h0.contractId), owner.description);
        if (!h) { uncovered.push({ riskId: risk.id, reason: matched ? "The AI matcher skipped this risk and no obvious contract fits." : "AI matcher unavailable and no obvious contract found." }); continue; }
        legs = [h];
      }
      legs = legs.map((l) => undominated(l, cands)).filter((l, i, a) => a.findIndex((x) => x.contractId === l.contractId) === i);
      legs = busyDaysFirst(risk, legs, cands, profile.busyDays, now);
      // a "cheap tail" above 25c is not cheap (QA cycle 4: 29c diesel at the money, 39c Pittsburgh snow): call it a further strike
      const priced = insuranceFirst(ladderChoices(legs[0], cands, legs, 3), cands)
        .map((l) => (l.tier === "cheap-tail" && (askFor(l, cands) ?? 0) > CHEAP_TAIL_MAX ? { ...l, tier: "further-strike" } : l));
      if (!priced.length) {
        const a = askFor(legs[0], cands);
        uncovered.push({ riskId: risk.id, reason: a != null && a <= ALREADY_LIKELY_ASK
          ? `Priced near a coin flip: ${legs[0].side.toUpperCase()} costs ${Math.round(a * 100)}¢ per $1, so you would mostly prepay the payout. Not worth insuring at this price.`
          : `Already likely: ${legs[0].side.toUpperCase()} costs ${a != null ? `${Math.round(a * 100)}¢` : "too much"} per $1, so you would mostly prepay the payout. Not worth insuring at this price.` });
        continue;
      }
      choicesByRisk.set(risk.id, priced);
    }
  }

  // an "other" risk matched to an unrelated event is a weak proxy, never direct cover (QA cycle 3: "Thanksgiving break student
  // exodus" rewritten onto a government-shutdown contract, labelled direct, took the whole budget)
  for (const r of risks) {
    const l = choicesByRisk.get(r.id)?.[0], c = l && contracts.get(l.contractId);
    if (r.kind === "proxy" || r.peril !== "other" || !c) continue;
    const ws = (t: string) => new Set((t.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !["above", "below", "price", "prices", "before", "after", "during", "until", "which", "there", "their", "would"].includes(w)));
    const mine = ws(r.title), theirs = ws(`${c.eventTitle} ${c.label}`);
    if (![...mine].some((w) => theirs.has(w) || [...theirs].some((x) => x.startsWith(w.slice(0, 5))))) {
      console.warn(`[advise] ${r.id} "${r.title}": matched to unrelated "${c.eventTitle}", kept as a weak proxy`);
      Object.assign(r, { kind: "proxy", correlation: "weak", causalStory: r.causalStory ?? `Only loosely linked: "${c.eventTitle}" does not measure this loss.` });
    }
  }

  // one risk per market (QA cycle 3: "Rain on Thanksgiving" twice, "Chiefs miss the playoffs" bought on Gemini AND Kalshi)
  {
    const gone = mergeSameMarketRisks(risks, choicesByRisk, contracts);
    if (gone.size) {
      risks = risks.filter((r) => !gone.has(r.id));
      for (let i = uncovered.length - 1; i >= 0; i--) if (gone.has(uncovered[i].riskId)) uncovered.splice(i, 1);
    }
  }

  // (4) sizing (code): all choices (no budget) -> default plan inside the budget
  const allLegs = [...choicesByRisk.values()].flat();
  const evidenceP = attachEvidence(risks, choicesByRisk, contracts, deps);
  const optSized = allLegs.length
    ? await deps.sizeQuote({ legs: allLegs.map(stripTier), risks, contracts, coveragePct, budgetUsd: Number.MAX_SAFE_INTEGER, crossCheck: false, now })
    : { lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0 };
  const tierOf = new Map(allLegs.map((l) => [`${l.riskId}|${l.contractId}`, l.tier]));
  const options: NonNullable<Quote["options"]> = [];
  for (const risk of risks) {
    const legs = choicesByRisk.get(risk.id);
    if (!legs) continue;
    const hasLadder = legs.some((l) => l.tier === "cheap-tail" || l.tier === "broad");
    // the best-price router may re-point a leg to the identical contract on another venue (its rationale gets "(Best price: ...)")
    const sizedFor = (l: TieredLeg) => optSized.lines.find((x) => x.riskId === risk.id && x.contractId === l.contractId)
      ?? optSized.lines.find((x) => x.riskId === risk.id && x.contractId !== l.contractId && x.rationale.startsWith(`${l.rationale} (Best price:`) && !legs.some((o) => o.contractId === x.contractId));
    const choices = legs
      .map((l) => ({ l, x: sizedFor(l) }))
      .filter((p): p is { l: TieredLeg; x: QuoteLine } => !!p.x)
      .filter((p, i, a) => a.findIndex((q) => q.x.contractId === p.x.contractId) === i)
      .map(({ l, x }) => { const t = tierOf.get(`${x.riskId}|${x.contractId}`) ?? l.tier ?? "recommended"; return { ...x, tier: TIER_LABEL[t === "recommended" && hasLadder ? "balanced" : t] ?? t }; });
    if (choices.length) options.push({ riskId: risk.id, choices });
  }
  // default plan = direct risks + creative hedges with a strong/medium link; first choice that sized
  const inDefault = (r: Risk | undefined) => !!r && (r.kind !== "proxy" || r.correlation !== "weak");
  const defaultLegs: HedgeLeg[] = [];
  const usedBy = new Map<string, string>(); // one contract can't hedge two risks in the default plan (no double buying)
  // ... nor one strike ladder (QA cycle 2: Dec snow ">4 in" for one risk and ">6 in" for a proxy of the same exposure)
  const ladderKey = (x: QuoteLine) => (x.contract.peril === "game" ? x.contractId : `ladder:${x.contract.venue}:${x.contract.eventTicker}`);
  const sameMarket: { riskId: string; owner: string }[] = [];
  const usedLines: QuoteLine[] = [];
  const rOf = (id: string) => risks.find((r) => r.id === id);
  // direct risks first, then the bigger loss (QA cycle 2: a proxy duplicate claimed the recession contract, then lost it to the budget)
  const byLoss = [...options].sort((a, b) => (rOf(a.riskId)?.kind === "proxy" ? 1 : 0) - (rOf(b.riskId)?.kind === "proxy" ? 1 : 0)
    || (rOf(b.riskId)?.lossUsd ?? 0) - (rOf(a.riskId)?.lossUsd ?? 0));
  for (const o of byLoss) {
    const r0 = rOf(o.riskId);
    if (!inDefault(r0)) continue;
    const want = Math.ceil(((r0?.lossUsd ?? 0) * coveragePct) / 100);
    // season / month cover: skip a choice whose book is a handful of contracts deep (WCF qualifiers: 4 contracts) when another
    // sizes; a 50-contract book is shallow, not thin (QA cycle 2: that rule swapped exact picks for far tails / broad strikes)
    const thin = (x: QuoteLine) => r0?.horizon !== undefined && x.maxCoverable !== undefined && x.contracts < Math.min(0.25 * want, 25);
    // a loose proxy or a macro bet near a coin flip is a wager, not insurance: options only (QA cycle 2: CPI YES 45c, diesel 45c)
    const coinFlip = (x: QuoteLine) => (r0?.kind === "proxy" || COIN_FLIP_PERILS.has(r0?.peril ?? "")) && x.impliedProb > COIN_FLIP_ASK;
    // the same event on another venue is the same market (QA cycle 3: Chiefs miss-playoffs bought on Gemini and Kalshi)
    const twin = (x: QuoteLine) => usedLines.some((u) => u.contract.venue !== x.contract.venue && findEquivalent(u.contract, u.side, [x.contract])?.match === "same");
    const free = (x: QuoteLine) => !usedBy.has(x.contractId) && !usedBy.has(ladderKey(x)) && !twin(x);
    // judged on the price actually paid at this size, not the top of the book (QA cycle 3: a 0.60 ask walked to 61c)
    // (the option was sized without a budget, so its average only counts once the top of the book is already ~50c)
    const prepaid = (x: QuoteLine) => prepaidLine(r0, x);
    const priced = o.choices.filter((x) => !coinFlip(x) && !prepaid(x));
    if (!priced.length) {
      uncovered.push({ riskId: o.riskId, reason: o.choices.every(prepaid) && !o.choices.some(coinFlip)
        ? `Priced near a coin flip (${Math.round(Math.max(o.choices[0].pricePerContract, o.choices[0].impliedProb) * 100)}¢ per $1 at this size): you would mostly prepay the payout, so it is shown as an option, not put in the plan.`
        : `Priced near a coin flip (${Math.round(o.choices[0].impliedProb * 100)}¢ per $1) for a loose link to your loss: shown as an option, not put in the plan.` });
      continue;
    }
    const c = pickPlanChoice(priced, free, thin, want);
    if (!c) {
      const used = priced.map((x) => usedBy.get(x.contractId) ?? usedBy.get(ladderKey(x))).find((x) => x);
      sameMarket.push({ riskId: o.riskId, owner: used ?? "" });
      continue;
    }
    usedBy.set(c.contractId, c.riskId); usedBy.set(ladderKey(c), c.riskId); usedLines.push(c);
    defaultLegs.push({ riskId: c.riskId, contractId: c.contractId, side: c.side, rationale: c.rationale, basisRisk: c.basisRisk });
  }
  for (const [rid, legs] of choicesByRisk) {
    if (!options.some((o) => o.riskId === rid) && inDefault(risks.find((r) => r.id === rid))) defaultLegs.push(stripTier(legs[0])); // unsized: let sizing explain why
  }
  const riskIdx = new Map(risks.map((r, i) => [r.id, i]));
  defaultLegs.sort((a, b) => (riskIdx.get(a.riskId) ?? 99) - (riskIdx.get(b.riskId) ?? 99));
  const sized = defaultLegs.length
    ? await deps.sizeQuote({ legs: defaultLegs, risks, contracts, coveragePct, budgetUsd: profile.monthlyBudgetUsd, now })
    : { lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0 };
  const optionTier = new Map(options.flatMap((o) => o.choices.map((c) => [`${c.riskId}|${c.contractId}`, c.tier] as const)));
  const lines = sized.lines.map((l) => ({ ...l, tier: optionTier.get(`${l.riskId}|${l.contractId}`) }));
  const coveredIds = new Set(lines.map((l) => l.riskId));
  // "same market as X" is only true when X's line survived the budget (QA cycle 2: the reason named a risk left uncovered)
  for (const m of sameMarket) {
    const t = rOf(m.owner)?.title ?? "another risk";
    uncovered.push({ riskId: m.riskId, reason: coveredIds.has(m.owner) ? `Same market as "${t}"; that hedge already pays in this scenario.` : `Same market as "${t}", which the budget could not fund either.` });
  }
  for (const u of sized.uncovered) {
    if (!coveredIds.has(u.riskId) && !uncovered.some((x) => x.riskId === u.riskId)) uncovered.push(u);
  }
  uncovered.sort((a, b) => a.riskId.localeCompare(b.riskId, undefined, { numeric: true }));
  await evidenceP;
  marketWordedTriggers(risks, lines);

  const quote: Quote = {
    businessId: profile.id,
    createdAt: now.toISOString(),
    risks,
    lines,
    uncovered,
    totalPremiumUsd: round2(sized.totalPremiumUsd),
    totalPayoutUsd: round2(sized.totalPayoutUsd),
    budgetUsd: profile.monthlyBudgetUsd,
    summary: "",
    model: "",
    options,
    naturalHedges,
    ...(opts.answers ? { clarifications: answers } : {}),
  };
  quote.packages = buildPackages(quote, coveragePct, (x) => { const r = rOf(x.riskId); return prepaidLine(r, x) || ((r?.kind === "proxy" || COIN_FLIP_PERILS.has(r?.peril ?? "")) && x.impliedProb > COIN_FLIP_ASK); });
  // QA #4: the plan shown first IS Plan B (the AI's picks, sized like the plan switcher); skip-priced lines stay out
  settleDefaultPlan(quote, coveragePct as Coverage, new Map(defaultLegs.map((l) => [l.riskId, l.contractId])));
  marketWordedTriggers(risks, quote.lines, quote.options);
  attachForecast(quote, fc); // forecast vs market on weather lines (QuoteLine.forecast)

  // (5) summary
  quote.summary = templateSummary(profile, quote);
  if (Date.now() - t0 < 42_000) {
    try {
      const { data, model } = await deps.llm({
        tier: "fast",
        system: "You write a 2-3 sentence plain-English summary of a hedge quote for a small-business owner. Use the exact numbers given. Mention one creative hedge they might not have thought of ONLY if one is listed in the facts (never invent business advice, business lines or hedges that are not in the facts; quote strikes and prices only as the facts give them), and any natural hedge. Be honest about what is not covered and about basis risk. Name every line in the facts as 'costs $X, pays $Y if ...', and say when market depth caps a line. Never mention analysts or internal steps. Creative proxy hedges are loose links, never 'strong'. No hype, no bullet points.",
        schema: summarySchema,
        prompt: `${pb}\n\nQUOTE FACTS:\n${quoteFacts(quote)}\n\nReturn {"summary":"..."}.`,
        timeoutMs: 15_000,
      });
      quote.summary = data.summary.trim();
      models.add(model);
    } catch { /* keep template */ }
  }

  quote.model = [...models].join(" + ");
  return quote;
}

/** Trims and caps the owner's answers (max 5, short strings, empty answers dropped). */
export function cleanAnswers(xs: ClarifyAnswer[] | undefined): ClarifyAnswer[] {
  return (xs ?? []).map((a) => ({
    questionId: String(a.questionId ?? "").trim().slice(0, 40),
    question: String(a.question ?? "").trim().slice(0, 160),
    answer: String(a.answer ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
    ...(a.label ? { label: String(a.label).trim().slice(0, 30) } : {}),
  })).filter((a) => a.answer && a.question).slice(0, 5);
}

const stripTier = ({ tier: _t, ...l }: TieredLeg): HedgeLeg => l;

/** Backtest the recommended strike for weather risks with hitRate() (best effort, ~5 s cap). */
async function attachEvidence(risks: Risk[], choices: Map<string, TieredLeg[]>, contracts: Map<string, MarketContract>, deps: AdvisorDeps): Promise<void> {
  if (!deps.hitRate) return;
  const jobs = risks.filter((r) => r.peril === "heat" || r.peril === "cold" || r.peril === "rain").map(async (risk) => {
    const leg = choices.get(risk.id)?.[0];
    const c = leg ? contracts.get(leg.contractId) : undefined;
    // Daily-rain history says nothing about a monthly/seasonal rain TOTAL ("Above 5 inches in Nov"): skip it there.
    if (risk.peril === "rain" && c && (/inch/i.test(c.label) || /\b(month|season|in (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i.test(c.eventTitle))) return;
    let peril: Peril = risk.peril, threshold: number | undefined;
    if (risk.peril !== "rain") {
      const b = c && /°F/.test(c.label) ? labelBound(c.label) : null;
      if (!b || b.v === null || b.dir === "range" || !leg) return;
      const paysUp = (b.dir === "up") === (leg.side === "yes");
      peril = paysUp ? "heat" : "cold";
      threshold = paysUp ? (b.dir === "up" ? b.v : b.v + 1) : (b.dir === "down" ? b.v : b.v - 1);
    }
    try {
      const h = await timeout(deps.hitRate!(peril, risk.location ?? "Austin", 30, threshold !== undefined ? { threshold } : {}), 5000);
      const ev = evidenceText({ ...risk, peril }, h);
      if (ev) risk.evidence = ev;
    } catch { /* no evidence */ }
  });
  await Promise.all(jobs);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const COST_PERILS = new Set(["natgas", "oil", "gas", "metals"]);
const ONGOING_COST = /month|monthly|week|weekly|bill|costs?\b|expense|margin|ongoing|season|quarter/i;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may(?=\s*(?:\d|20\d\d))|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;
/** Month indexes (0-11) named in text; "Nov 21 - Nov 22" style day ranges count as that month too. */
export function monthsNamed(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(MONTH_RE)) out.add(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].slice(0, 3).toLowerCase()));
  return out;
}

// parking / tailgates / concessions, and retail "a block from Lambeau Field" or "busy on home games" (QA cycle 4: a Green Bay
// fan shop hedged the Packers' road game at the Rams)
const VENUE_BOUND = /\b(block|blocks|steps|walk|across|next door|next to|near|by|outside)\b[^.]{0,30}(\b(stadium|arena|ballpark|coliseum|dome)\b|\b[A-Z][a-z]+ (Field|Stadium|Arena|Center|Park)\b)/;
const VENUE_BOUND_I = /parking|tailgat|concession|stadium lot|game-?day lot/i;
/** Business whose game-day crowd is physically at the stadium (a lot, a stand, a shop next door); a bar showing away games on TV is not. */
export function venueBound(description: string): boolean {
  if (VENUE_BOUND_I.test(description)) return true;
  if (/\bbars?\b|\bpub\b|tavern|taphouse|watch part|\bTVs?\b|screens?\b|sports bar/i.test(description)) return false;
  return VENUE_BOUND.test(description) || /\bhome games?\b/i.test(description);
}

/**
 * A business open only a few days (weekends) is hedged by a market on THOSE days before a month total that also counts the
 * days it is closed (QA cycle 4: a weekend-only paddle dock got November's rain total; the Nov 21-22 weekend market inside its
 * window was shown as "Other date"). Only when the risk names its days and the busy-day market falls on them.
 */
export function busyDaysFirst<L extends HedgeLeg & { tier: string }>(risk: Risk, legs: L[], cands: MarketContract[], busyDays: string[], now = new Date()): L[] {
  if (!["rain", "cold", "heat", "snow"].includes(risk.peril) || legs.length < 2 || !busyDays.length || busyDays.length > 3) return legs;
  if (!namedDays(`${risk.title} ${risk.trigger} ${risk.window ?? ""}`, now).length) return legs;
  const span = (l: L) => { const m = contractMeta(l.contractId); return m?.eventDate && m.eventEnd ? daysBetweenIso(m.eventDate, m.eventEnd) : 0; };
  if (span(legs[0]) < 7) return legs;
  const j = legs.findIndex((l, i) => {
    const c = cands.find((x) => x.id === l.contractId), d = c && marketDays(c);
    return i > 0 && !!c && !!d && d.every((x) => busyDays.includes(x)) && weatherDayFits(risk, c, now, busyDays) && (askFor(l, cands) ?? 1) <= PREPAY_ASK;
  });
  if (j < 0) return legs;
  const out = [...legs];
  const [best] = out.splice(j, 1);
  return [{ ...best, tier: "recommended" }, { ...out[0], tier: "broad" }, ...out.slice(1)];
}
const daysBetweenIso = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Calendar days (UTC noon ms) a risk names: "Nov 21", "Nov 21-22", "Nov 19 - 30" (ranges capped at 14 days). */
export function namedDays(text: string, now = new Date()): number[] {
  const y = now.getUTCFullYear(), out: number[] = [];
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*[-–]\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(\d{1,2})\b)?/gi)) {
    const mi = MON.indexOf(m[1].toLowerCase().slice(0, 3)), yy = mi < now.getUTCMonth() - 6 ? y + 1 : y;
    const a = Number(m[2]), b = m[3] ? Number(m[3]) : a;
    const last = b >= a ? Math.min(b, a + 14) : a;
    for (let d = a; d <= last; d++) out.push(Date.UTC(yy, mi, d, 12));
  }
  return [...new Set(out)];
}

/** A one-day / weekend weather contract fits an event risk only on a day the risk names; longer contracts (month totals) pass. */
export function weatherDayFits(risk: Risk, c: MarketContract, now = new Date(), busyDays: string[] = []): boolean {
  let days = namedDays(`${risk.title} ${risk.trigger} ${risk.window ?? ""}`, now);
  if (!days.length) return true;
  // a range ("Nov 26-29") counts only on the business's busy days in it (QA cycle 5: a Fri-Sun tour company's "Nov 26-29"
  // rain risk bought the Thanksgiving-Thursday market)
  if (days.length > 1 && busyDays.length) { const busy = days.filter((d) => busyDays.includes(DOW[new Date(d).getUTCDay()])); if (busy.length) days = busy; }
  const m = contractMeta(c.id);
  const start = m?.eventDate ? Date.parse(`${m.eventDate}T00:00:00Z`) : NaN;
  const end = m?.eventEnd ? Date.parse(`${m.eventEnd}T23:59:59Z`) : start + 86_399_000;
  if (!Number.isFinite(start) || end - start > 4 * 86_400_000) return true;
  return days.some((d) => d >= start && d <= end);
}
/** A single-game contract fits an event game risk: same day (+-1) when the risk names one; home game for a venue-bound lot. */
export function gameFits(risk: Risk, c: MarketContract, profile: BusinessProfile, now = new Date()): boolean {
  if (!/\s(vs\.?|v\.?|at|@)\s/i.test(c.eventTitle)) return true; // season futures etc.: other guards
  const y = now.getUTCFullYear();
  const named = [...`${risk.title} ${risk.trigger} ${risk.window ?? ""}`.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi)]
    .map((m) => { const mi = MON.indexOf(m[1].toLowerCase().slice(0, 3)); return Date.UTC(mi < now.getUTCMonth() - 6 ? y + 1 : y, mi, Number(m[2]), 12); });
  const day = contractMeta(c.id)?.eventDate;
  const t = day ? Date.parse(`${day}T12:00:00Z`) : NaN;
  if (named.length && Number.isFinite(t) && !named.some((d) => Math.abs(d - t) <= 1.5 * 86_400_000)) return false;
  // a venue-bound business, or a risk that itself says "home game", needs the team at home (demo QA: "Spurs lose home game
  // vs Sacramento" was hedged with San Antonio AT Sacramento)
  if (venueBound(profile.description) || /\bhome\b/i.test(`${risk.title} ${risk.trigger}`)) {
    const g = gameSides(c);
    // OUR team: the one the business names (the risk text also names the opponent: "Pelicans beat the Spurs");
    // fall back to the first team in the risk title
    const fromBiz = ownTeamsIn(profile.description);
    const own = fromBiz.length ? fromBiz : ownTeamsIn(risk.title).slice(0, 1);
    if (g && own.length) {
      const away = g.away.toLowerCase();
      if (own.some((o) => o.names.some((n) => away.includes(n)) || away.includes(o.nick.toLowerCase()))) return false;
    }
  }
  return true;
}

/** Away / home team of a single-game contract. "A at B" / "A @ B"; Kalshi game events and Gemini sports tickers list the
 *  away team first even when the title says "vs" ("New Orleans vs San Antonio" on Gemini = New Orleans AT San Antonio). */
export function gameSides(c: MarketContract): { away: string; home: string } | null {
  const awayFirst = (c.venue === "kalshi" && /GAME-/i.test(c.eventTicker)) || (c.venue === "gemini" && /^GEMI-(NFL|NBA|NHL|NCAAF|NCAAM|NCAAW|WNBA|MLB)-/i.test(c.symbol || c.id.split(":")[1] || ""));
  const at = c.eventTitle.match(/^(.+?)\s+(?:at|@)\s+(.+?)\??$/i) ?? (awayFirst ? c.eventTitle.match(/^(.+?)\s+vs\.?\s+(.+?)\??$/i) : null);
  return at ? { away: at[1].trim(), home: at[2].trim() } : null;
}

/** Title + trigger for a single-game line, from the contract itself (who must lose, home/away, the real game day): the
 *  risk map is written before matching and guessed dates ("Sun Nov 22 or Mon Nov 23") and venues wrong in demo QA. */
export function gameLineWording(c: MarketContract, side: "yes" | "no"): { title: string; trigger: string } | null {
  if (c.peril !== "game" || contractMeta(c.id)?.futureKind) return null;
  const g = gameSides(c);
  if (!g) return null;
  const label = c.label.replace(/\s+win$/i, "").trim();
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase() || a.toLowerCase().startsWith(b.toLowerCase()) || b.toLowerCase().startsWith(a.toLowerCase());
  const labelIsHome = eq(label, g.home), labelIsAway = eq(label, g.away);
  if (!labelIsHome && !labelIsAway) return null;
  // the side held pays when `loser` loses: YES on X pays when X wins (the other team loses); NO on X pays when X loses
  const loser = side === "yes" ? (labelIsHome ? g.away : g.home) : label;
  const winner = eq(loser, g.home) ? g.away : g.home;
  const league = ((c.symbol || c.id.split(":")[1] || "").match(/^(?:GEMI-|KX)([A-Z]+?)(?:GAME)?-/)?.[1] ?? contractMeta(c.id)?.league ?? "").toUpperCase();
  const nick = (city: string) => OWN_TEAMS.find((o) => (!league || o.league.includes(league)) && o.names.includes(city.toLowerCase()))?.nick ?? city;
  const atHome = eq(loser, g.home);
  const when = gameStartCT(c);
  const day = when ? when.replace(/,\s*\d{1,2}:\d{2}\s*[AP]M\s*CT$/, "") : "";
  const L = nick(loser), W = nick(winner);
  return {
    title: `${L === loser ? L : `The ${L}`} lose ${atHome ? "at home " : ""}to ${W === winner ? W : `the ${W}`}${day ? ` (${day})` : ""}`,
    trigger: `${winner} beats ${loser} at ${g.home}${when ? `, ${when}` : ""}`,
  };
}

/** Local (Central) start of a single game: Gemini sports tickers carry it (GEMI-NBA-2611220100-... = 2026-11-22 01:00 UTC). */
export function gameStartCT(c: MarketContract): string | null {
  const m = (c.symbol || c.id.split(":")[1] || "").match(/^GEMI-[A-Z]+-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/);
  let t: number | null = null;
  if (m) t = Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (t === null) {
    const d = contractMeta(c.id)?.eventDate;
    if (!d) return null;
    return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  }
  return new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
}

/** Economic hedges: show the trigger in the market's own words ("CPI in November: Above 0.1%") so the period/strike
 *  always match the contract (the LLM's paraphrase could name the settlement month instead of the data month). */
const MARKET_WORDED: Peril[] = ["cpi", "fed", "gas", "oil", "natgas", "metals"];
/** Plain trigger for a season future on the side held: "Houston Rockets miss the NBA playoffs", "Houston Texans win fewer than 9 games". */
export function futuresTrigger(c: MarketContract, side: "yes" | "no"): string | null {
  const m = contractMeta(c.id);
  if (!m?.futureKind) return null;
  const longest = [...(m.teams ?? [])].sort((a, b) => b.length - a.length)[0] ?? c.label;
  // "Houston" + NBA -> "Houston Rockets" (the city alone is ambiguous across leagues)
  const own = OWN_TEAMS.find((o) => (!m.league || o.league.includes(m.league)) && o.names.includes(longest.toLowerCase().trim()));
  // "Kansas City" + NFL -> "Kansas City Chiefs" (QA cycle 2: "Kansas City don't host a playoff game")
  const team = own && !own.league.some((l) => l.startsWith("NCAA")) && !longest.toLowerCase().includes(own.nick.toLowerCase()) ? `${own.city} ${own.nick}` : longest;
  const lg = m.league ? `${m.league} ` : "";
  const yes = side === "yes";
  const t = c.eventTitle.replace(/\?$/, "").replace(/^\d{4}\s+/, "").replace(/^Pro Basketball\b/i, "NBA").replace(/^Pro Football\b/i, "NFL")
    .replace(/^College Football\b/i, "college football").replace(/\s+(winner|champion)$/i, "").trim();
  const cw = t.match(/\b(western|eastern|afc|nfc)\b/i)?.[0];
  const conf = cw ? (cw.length === 3 ? cw.toUpperCase() : `${cw[0].toUpperCase()}${cw.slice(1).toLowerCase()} Conference`) : undefined;
  switch (m.futureKind) {
    case "playoffs": return `${team} ${yes ? "make" : "miss"} the ${lg}playoffs`;
    case "round": if (/host/i.test(t)) return `${team} ${yes ? "host" : "don't host"} a playoff game`;
      return /conference finals/i.test(t)
      ? `${team} ${yes ? "reach" : "don't reach"} the ${conf ? `${conf} ` : "Conference "}Finals`.replace("Conference Conference", "Conference")
      : `${team} ${yes ? "advance" : "don't advance"} (${t})`;
    case "conference": return `${team} ${yes ? "win" : "don't win"} the ${conf ?? "conference"} title`;
    case "division": return `${team} ${yes ? "win" : "don't win"} the ${t}`;
    case "title": return `${team} ${yes ? "win" : "don't win"} the ${t.replace(/\s*(national\s+)?championship$/i, "")} title`;
    case "wins": {
      const n = c.label.match(/(\d+)\s*\+?/)?.[1];
      if (!n) return null;
      return /\+|or more|plus/i.test(c.label) ? `${team} win ${yes ? `${n} or more` : `fewer than ${n}`} games` : `${team} ${yes ? "" : "don't "}win exactly ${n} games`.replace(/\s+/g, " ");
    }
  }
  return null;
}

const GENERIC_NAME = /^(home|away|team|game|games|night|nights|loses?|lost|loss|wins?|beats?|this|next|week|weekend|today|tonight|the|our|their|playoffs?|season|football|basketball|hockey|college|saturday|sunday|monday|tuesday|wednesday|thursday|friday|january|february|march|april|june|july|august|september|october|november|december|stadium|arena|field|home-?game|crowd|fans?|local|rival|bowl|lose|loses)$/i;
/** Capitalised names in `text` that are neither in the game contract's matchup nor the risk's own team. */
export function strayNames(text: string, c: MarketContract, r: Pick<Risk, "title" | "trigger">): string[] {
  const ev = `${c.eventTitle} ${c.label}`.toLowerCase();
  const own = ownTeamsIn(`${r.title} ${r.trigger}`).flatMap((t) => [t.nick, t.city, ...t.names]).filter(Boolean).map((x) => x.toLowerCase());
  return [...new Set(text.match(/\b[A-Z][a-zA-Z&.']{3,}\b/g) ?? [])].filter((w) => !GENERIC_NAME.test(w)
    && !ev.includes(w.toLowerCase()) && !own.some((o) => o.split(/\s+/).includes(w.toLowerCase())));
}
/** A single-game trigger in the contract's own teams and date, when the risk's trigger names a team that game does not have. */
export function gameTrigger(r: Risk, c: MarketContract, side: "yes" | "no"): string | null {
  const m = c.eventTitle.match(/^(.+?)\s+(?:vs\.?|v\.?|at|@)\s+(.+?)\??$/i);
  if (!m || !strayNames(r.trigger, c, r).length) return null;
  const [a, b] = [m[1].trim(), m[2].trim()], lab = c.label.trim();
  const other = lab.toLowerCase() === a.toLowerCase() ? b : lab.toLowerCase() === b.toLowerCase() ? a : null;
  if (!other) return null;
  const d = contractMeta(c.id)?.eventDate;
  const when = d ? ` on ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}` : "";
  return side === "yes" ? `${other} lose to ${lab}${when}` : `${lab} lose to ${other}${when}`;
}

const PROMPT_ECHO = /\b(?:the chosen|pick (?:a|the) (?:rung|strike|contract)|rung|(?:label|bracket) offered|priced \d+\s*[-–]\s*\d+\s*(?:cents|¢)|catalogKey)\b/i;

export function marketWordedTriggers(risks: Risk[], lines: QuoteLine[], options: Quote["options"] = []): void {
  for (const r of risks) {
    // an option-only risk names its first choice too (QA cycle 4: trigger "CPI above 3.2%", near-certain, next to a 3.7% option)
    const l = lines.find((x) => x.riskId === r.id && x.contracts > 0) ?? lines.find((x) => x.riskId === r.id) ?? options?.find((o) => o.riskId === r.id)?.choices[0];
    // no line to name: drop the echoed aside instead (QA cycle 3: "...above 2 inches (the lowest rung shown)")
    if (!l) { if (PROMPT_ECHO.test(r.trigger ?? "")) r.trigger = r.trigger.replace(/\s*\([^)]*\)/g, (m) => (PROMPT_ECHO.test(m) || /\blabel offered\b|\bshown\b/i.test(m) ? "" : m)).trim(); continue; }
    // season futures: the trigger names the stage the contract actually pays on (a cheaper-tail stage can differ from the risk's wording)
    const gt = r.peril === "game" ? gameLineWording(l.contract, l.side) : null;
    if (gt) { r.trigger = gt.trigger; r.title = gt.title; continue; }
    const ft = r.peril === "game" ? futuresTrigger(l.contract, l.side) : null;
    if (ft) {
      r.trigger = ft;
      // a cheaper/broader stage was chosen ("miss the playoffs" covered by "win fewer than 50 games"): the title names
      // what the cover actually pays on, so the card never promises one event and pays on another
      const kind = contractMeta(l.contract.id)?.futureKind;
      const wanted = stageWanted(r.title);
      if (kind && wanted.length && wanted[0] !== kind) r.title = ft;
      continue;
    }
    // one game: an opponent the contract's game does not have came from another sport's market (QA cycle 5: "Tennessee loses
    // to Coastal Carolina on Sat Nov 21" (a basketball game) next to the LSU-at-Tennessee football line)
    if (r.peril === "game") { const t = gameTrigger(r, l.contract, l.side); if (t) { if (strayNames(r.title, l.contract, r).length) r.title = t; r.trigger = t; continue; } }
    // the LLM sometimes echoes prompt instructions ("the chosen strike (pick a rung priced 5-60 cents)"): name the real contract
    if (!MARKET_WORDED.includes(r.peril) && !PROMPT_ECHO.test(r.trigger ?? "")) continue;
    const c = l.contract;
    const what = l.side === "yes" ? c.label : `not ${c.label}`;
    r.trigger = c.eventTitle && c.eventTitle !== c.label ? `${c.eventTitle.replace(/\?\s*$/, "")}: ${what}` : what;
  }
}

function quoteFacts(q: Quote): string {
  const risk = (id: string) => q.risks.find((r) => r.id === id);
  const lines = q.lines.map((l) => {
    const r = risk(l.riskId);
    const depth = l.maxCoverable !== undefined ? ` Market depth caps this line at ${l.contracts} contracts.` : "";
    return `- ${r?.title}${r?.kind === "proxy" ? ` (CREATIVE proxy hedge, loose link: ${r.causalStory})` : ""}${r?.horizon && r.horizon !== "event" ? ` [${r.horizon}-long cover${l.premiumPerMonth ? `, ~${usd(l.premiumPerMonth)}/month` : ""}]` : ""}: costs ${usd(l.premiumUsd)}, pays ${usd(l.payoutUsd)} if ${l.side === "yes" ? `"${l.contract.label}"` : `NOT "${l.contract.label}"`} (${l.contract.eventTitle}; est. loss ${usd(r?.lossUsd ?? 0)}).${depth} Basis risk: ${l.basisRisk}`;
  });
  const extra = q.risks.filter((r) => r.kind === "proxy" && !q.lines.some((l) => l.riskId === r.id)).map((r) => `- Optional creative hedge (not in plan): ${r.title} (${r.correlation} link)`);
  const unc = q.uncovered.filter((u) => risk(u.riskId)?.kind !== "proxy").map((u) => `- NOT covered: ${risk(u.riskId)?.title} (${u.reason})`);
  const nat = (q.naturalHedges ?? []).map((n) => `- Natural hedge (${n.advice}): ${n.title}: ${n.explanation}`);
  const pk = q.packages?.length ? [`Packages: ${q.packages.map((p) => `${p.name} ${usd(p.totalPremiumUsd)} premium / ${usd(p.totalPayoutUsd)} payout`).join("; ")}.`] : [];
  return [...lines, ...extra, ...unc, ...nat, ...pk, `Total premium ${usd(q.totalPremiumUsd)} of ${usd(q.budgetUsd)} monthly budget; total payout if all trigger ${usd(q.totalPayoutUsd)}.`].join("\n");
}

export function templateSummary(profile: BusinessProfile, q: Quote): string {
  const direct = q.risks.filter((r) => r.kind !== "proxy");
  const creative = q.risks.filter((r) => r.kind === "proxy");
  const top = [...direct].sort((a, b) => b.lossUsd - a.lossUsd)[0];
  const parts = [`We found ${direct.length} risks for ${profile.name}${top ? `; the biggest is "${top.title}" (about ${usd(top.lossUsd)} per occurrence)` : ""}.`];
  const perMonth = q.lines.reduce((s, l) => s + (l.action === "read-only" ? 0 : l.premiumPerMonth ?? l.premiumUsd), 0);
  if (q.lines.length && perMonth < q.totalPremiumUsd - 1) parts.push(`${q.lines.length} hedge${q.lines.length > 1 ? "s" : ""} cost ${usd(q.totalPremiumUsd)} up front; season-long cover is spread over the months it runs, about ${usd(perMonth)} a month against your ${usd(q.budgetUsd)} monthly budget. They pay ${usd(q.totalPayoutUsd)} if every trigger hits.`);
  else if (q.lines.length) parts.push(`${q.lines.length} hedge${q.lines.length > 1 ? "s" : ""} cost ${usd(q.totalPremiumUsd)} of your ${usd(q.budgetUsd)} monthly budget and pay ${usd(q.totalPayoutUsd)} if every trigger hits.`);
  else parts.push("No live market can hedge these risks right now.");
  if (creative.length) parts.push(`We also found ${creative.length} creative hedge${creative.length > 1 ? "s" : ""} you might not have thought of, like "${creative[0].title}".`);
  const uncDirect = q.uncovered.filter((u) => direct.some((r) => r.id === u.riskId));
  if (uncDirect.length) parts.push(`${uncDirect.length} risk${uncDirect.length > 1 ? "s are" : " is"} not covered; see the reasons below. Payouts follow the market's official data, which may not match your exact loss.`);
  return parts.join(" ");
}
