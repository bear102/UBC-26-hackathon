// Industry playbook: deterministic matching (business text -> industries) and resolution of each idea's
// marketQuery against the live market list. No LLM, no network. Pure and test-safe.
import type { BusinessProfile, MarketContract } from "../../types";
import { INDUSTRIES, PLAYBOOK, REJECTED, type HedgeIdea, type Industry, type MarketQuery } from "./industries";
import { futureLeague } from "../../markets/futures";
import { contractMeta } from "../../markets/normalize";
import { OWN_TEAMS } from "../horizon";

export { INDUSTRIES, PLAYBOOK, REJECTED };
export type { HedgeIdea, Industry, MarketQuery };

// ---------- matching ----------

export interface IndustryMatch { industry: Industry; score: number; matched: string[] }

const reCache = new Map<string, RegExp>();
const re = (src: string) => { let r = reCache.get(src); if (!r) { r = new RegExp(src, "i"); reCache.set(src, r); } return r; };

/** Industries whose keywords appear in the business name + description, best first (score = keyword hits). */
export function matchIndustries(profile: Pick<BusinessProfile, "name" | "description">): IndustryMatch[] {
  const text = `${profile.name ?? ""} . ${profile.description ?? ""}`;
  const out: IndustryMatch[] = [];
  for (const industry of INDUSTRIES) {
    const matched = industry.keywords.filter((k) => re(k).test(text));
    if (matched.length) out.push({ industry, score: matched.length, matched });
  }
  return out.sort((a, b) => b.score - a.score || INDUSTRIES.indexOf(a.industry) - INDUSTRIES.indexOf(b.industry));
}

// ---------- contract helpers ----------

/** Series code of a contract without the normalizer side map: Kalshi series ticker / Gemini series (WXHIGH, BRENT, NBA...). */
export function seriesOf(c: MarketContract): string {
  if (c.venue === "kalshi") return c.eventTicker.split("-")[0].toUpperCase();
  const t = (c.eventTicker || c.symbol.replace(/^GEMI-/, "")).toUpperCase();
  return (t.match(/^[A-Z]+/)?.[0] ?? t);
}

const LOC_ALIASES: Record<string, string[]> = {
  "new york": ["nyc", "new york", "new york city"], washington: ["washington dc", "washington", "dc"],
  "los angeles": ["la", "los angeles"], dallas: ["dallas", "dfw", "dallas-fort worth"], "san antonio": ["san antonio", "satx"],
  "st. louis": ["st. louis", "st louis", "saint louis"],
};
export function normCity(s: string | undefined): string {
  const x = (s ?? "").split(",")[0].trim().toLowerCase();
  for (const [k, al] of Object.entries(LOC_ALIASES)) if (al.includes(x)) return k;
  return x;
}

/** Direction + number in a label: "$93 or above" up, "69°F or below" down, "Above 3.64" up, "74°F to 75°F" range. */
export function labelDir(label: string): { dir: "up" | "down" | "range" | null; v: number | null } {
  const l = label.replace(/,/g, "");
  const m = l.match(/-?\d+(?:\.\d+)?/);
  const v = m ? Number(m[0]) : null;
  if (/or above|or more|or higher|and above|^above\b|^over\b|^more than\b|^≥|^>/i.test(l)) return { dir: "up", v };
  if (/or below|or less|or lower|and below|^below\b|^under\b|^less than\b|^≤|^</i.test(l)) return { dir: "down", v };
  if ((l.match(/-?\d+(?:\.\d+)?/g) ?? []).length >= 2) return { dir: "range", v };
  return { dir: null, v };
}

/** Nickname -> how venues label the team, plus the league code(s) that appear in Gemini symbols / Kalshi series. */
const TEAMS: { re: RegExp; label: string[]; league: string[] }[] = [
  { re: /\bspurs\b/i, label: ["san antonio"], league: ["NBA"] },
  { re: /\brockets\b/i, label: ["houston"], league: ["NBA"] },
  { re: /\bmavericks\b|\bmavs\b/i, label: ["dallas"], league: ["NBA"] },
  { re: /\btexans\b/i, label: ["houston"], league: ["NFL"] },
  { re: /\bcowboys\b/i, label: ["dallas"], league: ["NFL"] },
  { re: /\blonghorns\b/i, label: ["texas"], league: ["NCAAF", "NCAAM"] },
  { re: /\baggies\b|texas a&m/i, label: ["texas a&m"], league: ["NCAAF", "NCAAM"] },
  { re: /\baustin fc\b/i, label: ["austin", "austin fc"], league: ["MLS"] },
  { re: /\bstars\b/i, label: ["dallas"], league: ["NHL"] },
  // every other pro team + big college programs (lib/ai/horizon.ts OWN_TEAMS)
  ...OWN_TEAMS.filter((t) => !/^(Spurs|Rockets|Mavericks|Texans|Cowboys|Longhorns|Stars|Aggies)$/.test(t.nick)).map((t) => ({ re: t.re, label: t.names, league: t.league })),
];
function leagueOf(c: MarketContract): string {
  const s = seriesOf(c);
  return s.startsWith("KX") ? s.replace(/^KX/, "").replace(/GAME$/, "") : s;
}

