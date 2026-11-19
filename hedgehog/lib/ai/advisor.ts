// AI decision loop (DESIGN §4): risk map (LLM pro) || creative brainstorm (LLM pro) -> candidates (code)
// -> ONE batched match with tiered choices (LLM fast, candidate-id enforced) + strike ladders (code)
// -> sizing + packages (code) -> summary. At most 4 LLM calls per advise(). Server-only.
import { z } from "zod/v4";
import type { BusinessProfile, HedgeLeg, MarketContract, NaturalHedge, Peril, Quote, QuoteLine, Risk } from "../types";
import { generateJson as defaultLlm, type GenerateJson } from "./llm";
import { getPreset } from "./presets";
import { answersBlock, profileWithAnswers, suppressByAnswers } from "./clarifyRules";
import type { ClarifyAnswer } from "../types";
import {
  BRAINSTORM_SYSTEM, TIER_LABEL, brainstormPrompt, brainstormSchema, buildCatalog, buildPackages, directionalPick, evidenceText,
  fallbackIdeas, filterIdeaCandidates, ideasFromBrainstorm, ideasFromPlaybook, labelBound, ladderChoices, sameExposure, type Idea, type PlaybookSeed, type TieredLeg,
} from "./ideas";
import { futuresFallbackRisks, futuresSide, ownTeamsIn, periodFallbackRisks, riskHorizon, stageWanted } from "./horizon";
import { contractMeta } from "../markets/normalize";
import { noMarketReason, parametricEnabled } from "../markets/proxies";
import { isLongContract, longUniverse, seasonCalendar } from "./longContext";

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
  return {
    playbookIdeas,
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
    return `- ${c.id} | ${c.venue}${c.tradable || (c.venue === "polymarket" && c.status === "open") ? " (buyable)" : " (advice-only)"} | "${c.eventTitle}" | label "${c.label}" | YES ask ${px(c.yesAsk)} / NO ask ${px(c.noAsk)} | ${when}${c.proxyNote ? ` | proxy: ${c.proxyNote}` : ""}`;
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
  }
  return sameExposure(a, b, teamKeys);
}

const STOP = new Set(["lose", "loses", "lost", "game", "home", "night", "their", "next", "with", "against", "this", "week", "match"]);

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
    legs.push({ riskId, contractId: id, side: p.side, rationale: p.rationale.trim(), basisRisk: p.basisRisk.trim() });
  }
  return { legs, dropped };
}

const DOWN_RE = /\b(below|under|drops?|falls?|falling|crash(es)?|lower|declines?|dips?|plunges?|slides?)\b|<|≤/i;
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
  const wantUp = risk.peril === "heat" ? true : risk.peril === "cold" ? false : !DOWN_RE.test(risk.trigger);
  if (b.dir === "range") {
    if (leg.side === "no") return null;
    // YES on a bucket only if the whole bucket is on the bad side of the trigger ("45-46°F" does not pay for "low <= 44°F")
    const [lo, hi] = (c.label.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const t = Number((risk.trigger.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/) ?? [])[0]);
    if (!Number.isFinite(t) || hi === undefined) return leg;
    return (wantUp ? lo >= t - 1 : hi <= t + 1) ? leg : null;
  }
  if (b.dir !== "up" && b.dir !== "down") return leg;
  const side: "yes" | "no" = (b.dir === "up") === wantUp ? "yes" : "no";
  if (side === leg.side) return leg;
  const ask = side === "yes" ? c.yesAsk : c.noAsk;
  if (ask == null || ask > 0.85) return null;
  return { ...leg, side, rationale: `${leg.rationale} (Side corrected to ${side.toUpperCase()}: that is the side that pays when ${wantUp ? "it goes above" : "it stays below"} "${c.label}".)` };
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
    const own = open.find((c) => words.some((w) => c.label.toLowerCase().includes(w)) && ok(win ? c.yesAsk : c.noAsk));
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

/** Macro perils need a hook in the owner's own words (eval iter 4: the risk map kept adding "US gas prices" for a
 *  mortgage broker, a coffee cart and an online merch shop because a gas market exists). */
const GROUNDING: Partial<Record<string, RegExp>> = {
  gas: /fuel|\bgas\b|gasoline|diesel|petrol|\bvans?\b|truck|\bcars?\b|vehicle|\bdriv|deliver|\bmiles?\b|fleet|generator|equipment|haul|tractor|commut|courier|\broutes?\b|boat/i,
  fed: /loan|credit line|line of credit|credit card|mortgage|debt|financ|refi|interest|variable[- ]rate/i, // not bare "rates": "nightly rates" are prices
  cpi: /inflation|food cost|ingredient|price|cost|milk|bean|menu|wholesale|\brates?\b|mortgage/i,
};
GROUNDING.oil = GROUNDING.gas;
export function groundedRisk(peril: string, profile: BusinessProfile): boolean {
  const re = GROUNDING[peril];
  return !re || re.test(profile.description);
}

