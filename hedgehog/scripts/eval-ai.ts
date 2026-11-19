// AI recommendation eval harness (docs/AI-EVAL.md).
//   npx tsx scripts/eval-ai.ts snapshot                 freeze the live market universe -> .data/eval/markets.json
//   npx tsx scripts/eval-ai.ts run <tag> [--live] [--only a,b] [--playbook] [--live-summary] [--pause ms] [--skip-nollm] [--snap file.json]
// Runs advise() over the benchmark set against the FROZEN market snapshot (candidate search = rankCandidates over
// the snapshot, sizing = real sizeQuote without book fetches), scores every quote deterministically, then repeats
// the run with every LLM call failing (robustness). LLM calls go through a record/replay cache keyed by
// sha256(tier+system+prompt+schema): unchanged prompts replay for free; misses fail (fallback path) unless --live.
// The summary call is never spent live unless --live-summary (it is cosmetic and quota is tiny).
// Relevance grades (0-2 per line) are written by a human/agent reviewer into tests/fixtures/eval-grades.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import "../lib/env";
import { advise, teamWords, type AdvisorDeps } from "../lib/ai/advisor";
import { generateJson, toJsonSchema, type GenerateJson } from "../lib/ai/llm";
import { PRESETS } from "../lib/ai/presets";
import { labelBound } from "../lib/ai/ideas";
import { futuresSide, ownTeamsIn, riskHorizon } from "../lib/ai/horizon";
import type { BusinessProfile, MarketContract, Peril, Quote, QuoteLine, Risk } from "../lib/types";

const ROOT = process.cwd();
const EVAL = path.join(ROOT, ".data/eval");
const SNAP = path.join(EVAL, process.argv.includes("--snap") ? process.argv[process.argv.indexOf("--snap") + 1] : "markets.json"); // --snap markets-v2.json
const LLM_CACHE = path.join(EVAL, "llm-cache.json");
const HIT_CACHE = path.join(EVAL, "hitrate-cache.json");
const GRADES = path.join(ROOT, "tests/fixtures/eval-grades.json");
const readJson = <T,>(p: string, d: T): T => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : d);
const writeJson = (p: string, v: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

// ---------- benchmark set ----------
export function benchmark(): BusinessProfile[] {
  const presets = PRESETS.map(({ fallbackRisks: _f, tagline: _t, ...p }) => p as BusinessProfile);
  const extra = readJson<{ businesses: BusinessProfile[] }>(path.join(ROOT, "tests/fixtures/eval-businesses.json"), { businesses: [] }).businesses;
  return [...presets, ...extra];
}

// ---------- snapshot ----------
interface Snapshot { t: string; contracts: MarketContract[]; meta: Record<string, unknown> }
async function snapshot() {
  const m = await import("../lib/markets/index");
  const n = await import("../lib/markets/normalize");
  const contracts = await m.listMarkets({ venues: ["gemini", "kalshi", "polymarket"], futures: true }); // + season futures (lib/markets/futures.ts)
  const meta: Record<string, unknown> = {};
  for (const c of contracts) { const x = n.contractMeta(c.id); if (x) meta[c.id] = x; }
  writeJson(SNAP, { t: new Date().toISOString(), contracts, meta } satisfies Snapshot);
  const by = (k: (c: MarketContract) => string) => Object.entries(contracts.reduce<Record<string, number>>((a, c) => ((a[k(c)] = (a[k(c)] ?? 0) + 1), a), {})).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`snapshot: ${contracts.length} open contracts | ${by((c) => c.venue)} | ${by((c) => c.peril)}`);
}