/** The side that pays when the business is hurt, or null if this contract can't express the idea. */
export function sideFor(q: MarketQuery, c: MarketContract, profileText = ""): "yes" | "no" | null {
  if (q.labelRe && !re(q.labelRe).test(c.label)) return null;
  if (q.hurtWhen === "event") return "yes";
  if (q.hurtWhen === "team-misses") {
    // season future on the owner's team (league from the ticker: "Houston" is the Rockets only in the NBA): NO pays on a short season
    const lg = futureLeague(c.venue === "kalshi" ? c.eventTicker : c.eventTicker || c.symbol);
    if (!lg) return null;
    const lab = c.label.trim().toLowerCase(), title = c.eventTitle.toLowerCase();
    const teams = TEAMS.filter((t) => t.re.test(profileText) && t.league.includes(lg));
    const mine = teams.some((t) => t.label.includes(lab) || (/\bwins?\b/.test(lab) && t.label.some((n) => title.startsWith(`${n} total wins`) || title.includes(`: ${n} total wins`))));
    return mine ? "no" : null;
  }
  if (q.hurtWhen === "team-loses") {
    const lg = leagueOf(c);
    const teams = TEAMS.filter((t) => t.re.test(profileText) && t.league.includes(lg));
    if (!teams.length) return null;
    const lab = c.label.trim().toLowerCase();
    const mine = teams.some((t) => t.label.includes(lab));
    if (mine) return null; // YES on our own team is the wrong side; NO on it is equivalent to opponent YES (minus draws)
    const inGame = teams.some((t) => t.label.some((n) => c.eventTitle.toLowerCase().split(/\s+vs\.?\s+/).map((x) => x.trim()).includes(n)));
    return inGame ? "yes" : null;
  }
  const d = labelDir(c.label);
  if (d.dir === null || d.dir === "range") return null;
  if (q.strike?.min !== undefined && (d.v === null || d.v < q.strike.min)) return null;
  if (q.strike?.max !== undefined && (d.v === null || d.v > q.strike.max)) return null;
  if (q.hurtWhen === "above") return d.dir === "up" ? "yes" : "no";
  return d.dir === "down" ? "yes" : "no";
}

export const askFor = (c: MarketContract, side: "yes" | "no") => (side === "yes" ? c.yesAsk : c.noAsk);
export const MAX_ASK = 0.85;
export const MIN_ASK = 0.02;

export interface ResolvedCandidate { contract: MarketContract; side: "yes" | "no"; ask: number }

