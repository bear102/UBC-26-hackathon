// AI decision loop (DESIGN §4): risk map (LLM pro) -> candidates (code) -> match (LLM fast,
// candidate-id enforced) -> sizing (code) -> summary. Server-only.
import { z } from "zod/v4";
import type { BusinessProfile, HedgeLeg, MarketContract, Peril, Quote, QuoteLine, Risk } from "../types";
import { generateJson as defaultLlm, type GenerateJson } from "./llm";
import { getPreset } from "./presets";

// ---------- injectable dependencies ----------
export type SizeQuoteFn = (a: {
  legs: HedgeLeg[]; risks: Risk[]; contracts: Map<string, MarketContract>; coveragePct: number; budgetUsd: number;
}) => Promise<{ lines: QuoteLine[]; uncovered: { riskId: string; reason: string }[]; totalPremiumUsd: number; totalPayoutUsd: number }>;

export interface AdvisorDeps {
  llm: GenerateJson;
  findCandidates: (risk: Risk, profile: BusinessProfile, limit?: number) => Promise<MarketContract[]>;
  sizeQuote: SizeQuoteFn;
  /** Optional: live market universe, used to steer the risk map toward hedgeable risks. */
  listMarkets?: (opts?: any) => Promise<MarketContract[]>;
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
    const id = p.contractId.trim();
    const c = byId.get(id);
    if (!c || c.status !== "open" || seen.has(id)) { dropped.push(id); continue; }
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

const MATCH_SYSTEM = `You pick prediction-market contracts that hedge ONE business risk. Each contract is binary: a YES share pays $1 if the label resolves true, a NO share pays $1 if it resolves false.
Rules:
1. contractId MUST be copied exactly from CANDIDATES. Never invent or edit an id.
2. side = the side that PAYS when the bad thing in the risk happens.
   - "Team X loses": teams are often listed by city ("San Antonio" = Spurs, "Houston" = Texans/Rockets). NO on the "Team X" contract, or YES on the opponent's contract (pick the cheaper ask).
   - "high >= T": YES on a threshold contract like "T°F or above" near T. Avoid narrow range buckets ("88-89°F") unless nothing else exists.
   - "cold / high below T": YES on "below T" contracts, or NO on "T or above".
   - Price rising above X: YES on "above X".
3. Prefer: date inside the risk window, threshold closest to the trigger, ask between 0.05 and 0.85, buyable venues when otherwise equal.
4. Imperfect is OK: if a contract pays in most of the scenarios where the loss happens (e.g. "rain this weekend" for "rain Saturday", a nearby threshold, the same team's next game), pick it and explain the gap in basisRisk.
5. Usually return exactly 1 pick; add a 2nd only if it covers a different game or date inside the window (never two strikes of the same event). Return at most 2. Return picks: [] with a short noMatchReason only if no candidate pays in the loss scenario (wrong direction, wrong team, or dates that do not overlap at all).
6. basisRisk: one honest sentence about the mismatch (measured at the airport not the patio, threshold differs from trigger, a loss does not always empty the bar, etc.).
7. rationale: one plain-English sentence a bar owner understands.`;

// ---------- main ----------
export async function advise(profile: BusinessProfile, opts: AdviseOpts = {}): Promise<Quote> {
  const deps = await resolveDeps(opts.deps);
  const coveragePct = opts.coveragePct ?? 50;
  const now = deps.now?.() ?? new Date();
  const models = new Set<string>();

  // (1) risk map
  let universe = "";
  if (deps.listMarkets) {
    try {
      const all = await Promise.race([deps.listMarkets(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
      universe = marketUniverse(all, profile);
    } catch { /* optional context */ }
  }
  let risks: Risk[];
  try {
    const { data, model } = await deps.llm({
      tier: "pro",
      system: RISK_SYSTEM,
      schema: riskMapSchema,
      prompt: [
        profileBlock(profile),
        `\nToday is ${todayLabel(now)}. Next 7 days: ${nextDays(now).join(", ")}.`,
        universe ? `\nLIVE MARKETS (what can be hedged right now):\n${universe}` : "",
        `\nReturn {"risks":[...]}.`,
      ].join("\n"),
    });
    risks = sanitizeRisks(data.risks, profile);
    models.add(model);
  } catch (e) {
    console.warn(`[advise] risk map LLM failed, using fallback risks: ${(e as Error).message.slice(0, 200)}`);
    risks = fallbackRisks(profile);
    models.add("fallback-risk-map");
  }

  // (2) candidates + (3) match, per risk in parallel
  const contracts = new Map<string, MarketContract>();
  const uncovered: { riskId: string; reason: string }[] = [];
  const legsPerRisk = await Promise.all(risks.map(async (risk): Promise<HedgeLeg[]> => {
    let cands: MarketContract[] = [];
    try {
      cands = (await deps.findCandidates(risk, profile, 15)).filter((c) => c.status === "open");
    } catch (e) {
      uncovered.push({ riskId: risk.id, reason: `Market search failed: ${(e as Error).message.slice(0, 120)}` });
      return [];
    }
    if (!cands.length) {
      uncovered.push({ riskId: risk.id, reason: `No live market for ${risk.peril}${risk.location ? ` in ${risk.location}` : ""} ${risk.window ? `(${risk.window})` : "this week"}.` });
      return [];
    }
    for (const c of cands) contracts.set(c.id, c);
    try {
      const { data, model } = await deps.llm({
        tier: "fast",
        system: MATCH_SYSTEM,
        schema: matchSchema,
        prompt: [
          `Business: ${profile.name} (${profile.city}). Busy days: ${profile.busyDays.join(", ")}.`,
          `Today is ${todayLabel(now)}.`,
          `RISK ${risk.id}: ${risk.title}`,
          `Trigger: ${risk.trigger}`,
          `Where: ${risk.location ?? "-"} | When: ${risk.window ?? "next 7 days"} | Loss if it happens: ${usd(risk.lossUsd)}`,
          `\nCANDIDATES (id | venue | event | label | asks | expiry):\n${candidateLines(cands)}`,
          `\nReturn {"picks":[...],"noMatchReason"?:string}.`,
        ].join("\n"),
      });
      models.add(model);
      const { legs, dropped } = enforceCandidates(risk.id, data.picks, cands);
      if (dropped.length) console.warn(`[advise] ${risk.id}: dropped non-candidate picks ${dropped.join(", ")}`);
      if (!legs.length) {
        uncovered.push({ riskId: risk.id, reason: data.noMatchReason?.trim() || "None of the live markets pays out when this loss happens." });
      }
      return legs;
    } catch (e) {
      console.warn(`[advise] ${risk.id}: matcher failed, using heuristic: ${(e as Error).message.slice(0, 200)}`);
      const leg = heuristicPick(risk, cands);
      if (!leg) uncovered.push({ riskId: risk.id, reason: "AI matcher unavailable and no obvious contract found." });
      return leg ? [leg] : [];
    }
  }));
  const legs = legsPerRisk.flat();

  // (4) sizing (code)
  const sized = legs.length
    ? await deps.sizeQuote({ legs, risks, contracts, coveragePct, budgetUsd: profile.monthlyBudgetUsd })
    : { lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0 };
  const coveredIds = new Set(sized.lines.map((l) => l.riskId));
  for (const u of sized.uncovered) {
    if (!coveredIds.has(u.riskId) && !uncovered.some((x) => x.riskId === u.riskId)) uncovered.push(u);
  }
  uncovered.sort((a, b) => a.riskId.localeCompare(b.riskId, undefined, { numeric: true }));

  const quote: Quote = {
    businessId: profile.id,
    createdAt: now.toISOString(),
    risks,
    lines: sized.lines,
    uncovered,
    totalPremiumUsd: round2(sized.totalPremiumUsd),
    totalPayoutUsd: round2(sized.totalPayoutUsd),
    budgetUsd: profile.monthlyBudgetUsd,
    summary: "",
    model: "",
  };

  // (5) summary
  quote.summary = templateSummary(profile, quote);
  try {
    const { data, model } = await deps.llm({
      tier: "fast",
      system: "You write a 2-3 sentence plain-English summary of a hedge quote for a small-business owner. Use the exact numbers given. Be honest about what is not covered and about basis risk. No hype, no bullet points.",
      schema: summarySchema,
      prompt: `${profileBlock(profile)}\n\nQUOTE FACTS:\n${quoteFacts(quote)}\n\nReturn {"summary":"..."}.`,
      timeoutMs: 15_000,
    });
    quote.summary = data.summary.trim();
    models.add(model);
  } catch { /* keep template */ }

  quote.model = [...models].join(" + ");
  return quote;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function quoteFacts(q: Quote): string {
  const risk = (id: string) => q.risks.find((r) => r.id === id);
  const lines = q.lines.map((l) => `- ${risk(l.riskId)?.title}: pay ${usd(l.premiumUsd)} premium for ${usd(l.payoutUsd)} payout (${l.side.toUpperCase()} "${l.contract.label}" on ${l.contract.venue}; est. loss ${usd(risk(l.riskId)?.lossUsd ?? 0)}). Basis risk: ${l.basisRisk}`);
  const unc = q.uncovered.map((u) => `- NOT covered: ${risk(u.riskId)?.title} (${u.reason})`);
  return [...lines, ...unc, `Total premium ${usd(q.totalPremiumUsd)} of ${usd(q.budgetUsd)} monthly budget; total payout if all trigger ${usd(q.totalPayoutUsd)}.`].join("\n");
}

export function templateSummary(profile: BusinessProfile, q: Quote): string {
  const top = [...q.risks].sort((a, b) => b.lossUsd - a.lossUsd)[0];
  const parts = [`We found ${q.risks.length} risks for ${profile.name}${top ? `; the biggest is "${top.title}" (about ${usd(top.lossUsd)} per occurrence)` : ""}.`];
  if (q.lines.length) parts.push(`${q.lines.length} hedge${q.lines.length > 1 ? "s" : ""} cost ${usd(q.totalPremiumUsd)} of your ${usd(q.budgetUsd)} monthly budget and pay ${usd(q.totalPayoutUsd)} if every trigger hits.`);
  else parts.push("No live market can hedge these risks right now.");
  if (q.uncovered.length) parts.push(`${q.uncovered.length} risk${q.uncovered.length > 1 ? "s are" : " is"} not covered; see the reasons below. Payouts follow the market's official data, which may not match your exact loss.`);
  return parts.join(" ");
}