// ---------- record/replay LLM ----------
type Mode = "live" | "replay" | "off";
interface LlmStats { calls: number; live: number; hits: number; misses: number; failed: number; liveMs: number; models: string[] }
function cachedLlm(mode: Mode, stats: LlmStats, liveSummary: boolean): GenerateJson {
  const cache = readJson<Record<string, { data: unknown; model: string; ms: number; at: string }>>(LLM_CACHE, {});
  return (async (o) => {
    stats.calls++;
    if (mode === "off") { stats.failed++; throw new Error("eval: LLM disabled"); }
    const key = crypto.createHash("sha256").update(`${o.tier}\n${o.system}\n${o.prompt}\n${JSON.stringify(toJsonSchema(o.schema as any))}`).digest("hex").slice(0, 24);
    const hit = cache[key];
    if (hit) { stats.hits++; stats.models.push(hit.model); return { data: o.schema.parse(hit.data), model: hit.model }; }
    stats.misses++;
    const isSummary = o.system.startsWith("You write a 2-3 sentence");
    if (mode !== "live" || (isSummary && !liveSummary)) { stats.failed++; throw new Error("eval: replay miss"); }
    const t = performance.now();
    try {
      const r = await generateJson(o);
      const ms = Math.round(performance.now() - t);
      stats.live++; stats.liveMs += ms; stats.models.push(r.model);
      const fresh = readJson<typeof cache>(LLM_CACHE, {}); // merge (another run may have written)
      fresh[key] = { data: r.data, model: r.model, ms, at: new Date().toISOString() }; cache[key] = fresh[key];
      writeJson(LLM_CACHE, fresh);
      return r;
    } catch (e) { stats.live++; stats.failed++; throw e; }
  }) as GenerateJson;
}

// ---------- deterministic deps over the snapshot ----------
async function snapshotDeps(snap: Snapshot, now: Date, mode: Mode, stats: LlmStats, opts: { playbook: boolean; liveSummary: boolean }): Promise<Partial<AdvisorDeps>> {
  const n = await import("../lib/markets/normalize");
  for (const [id, m] of Object.entries(snap.meta)) n.setMeta(id, m as any);
  const m = await import("../lib/markets/index");
  const q = await import("../lib/markets/quote");
  const universe = snap.contracts.filter((c) => c.venue !== "polymarket");
  const hits = readJson<Record<string, unknown>>(HIT_CACHE, {});
  const deps: Partial<AdvisorDeps> = {
    llm: cachedLlm(mode, stats, opts.liveSummary),
    now: () => now,
    listMarkets: async () => universe.map((c) => ({ ...c })),
    findCandidates: async (risk, profile, limit) => m.rankCandidates(risk, profile, snap.contracts, limit, now),
    sizeQuote: (a) => q.sizeQuote({ ...a, fetchBooks: false, crossCheck: false }),
    hitRate: async (peril, location, days, o) => {
      const k = `${peril}|${location}|${days}|${o?.threshold ?? ""}|${now.toISOString().slice(0, 10)}`;
      if (!(k in hits)) { hits[k] = await m.hitRate(peril, location, days, o).catch(() => null); writeJson(HIT_CACHE, hits); }
      return hits[k] as any;
    },
  };
  if (opts.playbook) {
    try {
      const pb = await import("../lib/ai/playbook/index" as string);
      if (typeof pb.playbookIdeas === "function") deps.playbookIdeas = pb.playbookIdeas;
    } catch (e) { console.warn(`playbook not loaded: ${(e as Error).message.slice(0, 100)}`); }
  }
  return deps;
}

// ---------- scoring ----------
const HEURISTIC_NOTE = /Heuristic pick \(AI matcher unavailable\)/;
const DOWN_WORDS = /\b(below|under|drops?|falls?|falling|crash(es)?|lower|declines?|cuts?|dips?|plunges?|slides?)\b|<|≤/i;
type Check = { ok: boolean; why: string[]; sideKnown: boolean };

function contractDir(c: MarketContract, meta: any): "up" | "down" | "range" | "cat" {
  const b = meta?.bounds;
  if (b && (b.lo !== undefined || b.hi !== undefined)) return b.lo !== undefined && b.hi !== undefined ? "range" : b.lo !== undefined ? "up" : "down";
  const lb = labelBound(c.label);
  return lb.dir ?? "cat";
}