/** Live contracts that express one idea, protective side + ask, best first (ask nearest the target, then nearest expiry). */
export function resolveQuery(q: MarketQuery, profile: Pick<BusinessProfile, "city" | "description" | "name">, markets: MarketContract[], now = new Date(), limit = 6): ResolvedCandidate[] {
  const city = normCity(profile.city);
  const text = `${profile.name ?? ""} ${profile.description ?? ""}`;
  const horizon = now.getTime() + (q.maxDays ?? 45) * 86_400_000;
  const series = q.series?.map((s) => s.toUpperCase());
  const out: ResolvedCandidate[] = [];
  if (q.cities && !q.cities.includes(city)) return out; // regional market (ERCOT, Lake Mead, ski towns) for another region
  for (const c of markets) {
    if (c.status !== "open" || !q.venues.includes(c.venue) || !q.perils.includes(c.peril)) continue;
    const exp = Date.parse(c.expiry);
    const obsEnd = contractMeta(c.id)?.eventEnd; // season futures: Kalshi lists placeholder 2029 closes; the outcome is known at eventEnd
    const last = obsEnd ? Math.min(exp, Date.parse(`${obsEnd}T23:00:00Z`)) : exp;
    if (Number.isFinite(exp) && (exp <= now.getTime() + (q.minHours ?? 6) * 3_600_000 || last > horizon)) continue;
    if (series && !series.includes(seriesOf(c))) continue;
    if (q.titleRe && !re(q.titleRe).test(c.eventTitle)) continue;
    if (q.location === "profile-city" && normCity(c.location) !== city) continue;
    if (q.hurtWhen === "event" && q.perils.includes("rain") && normCity(c.label) !== city && normCity(c.location) !== city) continue;
    const side = sideFor(q, c, text);
    if (!side) continue;
    const ask = askFor(c, side);
    if (ask === null || ask < MIN_ASK || ask > MAX_ASK) continue;
    out.push({ contract: c, side, ask });
  }
  const target = q.strike?.targetAsk ?? 0.25;
  // Gemini is the primary venue (priced + backed there): a Kalshi line must be clearly closer to the target to rank first
  // a book known to be a handful of contracts deep is not insurance (Kalshi KXDIESELYE T6.00: 5 contracts at the ask)
  const thin = (x: ResolvedCandidate) => { const d = x.side === "yes" ? x.contract.depthYes : x.contract.depthNo; return d !== undefined && d < 50 ? 0.5 : 0; };
  const dist = (x: ResolvedCandidate) => Math.abs(x.ask - target) + (x.contract.venue === "kalshi" ? 0.05 : 0) + thin(x);
  out.sort((a, b) => dist(a) - dist(b) || Date.parse(a.contract.expiry) - Date.parse(b.contract.expiry));
  // at most 2 strikes per event so different dates/series stay visible
  const perEvent = new Map<string, number>();
  return out.filter((x) => { const n = perEvent.get(x.contract.eventTicker) ?? 0; perEvent.set(x.contract.eventTicker, n + 1); return n < 2; }).slice(0, limit);
}

// ---------- ideas for a business ----------

/** Flattened idea in the shape lib/ai/ideas.ts ideasFromPlaybook() reads (PlaybookSeed.idea). */
export interface PlaybookSeedIdea {
  id: string; industry: string; problem: string; title: string; trigger: string; causalStory: string; peril: HedgeIdea["peril"];
  correlation: HedgeIdea["correlation"]; basisRisk: string; naturalHedgeNote?: string; evidence: string; marketQuery: string;
  side: "yes" | "no"; location: string; window: string; worthIt: string; lossUsd?: number; lossReasoning?: string;
  /** season = a season future (the team's playoffs / wins); else parsed from the window by the advisor. */
  horizon?: "event" | "month" | "season";
}
export interface PlaybookResult { idea: PlaybookSeedIdea; entry: HedgeIdea; candidates: MarketContract[]; sides: Record<string, "yes" | "no"> }

const STRENGTH = { strong: 0, medium: 1, weak: 2 } as const;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const shortDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }); };

