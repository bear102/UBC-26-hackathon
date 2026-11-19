// AI decision loop (DESIGN §4): risk map (LLM pro) || creative brainstorm (LLM pro) -> candidates (code)
// -> ONE batched match with tiered choices (LLM fast, candidate-id enforced) + strike ladders (code)
// -> sizing + packages (code) -> summary. At most 4 LLM calls per advise(). Server-only.
import { z } from "zod/v4";
import type { BusinessProfile, HedgeLeg, MarketContract, NaturalHedge, Peril, Quote, QuoteLine, Risk } from "../types";
import { generateJson as defaultLlm, type GenerateJson } from "./llm";
import { getPreset } from "./presets";
import {
  BRAINSTORM_SYSTEM, TIER_LABEL, brainstormPrompt, brainstormSchema, buildCatalog, buildPackages, directionalPick, evidenceText,
  fallbackIdeas, filterIdeaCandidates, ideasFromBrainstorm, ideasFromPlaybook, labelBound, ladderChoices, sameExposure, type Idea, type PlaybookSeed, type TieredLeg,
} from "./ideas";

// ---------- injectable dependencies ----------
export type SizeQuoteFn = (a: {
  legs: HedgeLeg[]; risks: Risk[]; contracts: Map<string, MarketContract>; coveragePct: number; budgetUsd: number; crossCheck?: boolean;
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
  return {
    llm: defaultLlm,
    findCandidates: markets.findCandidates,
    sizeQuote: quote.sizeQuote,
    listMarkets: markets.listMarkets as AdvisorDeps["listMarkets"],
    hitRate: markets.hitRate,
    ...d,
  };
}

export interface AdviseOpts { coveragePct?: number; deps?: Partial<AdvisorDeps> }

// ---------- schemas ----------
export const PERILS = ["heat", "cold", "rain", "game", "oil", "gas", "fed", "cpi", "crypto", "other"] as const satisfies readonly Peril[];

export const riskMapSchema = z.object({
  risks: z.array(z.object({
    peril: z.enum(PERILS),
    title: z.string().min(3).describe("short, e.g. 'Rain on Saturday night'"),
    trigger: z.string().min(3).describe("measurable, market-like condition"),
    location: z.string().describe("where it is measured: 'Austin', 'San Antonio', 'US'"),
    window: z.string().describe("specific date or date range within the next 7 days"),
    lossUsd: z.number().positive().describe("USD lost per occurrence"),
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

function profileBlock(p: BusinessProfile) {
  return [
    `Business: ${p.name}`,
    `Owner says: "${p.description}"`,
    `City: ${p.city}${p.zip ? ` (ZIP ${p.zip})` : ""}`,
    `Average daily revenue: ${usd(p.avgDailyRevenueUsd)}`,
    `Busy days: ${p.busyDays.join(", ") || "not given"}`,
    `Monthly hedge budget: ${usd(p.monthlyBudgetUsd)}`,
  ].join("\n");
}

/** Compact one-line-per-contract candidate list for the matcher prompt. */
export function candidateLines(cands: MarketContract[]): string {
  return cands.map((c) => {
    const exp = new Date(c.expiry);
    const expS = isNaN(exp.getTime()) ? c.expiry : exp.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric" }) + " CT";
    return `- ${c.id} | ${c.venue}${c.tradable ? " (buyable)" : " (advice-only)"} | "${c.eventTitle}" | label "${c.label}" | YES ask ${px(c.yesAsk)} / NO ask ${px(c.noAsk)} | expires ${expS}`;
  }).join("\n");
}

const WEATHER = new Set(["heat", "cold", "rain"]);
/** Summarizes the live market universe (steers the risk map toward risks that can be hedged).
 *  Per peril: event count + up to 6 example events (relevant city/teams first) with a few labels. */
export function marketUniverse(markets: MarketContract[], profile: BusinessProfile, perPeril = 6): string {
  const open = markets.filter((m) => m.status === "open");
  if (!open.length) return "";
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

/** Deterministic pick used only if the matcher LLM is unreachable. Conservative: may return nothing. */
export function heuristicPick(risk: Risk, candidates: MarketContract[]): HedgeLeg | null {
  const open = candidates.filter((c) => c.status === "open");
  const ok = (a: number | null) => a != null && a >= 0.03 && a <= 0.85;
  const note = "Heuristic pick (AI matcher unavailable); review before buying.";
  if (risk.peril === "game") {
    const words = [...(`${risk.title} ${risk.trigger}`.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []), ...teamWords(`${risk.title} ${risk.trigger}`)];
    const own = open.find((c) => words.some((w) => c.label.toLowerCase().includes(w)) && ok(c.noAsk));
    return own ? { riskId: risk.id, contractId: own.id, side: "no", rationale: `Pays if ${own.label} does not win.`, basisRisk: `A loss does not always mean an empty venue. ${note}` } : null;
  }
  const dirRe = risk.peril === "cold" ? /below|under|or less|lower/i : /above|over|or more|higher|at least|≥|>/i;
  const pool = open.filter((c) => dirRe.test(c.label) && ok(c.yesAsk)).sort((a, b) => (a.yesAsk ?? 1) - (b.yesAsk ?? 1));
  const c = pool[0];
  return c ? { riskId: risk.id, contractId: c.id, side: "yes", rationale: `Pays if "${c.eventTitle}" resolves ${c.label}.`, basisRisk: `Threshold and date may not match the trigger exactly. ${note}` } : null;
}

function sanitizeRisks(raw: z.infer<typeof riskMapSchema>["risks"], profile: BusinessProfile): Risk[] {
  const cap = Math.max(100, profile.avgDailyRevenueUsd * 7);
  return raw.slice(0, 5).map((r, i) => ({
    id: `r${i + 1}`,
    peril: r.peril,
    title: r.title.trim(),
    trigger: r.trigger.trim(),
    location: r.location.trim() || undefined,
    window: r.window.trim() || undefined,
    lossUsd: Math.max(10, Math.round(Math.min(r.lossUsd, cap) / 10) * 10),
    lossReasoning: r.lossReasoning.trim(),
    confidence: Math.round(Math.min(1, Math.max(0, r.confidence)) * 100) / 100,
  }));
}

/** Hand-written risks when the LLM fails: preset's map, else a generic weather map scaled to revenue. */
export function fallbackRisks(profile: BusinessProfile): Risk[] {
  const preset = getPreset(profile.presetId) ?? getPreset(profile.id);
  if (preset) return preset.fallbackRisks.map((r) => ({ ...r }));
  const d = profile.avgDailyRevenueUsd;
  return [
    { id: "r1", peril: "rain", title: "Rain on a busy day", trigger: "Measurable rain in Austin on a busy day", location: "Austin", window: "next 7 days", lossUsd: Math.round(d * 0.35 / 10) * 10, lossReasoning: `Assumes ~35% of a ${usd(d)} day is lost to rain-driven no-shows.`, confidence: 0.4 },
    { id: "r2", peril: "heat", title: "Extreme heat", trigger: "Austin daily high >= 90°F", location: "Austin", window: "next 7 days", lossUsd: Math.round(d * 0.15 / 10) * 10, lossReasoning: `Assumes ~15% of a ${usd(d)} day is lost when it is very hot.`, confidence: 0.3 },
    { id: "r3", peril: "cold", title: "Cold snap", trigger: "Austin daily high below 50°F", location: "Austin", window: "next 7 days", lossUsd: Math.round(d * 0.15 / 10) * 10, lossReasoning: `Assumes ~15% of a ${usd(d)} day is lost on a cold day.`, confidence: 0.3 },
  ];
}

// ---------- prompts ----------
const RISK_SYSTEM = `You are Hedgehog's risk analyst for small businesses in Austin, TX.
Find the business's worst NEAR-TERM days that a binary prediction market could hedge, and estimate the dollars lost per occurrence.
Rules:
- Return 3 to 5 risks, most material first.
- Only objective, publicly settled events: official daily high temperature, rain, a named team's game result, WTI/Brent oil or US gas price, Fed decision, CPI print. Never "staff quits" or "bad review".
- peril is one of: heat, cold, rain, game, oil, gas, fed, cpi, crypto, other.
- trigger is plain English (no venue names or brackets) and reads like a market question with a concrete threshold or team, e.g. "Austin high >= 85°F on Sat Nov 22", "Spurs lose to the Lakers on Fri Nov 21". Use thresholds that fit the season (late-November Austin normal high is ~70°F, record highs mid-80s).
- window is a specific date or date range inside the next 7 days (dates are given). Fed/CPI may use the next scheduled release.
- location is where the event is measured: "Austin", the team's city, or "US".
- lossUsd = revenue lost (or extra cost) per occurrence, grounded in the given average daily revenue and busy days. Show the arithmetic in lossReasoning in one or two sentences (e.g. "Sat ~1.5x avg = $6,300; 80% patio; -40% => ~$2,000"). One event should rarely exceed two days of revenue.
- confidence (0..1) = how sure you are that the event causes that loss.
- Align triggers and windows with the LIVE MARKETS (same dates, thresholds and games), but write them in your own plain English: a trigger a live market settles beats a more precise one nobody trades. E.g. if a market asks where it will rain this weekend, write "Rain in Austin this weekend (Nov 21-22)", not ">= 0.25 in on Saturday". Use absolute price thresholds from the market labels, not "+$0.50". Daily weather markets often exist only for today/tomorrow; if the risky day has no market, still list the risk.
- Prefer risks the LIVE MARKETS can hedge, but still include a material risk if no market is listed.`;

const MATCH_SYSTEM = `You pick prediction-market contracts that hedge business risks (several risks at once, each with its own CANDIDATES list). Each contract is binary: a YES share pays $1 if the label resolves true, a NO share pays $1 if it resolves false.
Rules:
1. contractId MUST be copied exactly from THAT risk's CANDIDATES. Never invent or edit an id, never use another risk's candidates.
2. side = the side that PAYS when the bad thing in the risk happens (for a proxy risk: when the driver moves against the business, e.g. crude rises above X).
   - "Team X loses": teams are often listed by city ("San Antonio" = Spurs, "Houston" = Texans/Rockets). NO on the "Team X" contract, or YES on the opponent's contract (pick the cheaper ask).
   - "high >= T": YES on a threshold contract like "T°F or above" near T. Avoid narrow range buckets ("88-89°F") unless nothing else exists.
   - "cold / high below T": YES on "below T" contracts, or NO on "T or above".
   - Price rising above X: YES on "above X" / "X or above". Falling below X: NO on "above X", or YES on "below X".
3. Prefer: date inside the risk window, threshold closest to the trigger, ask between 0.05 and 0.85. Prefer gemini contracts when they are otherwise equal or close in price (Gemini = our primary venue; kalshi only when Gemini lacks the market). Polymarket candidates are context-only (never buyable): pick them only when nothing else fits.
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
export async function advise(profile: BusinessProfile, opts: AdviseOpts = {}): Promise<Quote> {
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
  const universe = all.length ? marketUniverse(all, profile) : "";
  const catalog = all.length ? buildCatalog(all, profile, teamWords(profile.description)) : [];
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
        profileBlock(profile),
        `\nToday is ${today}. Next 7 days: ${nextDays(now).join(", ")}.`,
        universe ? `\nLIVE MARKETS (what can be hedged right now):\n${universe}` : "",
        `\nReturn {"risks":[...]}.`,
      ].join("\n"),
    }),
    deps.llm({ tier: "pro", system: BRAINSTORM_SYSTEM, schema: brainstormSchema, prompt: brainstormPrompt(profileBlock(profile), `${today}. Next 7 days: ${nextDays(now).join(", ")}`, catalog, playbook.ideas) }),
  ]);
  let risks: Risk[];
  if (riskRes.status === "fulfilled") {
    risks = sanitizeRisks(riskRes.value.data.risks, profile);
    models.add(riskRes.value.model);
  } else {
    console.warn(`[advise] risk map LLM failed, using fallback risks: ${String((riskRes.reason as Error)?.message).slice(0, 200)}`);
    risks = fallbackRisks(profile);
    models.add("fallback-risk-map");
  }
  risks = risks.map((r) => ({ ...r, kind: r.kind ?? "direct" }));

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
      const dup = [...risks, ...kept.map((k) => k.risk)].find((r) => sameExposure(idea.risk, r, teamWords));
      if (dup) { console.warn(`[advise] idea "${idea.risk.title}" dropped: same exposure as "${dup.title}"`); continue; }
      kept.push(idea);
    }
  };
  addIdeas([...ideas, ...playbook.ideas]);
  // top up with the hand-written ideas when too few survive or none has a strong link
  if (kept.length < 2 || !kept.some((i) => i.risk.correlation === "strong")) addIdeas(fb.ideas);
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
      uncovered.push({ riskId: risk.id, reason: `No live market for ${risk.peril}${risk.location ? ` in ${risk.location}` : ""} ${risk.window ? `(${risk.window})` : "this week"}.` });
      return;
    }
    candsByRisk.set(risk.id, cands);
  }));
  const ideaCands = await Promise.all(kept.map(async (idea) => {
    let base: MarketContract[] = [];
    if (idea.fixed) return idea.fixed.filter((c) => c.status === "open" && (c.yesAsk !== null || c.noAsk !== null)).slice(0, 10);
    try { base = await deps.findCandidates(idea.risk, profile, 12); } catch { /* fall back to the catalog */ }
    return filterIdeaCandidates(idea, base, all).slice(0, 10);
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
  const heuristic = (risk: Risk): TieredLeg | null => {
    const cands = candsByRisk.get(risk.id)!;
    const leg = risk.kind === "proxy" && risk.peril !== "game" ? directionalPick(risk, cands) : heuristicPick(risk, cands) ?? (risk.peril !== "game" ? directionalPick(risk, cands) : null);
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
        legs = ok.map((l, i) => ({ ...l, tier: i === 0 ? "recommended" : m.picks.find((p) => p.contractId.trim() === l.contractId)?.tier ?? "broad" }));
        if (!legs.length) {
          uncovered.push({ riskId: risk.id, reason: m.noMatchReason?.trim() || "None of the live markets pays out when this loss happens." });
          continue;
        }
      } else {
        const h = heuristic(risk);
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
    ? await deps.sizeQuote({ legs: allLegs.map(stripTier), risks, contracts, coveragePct, budgetUsd: Number.MAX_SAFE_INTEGER, crossCheck: false })
    : { lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0 };
  const tierOf = new Map(allLegs.map((l) => [`${l.riskId}|${l.contractId}`, l.tier]));
  const options: NonNullable<Quote["options"]> = [];
  for (const risk of risks) {
    const legs = choicesByRisk.get(risk.id);
    if (!legs) continue;
    const hasLadder = legs.some((l) => l.tier === "cheap-tail" || l.tier === "broad");
    const choices = legs
      .map((l) => optSized.lines.find((x) => x.riskId === risk.id && x.contractId === l.contractId))
      .filter((x): x is QuoteLine => !!x)
      .map((x) => { const t = tierOf.get(`${x.riskId}|${x.contractId}`) ?? "recommended"; return { ...x, tier: TIER_LABEL[t === "recommended" && hasLadder ? "balanced" : t] ?? t }; });
    if (choices.length) options.push({ riskId: risk.id, choices });
  }
  // default plan = direct risks + creative hedges with a strong/medium link; first choice that sized
  const inDefault = (r: Risk | undefined) => !!r && (r.kind !== "proxy" || r.correlation !== "weak");
  const defaultLegs: HedgeLeg[] = [];
  const usedBy = new Map<string, string>(); // one contract can't hedge two risks in the default plan (no double buying)
  const byLoss = [...options].sort((a, b) => (risks.find((r) => r.id === b.riskId)?.lossUsd ?? 0) - (risks.find((r) => r.id === a.riskId)?.lossUsd ?? 0));
  for (const o of byLoss) {
    if (!inDefault(risks.find((r) => r.id === o.riskId))) continue;
    const c = o.choices.find((x) => !usedBy.has(x.contractId));
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
    ? await deps.sizeQuote({ legs: defaultLegs, risks, contracts, coveragePct, budgetUsd: profile.monthlyBudgetUsd })
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
        prompt: `${profileBlock(profile)}\n\nQUOTE FACTS:\n${quoteFacts(quote)}\n\nReturn {"summary":"..."}.`,
        timeoutMs: 15_000,
      });
      quote.summary = data.summary.trim();
      models.add(model);
    } catch { /* keep template */ }
  }

  quote.model = [...models].join(" + ");
  return quote;
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
    return `- ${r?.title}${r?.kind === "proxy" ? ` (CREATIVE hedge, ${r.correlation} link: ${r.causalStory})` : ""}: pay ${usd(l.premiumUsd)} premium for ${usd(l.payoutUsd)} payout (${l.side.toUpperCase()} "${l.contract.label}" on ${l.contract.venue}; est. loss ${usd(r?.lossUsd ?? 0)}). Basis risk: ${l.basisRisk}`;
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
  if (q.lines.length) parts.push(`${q.lines.length} hedge${q.lines.length > 1 ? "s" : ""} cost ${usd(q.totalPremiumUsd)} of your ${usd(q.budgetUsd)} monthly budget and pay ${usd(q.totalPayoutUsd)} if every trigger hits.`);
  else parts.push("No live market can hedge these risks right now.");
  if (creative.length) parts.push(`We also found ${creative.length} creative hedge${creative.length > 1 ? "s" : ""} you might not have thought of, like "${creative[0].title}".`);
  const uncDirect = q.uncovered.filter((u) => direct.some((r) => r.id === u.riskId));
  if (uncDirect.length) parts.push(`${uncDirect.length} risk${uncDirect.length > 1 ? "s are" : " is"} not covered; see the reasons below. Payouts follow the market's official data, which may not match your exact loss.`);
  return parts.join(" ");
}