/** Does `side` pay when this risk's bad thing happens? null = can't tell deterministically. */
export function paysWhenHurt(risk: Risk, line: { side: "yes" | "no"; contract: MarketContract }, meta: any): boolean | null {
  const c = line.contract; const text = `${risk.title} ${risk.trigger}`;
  if (risk.peril === "game" || c.peril === "game") {
    // season futures on the owner's own team: NO pays on a bad season (miss / early exit / few wins); YES only funds a win promo
    if (meta?.futureKind) {
      const fs = futuresSide(risk, meta, ownTeamsIn(`${risk.title} ${risk.trigger}`));
      if (fs) return line.side === fs;
    }
    // subject = the team before the first win/lose verb ("Texas loses to Arkansas", "Arkansas wins", "Spurs loss to ...")
    const VERB = /\b(lose|loses|losing|loss|lost|defeat(ed)?|beaten|miss(es|ing)?|eliminated|fail(s)? to (make|reach)|knocked out|early exit|run ends|wins?|winning|beats?|victory|does not win|doesn'?t win)\b/i;
    let subject = "", verb = "";
    for (const t of [risk.title, risk.trigger]) { const m = t.match(VERB); if (m && m.index! > 0) { subject = t.slice(0, m.index); verb = m[0].toLowerCase(); break; } }
    if (!subject) return null;
    const lose = /los|defeat|beaten|not win|n't win|miss|eliminat|fail|knocked|exit|ends/.test(verb);
    const win = !lose;
    const words = [...teamWords(subject), ...(subject.match(/\b[A-Z][a-zA-Z&]{2,}\b/g) ?? []).map((w) => w.toLowerCase())].filter((w) => !["the", "home", "game", "night", "big", "major"].includes(w));
    if (!words.length) return null;
    const tokens = new Set(words.flatMap((w) => w.split(/\s+/)));
    const own = c.label.toLowerCase().split(/\s+/).filter(Boolean).every((t) => tokens.has(t)); // "Texas A&M" is not "Texas Longhorns"
    // "<own team> loses": NO on own / YES on opponent; "<team> wins": YES on it / NO on the other
    const wantYes = own ? win : lose;
    return (line.side === "yes") === wantYes;
  }
  if (risk.peril === "rain" || c.peril === "rain") {
    if (/no rain|dry/i.test(c.label)) return line.side === "no";
    return line.side === "yes";
  }
  if (risk.peril === "fed" || c.peril === "fed") {
    const l = c.label.toLowerCase();
    const wantHike = /\bhike|raise|increase/i.test(text) && !/no (rate )?hike/i.test(text);
    const wantNoCut = /no (rate )?cut|hold|pause|higher for longer|doesn'?t cut|not cut|unchanged|stay/i.test(text);
    const isHike = /hike|increase|raise/.test(l), isCut = /cut|decrease|lower/.test(l), isHold = /hold|no change|unchanged|maintain|pause/.test(l);
    if (wantHike && isHike) return line.side === "yes";
    if (wantHike && isCut) return line.side === "no";
    if (wantNoCut && isCut) return line.side === "no";
    if (wantNoCut && isHold) return line.side === "yes";
    if (wantNoCut && isHike) return line.side === "yes";
    const d = contractDir(c, meta);
    const up = wantHike || wantNoCut || !DOWN_WORDS.test(text); // "no cut" / "hike" = rates stay high
    if (d === "up") return line.side === (up ? "yes" : "no");
    if (d === "down") return line.side === (up ? "no" : "yes");
    return null;
  }
  // weather temperature + prices: direction
  const d = contractDir(c, meta);
  let wantUp: boolean;
  if (risk.peril === "heat") wantUp = true;
  else if (risk.peril === "cold") wantUp = false;
  else wantUp = !DOWN_WORDS.test(risk.trigger);
  if (d === "up") return line.side === (wantUp ? "yes" : "no");
  if (d === "down") return line.side === (wantUp ? "no" : "yes");
  if (d === "range") {
    // a YES on a bucket pays only inside it: acceptable only if the bucket sits entirely on the bad side of the trigger
    const b = meta?.bounds; const t = Number((risk.trigger.replace(/,/g, "").match(/-?\d+(\.\d+)?/) ?? [])[0]);
    if (line.side !== "yes" || !b || !Number.isFinite(t)) return false;
    return wantUp ? b.lo >= t - 1 : b.hi <= t + 1;
  }
  return null;
}

const ASSETS: [string, RegExp][] = [
  ["btc", /\bbtc\b|bitcoin/i], ["eth", /\beth\b|ethereum/i], ["sol", /\bsol\b|solana/i], ["xrp", /\bxrp\b/i], ["zec", /\bzec\b|zcash/i], ["doge", /doge/i],
  ["gold", /\bgold\b|\bxau\b/i], ["silver", /silver|\bxag\b/i], ["copper", /copper/i], ["natgas", /natural gas|henry hub|ngas|propane/i],
  ["crude", /\bwti\b|brent|crude|\boil\b/i], ["gasoline", /(?<!natural )\bgas (price|prices)\b|gasoline|pump price/i],
];
const assetsIn = (t: string) => ASSETS.filter(([, re]) => re.test(t)).map(([k]) => k);
/** The contract must track the asset the risk names (gold is not copper, SOL is not BTC). */
export function assetMismatch(risk: Risk, c: MarketContract): boolean {
  const want = assetsIn(`${risk.title} ${risk.trigger}`);
  const have = assetsIn(`${c.eventTitle} ${c.symbol}`);
  return want.length > 0 && have.length > 0 && !have.some((h) => want.includes(h));
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Weather line whose observation days are all outside the owner's busy days (e.g. weekend rain for a Mon-Fri roofer). */
export function offDay(p: BusinessProfile, l: QuoteLine, meta: any): boolean {
  if (!["heat", "cold", "rain"].includes(l.contract.peril) || !p.busyDays.length) return false;
  const start = meta?.eventDate; if (!start) return false;
  const end = meta?.eventEnd ?? start;
  for (let d = Date.parse(`${start}T12:00:00Z`), k = 0; d <= Date.parse(`${end}T12:00:00Z`) && k < 40; d += 86_400_000, k++) if (p.busyDays.includes(DOW[new Date(d).getUTCDay()])) return false;
  return true;
}

function checkLine(risk: Risk, l: QuoteLine, snapIds: Map<string, MarketContract>, now: Date, meta: Record<string, any>, parseWindow: (w: string | undefined, now: Date) => { start: string; end: string }): Check {
  const why: string[] = [];
  const c = snapIds.get(l.contractId);
  if (!c) why.push("id-not-in-universe");
  else {
    if (c.status !== "open") why.push("not-open");
    if (Date.parse(c.expiry) <= now.getTime()) why.push("expired");
  }
  const ask = l.side === "yes" ? l.contract.yesAsk : l.contract.noAsk;
  if (ask == null || ask > 0.85) why.push(`ask>${0.85}`);
  const m = meta[l.contractId];
  if (assetMismatch(risk, l.contract)) why.push("asset-mismatch");
  const pays = paysWhenHurt(risk, l, m);
  if (pays === false) why.push("wrong-side");
  // dates: contract observation window overlaps the risk window (+slack)
  const w = parseWindow(risk.window, now);
  const start = m?.eventDate ?? new Date(l.contract.expiry).toISOString().slice(0, 10);
  const end = m?.eventEnd ?? start;
  const local = ["heat", "cold", "rain"].includes(risk.peril);
  const slack = local ? 1 : risk.peril === "game" ? 3 : 45;
  const addD = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
  if (end < addD(w.start, -slack) || start > addD(w.end, slack)) why.push(`date ${start}..${end} vs ${w.start}..${w.end}`);
  return { ok: why.length === 0, why, sideKnown: pays !== null };
}

const COST_LINK: Partial<Record<Peril, RegExp>> = {
  oil: /fuel|diesel|van|truck|mile|deliver|driv|courier|fleet|freight|asphalt|shingle/i, gas: /fuel|gas|van|truck|mile|deliver|driv|courier|fleet/i,
  fed: /loan|credit|rate|mortgage|debt|financ|refi/i, cpi: /inflation|food cost|price|rate|mortgage|milk|bean/i, crypto: /crypto|btc|bitcoin|sol\b|solana|eth/i,
  other: /natural gas|propane|kitchen|burner|copper|silver|gold|metal|coffee|milk|commod/i,
};

export interface BizScore {
  id: string; risks: number; direct: number; proxy: number; lines: number; choices: number;
  valid: number; checked: number; sideUnknown: number; invalid: string[];
  directCovered: number; directInPlan: number; creative: number; natural: number;
  graded: number; gradeSum: number; ungraded: string[];
  maxAsk: number; premium: number; payout: number; budget: number;
  basisOk: number; basisTotal: number; overstated: string[]; heuristicLines: number; pricey: number; offDay: number;
  llmCalls: number; liveCalls: number; misses: number; seconds: number; model: string; error?: string;
  /** long-horizon metrics (docs/AI-EVAL.md "Long-term & creative hedges loop") */
  hz30: number; seasonElig: number; season: number; period: number; fut: number; futOk: number; perMonth: number; lng7: number;
}

export function scoreQuote(p: BusinessProfile, q: Quote, ctx: { snapIds: Map<string, MarketContract>; now: Date; meta: Record<string, any>; grades: Record<string, number>; parseWindow: any }): BizScore {
  const risk = (id: string) => q.risks.find((r) => r.id === id)!;
  const direct = q.risks.filter((r) => r.kind !== "proxy"), proxy = q.risks.filter((r) => r.kind === "proxy");
  const s: BizScore = { id: p.id, risks: q.risks.length, direct: direct.length, proxy: proxy.length, lines: q.lines.length, choices: 0,
    valid: 0, checked: 0, sideUnknown: 0, invalid: [], directCovered: 0, directInPlan: 0, creative: 0, natural: q.naturalHedges?.length ?? 0,
    graded: 0, gradeSum: 0, ungraded: [], maxAsk: 0, premium: q.totalPremiumUsd, payout: q.totalPayoutUsd, budget: q.budgetUsd,
    basisOk: 0, basisTotal: 0, overstated: [], heuristicLines: 0, pricey: 0, offDay: 0, llmCalls: 0, liveCalls: 0, misses: 0, seconds: 0, model: q.model,
    hz30: 0, seasonElig: SEASON_BIZ.test(p.description) ? 1 : 0, season: 0, period: 0, fut: 0, futOk: 0, perMonth: 0, lng7: 0 };
  const validRisk = new Set<string>();
  const all = [...q.lines.map((l) => ({ l, plan: true })), ...(q.options ?? []).flatMap((o) => o.choices.map((l) => ({ l, plan: false })))];
  const seen = new Set<string>();
  for (const { l, plan } of all) {
    const k = `${l.riskId}|${l.contractId}`;
    if (seen.has(k)) continue; seen.add(k);
    if (!plan) s.choices++;
    const r = risk(l.riskId);
    const ch = checkLine(r, l, ctx.snapIds, ctx.now, ctx.meta, ctx.parseWindow);
    s.checked++;
    if (ch.ok) { s.valid++; if (l.action !== "read-only") validRisk.add(l.riskId); } else s.invalid.push(`${r.id} "${r.title}" ${l.side.toUpperCase()} ${l.contract.label} [${l.contract.eventTitle}]: ${ch.why.join(",")}`);
    if (!ch.sideKnown) s.sideUnknown++;
    const m = ctx.meta[l.contractId];
    if (m?.futureKind) { s.fut++; if (paysWhenHurt(r, l, m) === true) s.futOk++; }
    if (plan && ch.ok && l.action !== "read-only" && longRisk(r, ctx.now, ctx.parseWindow) && (m?.futureKind || periodDays(m) >= 25)) s.season = s.seasonElig ? 1 : 0;
  }
  for (const l of q.lines) {
    const r = risk(l.riskId);
    const ask = (l.side === "yes" ? l.contract.yesAsk : l.contract.noAsk) ?? 1;
    s.maxAsk = Math.max(s.maxAsk, ask);
    if (l.action !== "read-only" && ask > 0.6) s.pricey++;
    if (offDay(p, l, ctx.meta[l.contractId])) s.offDay++;
    const m = ctx.meta[l.contractId];
    const obsEnd = m?.eventEnd ?? m?.eventDate ?? l.contract.expiry.slice(0, 10);
    if (obsEnd > addDay(ctx.now.toISOString().slice(0, 10), 30)) s.hz30++;
    if (["heat", "cold", "rain", "snow"].includes(l.contract.peril) && periodDays(m) >= 25) s.period++;
    s.perMonth += l.action === "read-only" ? 0 : l.premiumPerMonth ?? l.premiumUsd;
    const w = ctx.parseWindow(r.window, ctx.now);
    if (dayDiff(w.start, w.end) <= 14 && obsEnd > addDay(w.end, 30)) s.lng7++;
    s.basisTotal++;
    if (l.basisRisk && l.basisRisk.length >= 25 && !HEURISTIC_NOTE.test(l.basisRisk)) s.basisOk++;
    if (HEURISTIC_NOTE.test(l.basisRisk) || HEURISTIC_NOTE.test(l.rationale)) s.heuristicLines++;
    const gk = `${p.id}|${r.title}|${l.contractId}|${l.side}`;
    if (gk in ctx.grades) { s.graded++; s.gradeSum += ctx.grades[gk]; } else s.ungraded.push(gk);
  }
  s.directCovered = direct.filter((r) => validRisk.has(r.id)).length;
  s.directInPlan = direct.filter((r) => q.lines.some((l) => l.riskId === r.id && l.action !== "read-only")).length;
  s.creative = proxy.filter((r) => validRisk.has(r.id) && (r.causalStory ?? "").length >= 20).length;
  for (const r of proxy) {
    const re = COST_LINK[r.peril];
    if (r.correlation === "strong" && re && !re.test(p.description)) s.overstated.push(`${r.id} "${r.title}" strong ${r.peril} link not grounded in the owner's description`);
  }
  return s;
}

const SEASON_BIZ = /spurs|rockets|mavs|mavericks|texans|cowboys|longhorns|landscap/i;
const addDay = (d: string, k: number) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const periodDays = (m: any) => (m?.eventDate && m?.eventEnd ? dayDiff(m.eventDate, m.eventEnd) : 0);
/** A month/season risk: tagged so, or its window spans >= 25 days. */
function longRisk(r: Risk, now: Date, parseWindow: any): boolean {
  if (r.horizon === "month" || r.horizon === "season" || riskHorizon({ window: r.window }, now) !== "event") return true;
  const w = parseWindow(r.window, now);
  return dayDiff(w.start, w.end) >= 25 && !/next \d+ days|week/i.test(r.window ?? "");
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
function table(rows: BizScore[], title: string): string {
  const h = ["business", "risks d/p", "plan", "valid", "cov", "inPlan", "creat", "nat", "rel", "maxAsk", ">0.6", "offDay", "prem/pay", "budget", "basis", "over", "heur", "hz30", "season", "period", "futSide", "$/mo", "lng7", "llm(live/miss)", "s"];
  const body = rows.map((s) => [s.id.slice(0, 24), `${s.direct}/${s.proxy}`, String(s.lines), pct(s.valid, s.checked), pct(s.directCovered, s.direct), pct(s.directInPlan, s.direct), String(s.creative), String(s.natural),
    s.graded ? (s.gradeSum / s.graded).toFixed(2) : "-", s.maxAsk.toFixed(2), String(s.pricey), String(s.offDay), s.payout ? (s.premium / s.payout).toFixed(2) : "-", pct(s.premium, s.budget), pct(s.basisOk, s.basisTotal), String(s.overstated.length), String(s.heuristicLines),
    pct(s.hz30, s.lines), s.seasonElig ? `${s.season}/1` : "-", String(s.period), s.fut ? pct(s.futOk, s.fut) : "-", pct(s.perMonth, s.budget), String(s.lng7),
    `${s.llmCalls}(${s.liveCalls}/${s.misses})`, s.seconds.toFixed(1)]);
  const T = (k: keyof BizScore) => rows.reduce((a, s) => a + (s[k] as number), 0);
  const tot = ["TOTAL", `${T("direct")}/${T("proxy")}`, String(T("lines")), pct(T("valid"), T("checked")), pct(T("directCovered"), T("direct")), pct(T("directInPlan"), T("direct")), String(T("creative")), String(T("natural")),
    T("graded") ? (T("gradeSum") / T("graded")).toFixed(2) : "-", Math.max(...rows.map((s) => s.maxAsk)).toFixed(2), String(T("pricey")), String(T("offDay")), T("payout") ? (T("premium") / T("payout")).toFixed(2) : "-", pct(T("premium"), T("budget")), pct(T("basisOk"), T("basisTotal")),
    String(rows.reduce((a, s) => a + s.overstated.length, 0)), String(T("heuristicLines")),
    pct(T("hz30"), T("lines")), `${T("season")}/${T("seasonElig")}`, String(T("period")), T("fut") ? pct(T("futOk"), T("fut")) : "-", pct(T("perMonth"), T("budget")), String(T("lng7")), `${T("llmCalls")}(${T("liveCalls")}/${T("misses")})`, T("seconds").toFixed(1)];
  const all = [h, ...body, tot];
  const w = h.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const fmt = (r: string[]) => "| " + r.map((x, i) => x.padEnd(w[i])).join(" | ") + " |";
  return [`### ${title}`, fmt(h), "|" + w.map((x) => "-".repeat(x + 2)).join("|") + "|", ...body.map(fmt), fmt(tot)].join("\n");
}

function digest(q: Quote): string {
  const out: string[] = [`model: ${q.model}`];
  for (const r of q.risks) out.push(`  ${r.id} [${r.kind}/${r.peril}${r.correlation ? "/" + r.correlation : ""}] ${r.title} | ${r.trigger} | ${r.window} | $${r.lossUsd}${r.causalStory ? `\n      story: ${r.causalStory}` : ""}`);
  for (const l of q.lines) out.push(`  PLAN ${l.riskId}: ${l.side.toUpperCase()} "${l.contract.label}" [${l.contract.eventTitle}] ${l.contract.venue} @${l.pricePerContract} x${l.contracts} = $${l.premiumUsd} -> $${l.payoutUsd} (${l.tier ?? ""})\n      why: ${l.rationale}\n      basis: ${l.basisRisk}`);
  for (const o of q.options ?? []) out.push(`  OPT ${o.riskId}: ${o.choices.map((c) => `${c.tier}: ${c.side.toUpperCase()} "${c.contract.label}" [${c.contract.eventTitle}] @${c.pricePerContract}`).join(" | ")}`);
  for (const u of q.uncovered) out.push(`  UNCOVERED ${u.riskId}: ${u.reason}`);
  for (const n of q.naturalHedges ?? []) out.push(`  NATURAL [${n.advice}] ${n.title}: ${n.explanation}`);
  for (const p of q.packages ?? []) out.push(`  PKG ${p.name}: $${p.totalPremiumUsd} -> $${p.totalPayoutUsd} (${p.picks.map((x) => x.riskId).join(",")})`);
  out.push(`  TOTAL $${q.totalPremiumUsd}/${q.budgetUsd} -> $${q.totalPayoutUsd}\n  SUMMARY: ${q.summary}`);
  return out.join("\n");
}

async function run(tag: string) {
  const snap = readJson<Snapshot | null>(SNAP, null);
  if (!snap) throw new Error("no snapshot: run `npx tsx scripts/eval-ai.ts snapshot` first");
  const now = new Date(snap.t);
  const { parseWindow } = await import("../lib/markets/index");
  const only = opt("--only")?.split(",");
  const live = flag("--live");
  const pause = Number(opt("--pause") ?? (live ? 25_000 : 0));
  const grades = readJson<Record<string, number>>(GRADES, {});
  const snapIds = new Map(snap.contracts.map((c) => [c.id, c]));
  const dir = path.join(EVAL, tag);
  const results: { title: string; rows: BizScore[] }[] = [];
  for (const mode of (flag("--skip-nollm") ? [live ? "live" : "replay"] : [live ? "live" : "replay", "off"]) as Mode[]) {
    const rows: BizScore[] = [];
    let first = true;
    for (const p of benchmark().filter((b) => !only || only.includes(b.id))) {
      const stats: LlmStats = { calls: 0, live: 0, hits: 0, misses: 0, failed: 0, liveMs: 0, models: [] };
      if (mode === "live" && !first && pause) await new Promise((r) => setTimeout(r, pause));
      first = false;
      const deps = await snapshotDeps(snap, now, mode, stats, { playbook: flag("--playbook"), liveSummary: flag("--live-summary") });
      const t = performance.now();
      let q: Quote;
      try { q = await advise(p, { deps }); } catch (e) {
        rows.push({ ...scoreQuote(p, { businessId: p.id, createdAt: "", risks: [], lines: [], uncovered: [], totalPremiumUsd: 0, totalPayoutUsd: 0, budgetUsd: p.monthlyBudgetUsd, summary: "", model: "" }, { snapIds, now, meta: snap.meta, grades, parseWindow }), error: (e as Error).message });
        continue;
      }
      const secs = mode === "replay" ? 0 : (performance.now() - t) / 1000;
      const s = scoreQuote(p, q, { snapIds, now, meta: snap.meta as any, grades, parseWindow });
      s.llmCalls = stats.calls; s.liveCalls = stats.live; s.misses = stats.misses; s.seconds = mode === "live" ? secs : stats.liveMs / 1000;
      rows.push(s);
      const sub = mode === "off" ? "nollm" : "main";
      writeJson(path.join(dir, sub, `${p.id}.json`), { quote: q, score: s, llm: stats });
      fs.writeFileSync(path.join(dir, sub, `${p.id}.txt`), `=== ${p.name}\n${digest(q)}\n\nINVALID:\n${s.invalid.join("\n") || "-"}\nOVERSTATED:\n${s.overstated.join("\n") || "-"}\n`);
    }
    results.push({ title: mode === "off" ? `${tag}: all LLM calls failing (fallback path)` : `${tag}: ${mode}`, rows });
  }
  const text = results.map((r) => table(r.rows, r.title)).join("\n\n");
  console.log(text);
  const ungraded = results[0].rows.flatMap((r) => r.ungraded);
  if (ungraded.length) console.log(`\n${ungraded.length} plan lines ungraded (add to tests/fixtures/eval-grades.json):\n${ungraded.join("\n")}`);
  const invalid = results.flatMap((r) => r.rows.flatMap((s) => s.invalid.map((x) => `${r.title.split(":")[1]?.trim()} ${s.id}: ${x}`)));
  if (invalid.length) console.log(`\nINVALID lines:\n${invalid.join("\n")}`);
  writeJson(path.join(dir, "scores.json"), results);
  fs.writeFileSync(path.join(dir, "table.md"), text + "\n");
}

const cmd = args[0];
if (cmd === "snapshot") await snapshot();
else if (cmd === "run") await run(args[1] ?? "adhoc");
else console.log("usage: eval-ai.ts snapshot | run <tag> [--live] [--only a,b] [--playbook] [--live-summary] [--skip-nollm]");