function sanitizeRisks(raw: z.infer<typeof riskMapSchema>["risks"], profile: BusinessProfile, now = new Date()): Risk[] {
  // an event risk loses at most a week of revenue; a month / season risk (a playoff run, a soaked month) up to 30 days
  const capFor = (window: string) => Math.max(100, profile.avgDailyRevenueUsd * (riskHorizon({ window }, now) === "event" ? 7 : 30));
  const grounded = raw.filter((r) => groundedRisk(r.peril, profile));
  if (grounded.length < raw.length) console.warn(`[advise] dropped ungrounded risks: ${raw.filter((r) => !grounded.includes(r)).map((r) => r.title).join("; ")}`);
  return (grounded.length ? grounded : raw).slice(0, 5).map((r, i) => ({
    id: `r${i + 1}`,
    peril: r.peril,
    title: r.title.trim(),
    trigger: r.trigger.trim(),
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
const RISK_SYSTEM = `You are Hedgehog's risk analyst for small businesses in Austin, TX.
Find the business's worst exposures that a binary prediction market could hedge: near-term bad days AND the season / month exposures the owner really feels (a playoff run that ends early, a soaked month, a fuel bill until contracts reprice, a rate path until a loan resets). Estimate the dollars lost.
Rules:
- Return 3 to 5 risks, most material first.
- Only objective, publicly settled events: official daily high/low temperature, rain, snowfall or snow days, a named team's game result, WTI/Brent oil, US gas or diesel price, natural gas, metals, Texas (ERCOT) power prices/peak demand, lake/river water levels, earthquakes, tornado counts, Fed decision, CPI print. Never "staff quits" or "bad review". ${parametricEnabled() ? 'Flood (river above flood stage), hail (1 inch+ nearby), wildfire (100+ acres nearby) and air quality (AQI above 150, peril "smoke") have no exchange market, but Hedgehog sells parametric cover on them (priced from public history, settled from USGS / NOAA / NIFC / AQI data): list them when they really threaten this business.' : 'Flood, hail, wildfire and air quality (peril "smoke") have no direct market: list them only when they really threaten this business. Code matches them to the closest real market (rain totals, river levels, tornado counts, a dry spell) with a basis-risk note, or marks them not coverable.'}
- peril is one of: heat, cold, rain, snow, game, oil, gas (incl. diesel), natgas, metals, power, water, quake, storm, fed, cpi, crypto, flood, smoke (air quality), hail, wildfire, other.
- trigger is plain English (no venue names or brackets) and reads like a market question with a concrete threshold or team, e.g. "Austin high >= 85°F on Sat Nov 22", "Spurs lose to the Lakers on Fri Nov 21". Use thresholds that fit the season (late-November Austin normal high is ~70°F, record highs mid-80s).
- window: a single event = a date or range inside the next 7 days (dates are given). An exposure that piles up = the period the owner feels: "December", "through the 2026-27 NBA playoffs", "through the Jan 27 2027 FOMC" (the meeting before a loan reprices); use the Season calendar. horizon = event | month | season.
- If the owner mentions a team, playoffs, a busy or booking season, monthly totals, fuel contracts, or a loan / lease / rate reset, include at least 1 month or season risk (see SEASON FUTURES & PERIOD MARKETS). Keep one-off days (a rainy Saturday, this week's game) as event risks.
- Examples: Spurs bar -> "Spurs fail to reach the Western Conference finals" (~5 lost playoff nights); landscaper -> "Austin rain above 5 inches in December"; box-truck fleet -> "Diesel above $5.60 at the end of December"; mortgage broker -> "30-year mortgage rate tops 7% in 2027".
- location is where the event is measured: "Austin", the team's city, or "US".
- lossUsd = revenue lost (or extra cost) per occurrence for an event, grounded in the given average daily revenue and busy days; show the arithmetic in lossReasoning (e.g. "Sat ~1.5x avg = $6,300; 80% patio; -40% => ~$2,000"). One event should rarely exceed two days of revenue. Month / season window: lossUsd = the EXTRA loss in the bad scenario vs a normal one over the whole window (e.g. "~5 home playoff nights x $3,200 lift = $16,000").
- confidence (0..1) = how sure you are that the event causes that loss.
- Align triggers and windows with the LIVE MARKETS (same dates, thresholds and games), but write them in your own plain English: a trigger a live market settles beats a more precise one nobody trades. E.g. if a market asks where it will rain this weekend, write "Rain in Austin this weekend (Nov 21-22)", not ">= 0.25 in on Saturday". Use absolute price thresholds from the market labels, not "+$0.50". Daily weather markets often exist only for today/tomorrow; if the risky day has no market, still list the risk.
- Prefer risks the LIVE MARKETS can hedge, but still include a material risk if no market is listed. Never stretch a one-off exposure (one game, one rainy day) into a season risk.
- Relevance beats coverage: every risk must follow from something the owner said or an obvious trait of the business (outdoor seats, vans, a loan, crypto revenue, game-night crowds). A market existing is NOT a reason to list a risk: no fuel/gas-price risk unless the business buys meaningful fuel (vehicles, generators, equipment); no Fed/CPI risk unless it carries variable-rate debt or its revenue moves with rates/prices.
- Weather risks must land on the owner's BUSY DAYS (or the days it operates). A weekend weather market does not hedge a Monday-Friday business: pick a weekday market or list the risk without one.
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
3. Prefer: date inside the risk window, threshold closest to the trigger, ask between 0.05 and 0.85, ideally 0.10-0.50. An ask above ~0.60 means the bad outcome is already likely, so the owner mostly prepays the payout: make the further-out strike the "recommended" pick and offer the pricey one as "broad". Prefer gemini contracts when they are otherwise equal or close in price (Gemini = our primary venue; kalshi only when Gemini lacks the market). Polymarket candidates are buyable too (best price wins), but prefer gemini/kalshi when prices are close. A candidate with "proxy:" is the closest real market for a risk no market lists directly: pick it only if the note fits the loss, take the side the note describes, and put the note in basisRisk.${parametricEnabled() ? " hedgehog candidates are Hedgehog parametric cover (flood, hail, wildfire, air quality; YES pays when the trigger happens, priced from local history): buyable, use them for those risks." : ""}
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

  // (0) market universe
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

  // (1) risk map || (2) brainstorm
  const [riskRes, ideaRes] = await Promise.allSettled([
    deps.llm({
      tier: "pro",
      system: RISK_SYSTEM,
      schema: riskMapSchema,
      prompt: [
        pb,
        `\nToday is ${today}. Next 7 days: ${nextDays(now).join(", ")}.`,
        all.length ? seasonCalendar(all, profile, now.getTime()) : "",
        universe ? `\nLIVE MARKETS (what can be hedged right now):\n${universe}` : "",
        `\nReturn {"risks":[...]}.`,
      ].join("\n"),
    }),
    deps.llm({ tier: "pro", system: BRAINSTORM_SYSTEM, schema: brainstormSchema, prompt: brainstormPrompt(pb, `${today}. Next 7 days: ${nextDays(now).join(", ")}${all.length ? `\n${seasonCalendar(all, profile, now.getTime())}` : ""}`, catalog, playbook.ideas) }),
  ]);
  let risks: Risk[];
  if (riskRes.status === "fulfilled") {
    risks = sanitizeRisks(riskRes.value.data.risks, profile, now);
    models.add(riskRes.value.model);
  } else {
    console.warn(`[advise] risk map LLM failed, using fallback risks: ${String((riskRes.reason as Error)?.message).slice(0, 200)}`);
    risks = fallbackRisks(profile);
    models.add("fallback-risk-map");
  }
  if (answers.length) {
    const kept0 = suppressByAnswers(risks, answers);
    if (kept0.length < risks.length) console.warn(`[advise] answers ruled out: ${risks.filter((r) => !kept0.includes(r)).map((r) => r.title).join("; ")}`);
    risks = (kept0.length ? kept0 : suppressByAnswers(fallbackRisks(profile), answers)).map((r, i) => ({ ...r, id: `r${i + 1}` }));
  }
  // long horizon (code, no LLM call): a season risk for a crowd business that names its team, a month-total risk for crews
  const longRisks = [...futuresFallbackRisks(profile, all, now), ...periodFallbackRisks(profile, now, all)]
    .map((r, i) => ({ ...r, id: `lh${i}` }) as Risk)
    .filter((x) => !risks.some((r) => r.peril === x.peril && riskHorizon(r, now) !== "event" && (x.peril !== "game" || sameExposureX(r, x))));
  const longKept = answers.length ? suppressByAnswers(longRisks, answers) : longRisks;
  risks = [...risks, ...longKept].map((r, i) => ({ ...r, id: `r${i + 1}` }));
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
  const addIdeas = (xs: Idea[]) => {
    for (const idea of xs) {
      const dup = [...risks, ...kept.map((k) => k.risk)].find((r) => sameExposureX(idea.risk, r));
      if (dup) { console.warn(`[advise] idea "${idea.risk.title}" dropped: same exposure as "${dup.title}"`); continue; }
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
  await Promise.all(risks.map(async (risk) => {
    let cands: MarketContract[] = [];
    try {
      cands = (await deps.findCandidates(risk, profile, 12)).filter((c) => c.status === "open");
    } catch (e) {
      uncovered.push({ riskId: risk.id, reason: `Market search failed: ${(e as Error).message.slice(0, 120)}` });
      return;
    }
    if (!cands.length) {
      uncovered.push({ riskId: risk.id, reason: noMarketReason(risk.peril, `${risk.location ? ` in ${risk.location}` : ""} ${risk.window ? `(${risk.window})` : "this week"}`) });
      return;
    }
    candsByRisk.set(risk.id, cands);
  }));
  const ideaCands = await Promise.all(kept.map(async (idea) => {
    let base: MarketContract[] = [];
    if (idea.fixed) return idea.fixed.filter((c) => c.status === "open" && (c.yesAsk !== null || c.noAsk !== null)).slice(0, 10);
    try { base = await deps.findCandidates(idea.risk, profile, 12); } catch { /* fall back to the catalog */ }
    return filterIdeaCandidates(idea, base, all, now.getTime()).slice(0, 10);
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
      choicesByRisk.set(risk.id, ladderChoices(legs[0], cands, legs, 3));
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
  const byLoss = [...options].sort((a, b) => (risks.find((r) => r.id === b.riskId)?.lossUsd ?? 0) - (risks.find((r) => r.id === a.riskId)?.lossUsd ?? 0));
  for (const o of byLoss) {
    if (!inDefault(risks.find((r) => r.id === o.riskId))) continue;
    // season / month cover: skip a choice whose book is a handful of contracts deep (WCF qualifiers: 4 contracts) when another sizes
    const r0 = risks.find((r) => r.id === o.riskId);
    const want = Math.ceil(((r0?.lossUsd ?? 0) * coveragePct) / 100);
    const thin = (x: QuoteLine) => r0?.horizon !== undefined && x.maxCoverable !== undefined && x.contracts < 0.25 * want;
    const c = o.choices.find((x) => !usedBy.has(x.contractId) && !thin(x)) ?? o.choices.find((x) => !usedBy.has(x.contractId));
    if (!c) {
      uncovered.push({ riskId: o.riskId, reason: `Same market as ${risks.find((r) => r.id === usedBy.get(o.choices[0].contractId))?.title ?? "another risk"}; that hedge already pays in this scenario.` });
      continue;
    }
    usedBy.set(c.contractId, c.riskId);
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
  for (const u of sized.uncovered) {
    if (!coveredIds.has(u.riskId) && !uncovered.some((x) => x.riskId === u.riskId)) uncovered.push(u);
  }
  uncovered.sort((a, b) => a.riskId.localeCompare(b.riskId, undefined, { numeric: true }));
  await evidenceP;

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
  quote.packages = buildPackages(quote, coveragePct);

  // (5) summary
  quote.summary = templateSummary(profile, quote);
  if (Date.now() - t0 < 42_000) {
    try {
      const { data, model } = await deps.llm({
        tier: "fast",
        system: "You write a 2-3 sentence plain-English summary of a hedge quote for a small-business owner. Use the exact numbers given. Mention one creative hedge they might not have thought of ONLY if one is listed in the facts (never invent business advice or hedges that are not in the facts), and any natural hedge. Be honest about what is not covered and about basis risk. No hype, no bullet points.",
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

function quoteFacts(q: Quote): string {
  const risk = (id: string) => q.risks.find((r) => r.id === id);
  const lines = q.lines.map((l) => {
    const r = risk(l.riskId);
    return `- ${r?.title}${r?.kind === "proxy" ? ` (CREATIVE hedge, ${r.correlation} link: ${r.causalStory})` : ""}${r?.horizon && r.horizon !== "event" ? ` [${r.horizon}-long cover${l.premiumPerMonth ? `, ~${usd(l.premiumPerMonth)}/month` : ""}]` : ""}: pay ${usd(l.premiumUsd)} premium for ${usd(l.payoutUsd)} payout (${l.side.toUpperCase()} "${l.contract.label}" on ${l.contract.venue}; est. loss ${usd(r?.lossUsd ?? 0)}). Basis risk: ${l.basisRisk}`;
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