/** "through May 31, 2027" from the observation end (season futures: Kalshi lists placeholder 2029 closes), else "until <expiry>". */
function windowFor(c: MarketContract): string {
  const end = contractMeta(c.id)?.eventEnd;
  if (!end) return `until ${shortDate(c.expiry)}`;
  return `through ${new Date(`${end}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}`;
}

function triggerText(e: HedgeIdea, best: ResolvedCandidate, profileText = ""): string {
  const c = best.contract; const d = labelDir(c.label);
  const when = shortDate(c.expiry);
  if (e.marketQuery.hurtWhen === "team-loses") return `${c.label} beats our team (${c.eventTitle}, ${when})`;
  if (e.marketQuery.hurtWhen === "team-misses") {
    // the team this contract is about (league + label): "Boston" on an NHL future is the Bruins, not the Celtics (QA cycle 1)
    const lg = futureLeague(c.venue === "kalshi" ? c.eventTicker : c.eventTicker || c.symbol);
    const lab = c.label.trim().toLowerCase();
    const mine = TEAMS.filter((t) => (!lg || t.league.includes(lg)) && t.label.some((n) => lab === n || lab.startsWith(`${n} `)));
    const nick = mine.map((t) => profileText.match(t.re)?.[0]).find((x) => x) ?? TEAMS.map((t) => profileText.match(t.re)?.[0]).find((x) => x) ?? "Our team";
    return `${nick} fall short of "${c.label}" (${c.eventTitle}, settles ${when}): NO pays`;
  }
  if (e.marketQuery.hurtWhen === "event") return `${c.eventTitle.replace(/\?$/, "")}: ${c.label} (settles ${when})`;
  const v = d.v !== null ? (c.label.includes("$") ? `$${d.v.toLocaleString("en-US")}` : String(d.v)) : c.label;
  const what = c.eventTitle.replace(/\?$/, "");
  if (best.side === "yes") return `${what}: ${c.label}`;
  return e.marketQuery.hurtWhen === "below" ? `${what} falls below ${v} (NO on "${c.label}")` : `${what} rises above ${v} (NO on "${c.label}")`;
}

/**
 * Playbook ideas for this business, resolved against the live markets. Only ideas with at least one live
 * candidate (protective side priced MIN_ASK..MAX_ASK) are returned, strongest link first, max `limit`.
 */
export function playbookIdeas(profile: BusinessProfile, markets: MarketContract[], opts: { now?: Date; limit?: number; perIdea?: number } = {}): PlaybookResult[] {
  const now = opts.now ?? new Date();
  const matches = matchIndustries(profile);
  if (!matches.length) return [];
  const text = `${profile.name} ${profile.description}`;
  const scoreOf = new Map(matches.map((m) => [m.industry.id, m.score]));
  // an idea needs one of its OWN keywords in the owner's words (or city): the industry match alone sold an electrician's
  // copper-wire hedge to a roofer and a rooftop bar (QA cycle 2)
  const kwText = `${text} ${profile.city ?? ""}`;
  const scored = PLAYBOOK.filter((e) => scoreOf.has(e.industry)).map((e) => {
    // a short keyword is a whole word (+ inflections), a longer one a stem (QA cycle 5: "pipe" matched a mortgage "pipeline",
    // "car" a "career"); "refinanc", "excavat" stay stems
    const kw = e.keywords.filter((k) => re(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${k.length <= 4 ? "(?:s|es|d|ed|er|ers|ing)?\\b" : ""}`).test(kwText)).length;
    return { e, kw, s: (scoreOf.get(e.industry) ?? 0) + 2 * kw - STRENGTH[e.correlation] };
  }).filter((x) => x.kw > 0 || !x.e.keywords.length).sort((a, b) => b.s - a.s);

  const out: PlaybookResult[] = [];
  const usedQueries = new Set<string>();
  for (const { e } of scored) {
    const qKey = JSON.stringify(e.marketQuery); // same market for two ideas (e.g. rain): keep the more relevant one
    if (usedQueries.has(qKey)) continue;
    if (out.filter((o) => o.entry.peril === e.peril).length >= 2) continue; // 4 fuel ideas for one van fleet is one exposure, not four
    const res = resolveQuery(e.marketQuery, profile, markets, now, opts.perIdea ?? 6);
    if (!res.length) continue;
    usedQueries.add(qKey);
    const loss = e.lossShareOfDay ? Math.max(10, Math.round((profile.avgDailyRevenueUsd * e.lossShareOfDay) / 10) * 10) : undefined;
    const best = res[0];
    out.push({
      entry: e,
      candidates: res.map((r) => r.contract),
      sides: Object.fromEntries(res.map((r) => [r.contract.id, r.side])),
      idea: {
        id: e.id, industry: e.industry, problem: e.problem, title: e.title, trigger: triggerText(e, best, text), causalStory: e.causalStory,
        peril: e.peril, correlation: e.correlation, basisRisk: e.basisRisk, naturalHedgeNote: e.naturalHedgeNote,
        evidence: e.evidence.map((x) => `${x.claim} (${x.source})`).join(" "), marketQuery: e.marketQuery.describe, side: best.side,
        location: e.marketQuery.location === "profile-city" || e.marketQuery.cities ? profile.city.split(",")[0].trim() : e.marketQuery.location === "team" ? best.contract.eventTitle : "US",
        window: windowFor(best.contract),
        ...(e.marketQuery.hurtWhen === "team-misses" ? { horizon: "season" as const } : {}),
        worthIt: `${e.correlation === "strong" ? "Direct link" : e.correlation === "medium" ? "Real but partial link" : "Loose link; keep it small"}; protective side costs ${Math.round(best.ask * 100)}¢ per $1. ${e.basisRisk}`,
        lossUsd: loss,
        lossReasoning: loss ? `Playbook: ~${Math.round((e.lossShareOfDay ?? 0) * 100)}% of a ${usd(profile.avgDailyRevenueUsd)} day when it hits.` : undefined,
      },
    });
    if (out.length >= (opts.limit ?? 4)) break;
  }
  return out;
}
