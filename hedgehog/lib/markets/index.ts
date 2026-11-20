// Market layer entry point. Other modules code against these exports only:
//   listMarkets, findCandidates, getContract, hitRate (+ helpers contractMeta, parseBounds, getBook).
import type { BusinessProfile, MarketContract, Peril, QuoteLine, Risk, VenueId } from "../types";
import { ALL_PERILS as PERIL_LIST } from "../types";
import { activeEventsByCategory, eventByTicker, settledEvents } from "./geminiPm";
import { getKalshiContract, kalshiSource, listKalshiMarkets, settledKalshi } from "./dflow";
import { addDays, centralDate, contractMeta, daysBetween, normalizeGeminiEvents, parseBounds, staleSameDay, type Bounds, type ContractMeta } from "./normalize";
import { getBook } from "./book";
import { geminiFutures } from "./futuresFetch";
import { crossCheckLine, getPolymarket, listPolymarkets, type CrossCheck } from "./polymarket";
import { getParametric, isParametricPeril, parametricCandidates } from "./parametric";
import { isNationalPlace, parametricEnabled, PROXIES, proxyFits, proxyNote, proxyPerils, sameState, stormKindScore } from "./proxies";
import { OWN_TEAMS, horizonFit, leagueIn, ownTeamsIn, parseHorizon, stageWanted, type HorizonKind } from "../ai/horizon";

export { contractMeta, parseBounds, getBook, kalshiSource };
export type { Bounds, ContractMeta, CrossCheck };

const TTL = 45_000;
export const NATIONAL_PERILS: Peril[] = ["oil", "gas", "fed", "cpi", "crypto", "game", "other", "storm", "natgas", "metals"];
const ALL_PERILS: Peril[] = [...PERIL_LIST];

// ---------- listMarkets ----------

// Gemini categories per peril. Economics carries Gemini's own Fed / CPI / monthly US gas / GDP / unemployment / recession
// markets (so those hedges stay on Gemini first); Politics only contributes shutdown/funding events (see normalize.ts).
const GEMINI_CATEGORY: Partial<Record<Peril, string[]>> = {
  heat: ["Weather"], cold: ["Weather"], rain: ["Weather"], game: ["Sports"], oil: ["Commodities"], gas: ["Commodities", "Economics"],
  natgas: ["Commodities"], metals: ["Commodities"], other: ["Commodities", "Economics", "Politics"], crypto: ["Crypto"], fed: ["Economics"], cpi: ["Economics"],
};
// On globalThis: Next bundles pages, route handlers and instrumentation separately, so a module-level Map would give
// each its own cold cache. One shared cache lets the background warmer (instrumentation.ts) serve every caller.
type SrcCache = Map<string, { t: number; v: MarketContract[]; p?: Promise<MarketContract[]> }>;
const G = globalThis as { __hhSrcCache?: SrcCache };
const srcCache: SrcCache = (G.__hhSrcCache ??= new Map());

/** Serve a stale (< STALE_MAX) list while a refresh runs in the background: a full Kalshi pass is ~120 series. */
const STALE_MAX = 5 * 60_000;
async function cached(key: string, f: () => Promise<MarketContract[]>): Promise<MarketContract[]> {
  const c = srcCache.get(key);
  if (c && Date.now() - c.t < TTL) return c.v;
  const staleOk = !!c && c.v.length > 0 && Date.now() - c.t < STALE_MAX;
  if (c?.p) return staleOk ? c.v : c.p;
  const p = f().then((v) => {
    if (!v.length && c?.v.length) { srcCache.set(key, { t: c.t, v: c.v }); return c.v; } // empty refresh: keep the last good list
    srcCache.set(key, { t: v.length ? Date.now() : Date.now() - TTL + 30_000, v }); // an empty list is retried in 30 s
    return v;
  })
    .catch((e) => { if (c) { srcCache.set(key, { t: c.t, v: c.v }); return c.v; } srcCache.delete(key); throw e; });
  srcCache.set(key, { t: c?.t ?? 0, v: c?.v ?? [], p });
  return staleOk ? c!.v : p;
}

async function geminiMarkets(perils: Peril[]): Promise<MarketContract[]> {
  const cats = [...new Set(perils.flatMap((p) => GEMINI_CATEGORY[p] ?? []))];
  const res = await Promise.allSettled(cats.map((cat) => cached(`gemini:${cat}`, async () => normalizeGeminiEvents(await activeEventsByCategory(cat)))));
  return res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** `futures`: also fetch Kalshi's season futures series (17 extra requests). Gemini futures ride along whenever games are asked for. */
export async function listMarkets(opts: { perils?: Peril[]; venues?: VenueId[]; includeClosed?: boolean; futures?: boolean } = {}): Promise<MarketContract[]> {
  const perils = opts.perils?.length ? opts.perils : ALL_PERILS;
  // Polymarket is read-only context: opt-in via `venues` (findCandidates asks for it on national perils/games).
  const venues = opts.venues?.length ? opts.venues : (["gemini", "kalshi"] as VenueId[]);
  const parts = await Promise.allSettled([
    venues.includes("gemini") ? geminiMarkets(perils) : Promise.resolve([]),
    venues.includes("kalshi") ? cached(`kalshi:${[...perils].sort().join(",")}${opts.futures ? "|fut" : ""}`, () => listKalshiMarkets(perils, { futures: opts.futures })) : Promise.resolve([]),
    venues.includes("polymarket") ? listPolymarkets(perils) : Promise.resolve([]),
    venues.includes("gemini") && perils.includes("game") ? cached("gemini:futures", geminiFutures) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const out: MarketContract[] = [];
  for (const p of parts) {
    if (p.status !== "fulfilled") continue;
    for (const c of p.value) {
      if (seen.has(c.id) || !perils.includes(c.peril)) continue;
      if (!opts.includeClosed && c.status !== "open") continue;
      seen.add(c.id); out.push(c);
    }
  }
  return out;
}

// ---------- time windows ----------

/** Parse a Risk.window ("next 7 days", "this weekend", "2026-11-21", "Saturday", "November", "through the NBA playoffs") into US-Central dates. */
export function parseWindow(w: string | undefined, now = new Date()): { start: string; end: string; kind?: HorizonKind } {
  const h = parseHorizon(w, now); // months, quarters, seasons (lib/ai/horizon.ts); null for short windows
  if (h) return h;
  const today = centralDate(now);
  const s = (w ?? "").toLowerCase().trim();
  const iso = [...s.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  if (iso.length >= 2) return { start: iso[0] < today ? today : iso[0], end: iso[1] };
  if (iso.length === 1) return { start: iso[0], end: iso[0] };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/next\s+(\d+)\s*day/))) return { start: today, end: addDays(today, Number(m[1])) };
  if ((m = s.match(/next\s+(\d+)\s*week/))) return { start: today, end: addDays(today, 7 * Number(m[1])) };
  if (/today|tonight/.test(s)) return { start: today, end: today };
  if (/tomorrow/.test(s)) return { start: addDays(today, 1), end: addDays(today, 1) };
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun
  if (/weekend/.test(s)) {
    const toSat = (6 - dow + 7) % 7;
    return dow === 0 ? { start: today, end: today } : { start: addDays(today, toSat), end: addDays(today, toSat + 1) };
  }
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const named = days.map((d, i) => (s.includes(d) || s.includes(d.slice(0, 3) + " ") || s === d.slice(0, 3) ? i : -1)).filter((i) => i >= 0);
  if (named.length && !/month|season/.test(s)) {
    const offs = named.map((i) => (i - dow + 7) % 7);
    return { start: addDays(today, Math.min(...offs)), end: addDays(today, Math.max(...offs)) };
  }
  if (/week/.test(s)) return { start: today, end: addDays(today, 7) };
  if (/season/.test(s)) return { start: today, end: addDays(today, 120) };
  if (/month|30 days/.test(s)) return { start: today, end: addDays(today, 30) };
  return { start: today, end: addDays(today, 30) };
}

// ---------- teams ----------

/** Nickname -> how venues name the team (city label) + league. */
export const TEAMS: { re: RegExp; names: string[]; league: string[] }[] = [
  { re: /\bspurs\b/i, names: ["San Antonio", "San Antonio Spurs", "Spurs"], league: ["NBA"] },
  { re: /\brockets\b/i, names: ["Houston", "Houston Rockets", "Rockets"], league: ["NBA"] },
  { re: /\bmavericks\b|\bmavs\b/i, names: ["Dallas", "Dallas Mavericks", "Mavericks"], league: ["NBA"] },
  { re: /\btexans\b/i, names: ["Houston", "Houston Texans", "Texans"], league: ["NFL"] },
  { re: /\bcowboys\b/i, names: ["Dallas", "Dallas Cowboys", "Cowboys"], league: ["NFL"] },
  { re: /\blonghorns\b|\bUT Austin\b|\btexas football\b/i, names: ["Texas", "Texas Longhorns", "Longhorns"], league: ["NCAAF", "NCAAM"] },
  { re: /\baustin fc\b/i, names: ["Austin", "Austin FC"], league: ["MLS"] },
  { re: /\bstars\b/i, names: ["Dallas", "Dallas Stars", "Stars"], league: ["NHL"] },
  // every other pro team + big college programs (lib/ai/horizon.ts OWN_TEAMS): a Boston pub's Celtics, a KC lot's Chiefs
  ...OWN_TEAMS.filter((t) => !/^(Spurs|Rockets|Mavericks|Texans|Cowboys|Longhorns|Stars)$/.test(t.nick)).map((t) => ({ re: t.re, names: t.names, league: t.league })),
];

export function teamsIn(text: string): { names: string[]; league: string[] }[] {
  return TEAMS.filter((t) => t.re.test(text)).map(({ names, league }) => ({ names, league }));
}

function teamMatch(c: MarketContract, meta: ContractMeta | undefined, wanted: { names: string[]; league: string[] }[]): "self" | "opponent" | null {
  if (!meta) return null;
  for (const w of wanted) {
    if (meta.league && !w.league.includes(meta.league)) continue;
    const eq = (xs?: string[]) => (xs ?? []).some((x) => w.names.some((n) => n.toLowerCase() === x.toLowerCase()));
    if (eq(meta.teams)) return "self";
    if (eq(meta.opponents)) return "opponent";
  }
  return null;
}

// ---------- findCandidates ----------

const LOC_ALIASES: Record<string, string[]> = {
  "new york": ["nyc", "new york", "new york city", "brooklyn", "queens", "manhattan", "bronx"], "washington": ["washington dc", "washington", "dc"],
  "los angeles": ["la", "los angeles"], "dallas": ["dallas", "dfw", "dallas-fort worth", "dallas–fort worth"], "san antonio": ["san antonio", "satx"],
  "st. louis": ["st. louis", "st louis", "saint louis"], "minneapolis": ["minneapolis", "minneapolis-st. paul", "st. paul", "bloomington"],
  // satellite cities -> the station city a market settles on (QA cycle 2: "no snow market in Ann Arbor" next to Detroit's ladder)
  "detroit": ["detroit", "ann arbor", "dearborn", "royal oak"], "chicago": ["chicago", "evanston", "oak park"],
  "boston": ["boston", "cambridge", "somerville", "brookline"], "miami": ["miami", "miami beach", "coral gables"],
  "denver": ["denver", "boulder", "aurora", "lakewood"], "seattle": ["seattle", "bellevue", "redmond"],
};
/** Regional markets (a state grid, a lake, a fault zone, a ski town) and the customer cities they cover. */
export const REGIONS: Record<string, string[]> = {
  texas: ["austin", "dallas", "houston", "san antonio", "fort worth", "el paso", "college station", "waco", "round rock", "plano", "arlington", "corpus christi", "lubbock", "texas"],
  california: ["los angeles", "san francisco", "san diego", "san jose", "sacramento", "oakland", "napa", "fresno", "long beach", "mammoth lakes", "california"],
  "lake mead": ["las vegas", "henderson", "boulder city", "lake mead"],
  "lake powell": ["page", "lake powell", "kanab", "st. george"],
  "great salt lake": ["salt lake city", "ogden", "provo", "park city", "great salt lake"],
  "baton rouge": ["baton rouge", "new orleans"],
  "st. louis": ["st. louis", "memphis"],
  "park city": ["park city", "salt lake city"],
  "big sky": ["big sky", "bozeman"],
  "mammoth lakes": ["mammoth lakes", "mammoth"],
  napa: ["napa", "sonoma", "yountville", "st. helena"],
};
/** Does a contract measured at `contractLoc` cover a business in `wanted` (normLoc form)? City match or region membership. */
export function locMatches(contractLoc: string | undefined, wanted: string): boolean {
  const c = normLoc(contractLoc);
  return c === wanted || (REGIONS[c]?.includes(wanted) ?? false) || (REGIONS[wanted]?.includes(c) ?? false);
}
export function normLoc(s: string | undefined): string {
  const x = (s ?? "").split(",")[0].trim().toLowerCase();
  for (const [k, al] of Object.entries(LOC_ALIASES)) if (al.includes(x)) return k;
  return x;
}

/** First number in a trigger like "Austin high >= 98F", "gas above $3.50", "> 0.5 in of rain". */
export function triggerNumber(t: string): number | null {
  const m = t.replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function boundsDistance(b: Bounds | undefined, target: number | null): number | null {
  if (!b || target === null) return null;
  const ref = b.lo ?? b.hi;
  if (ref === undefined) return null;
  return Math.abs(ref - target) / Math.max(1, Math.abs(target));
}

/**
 * Candidate markets for one risk: same peril family, same city for local perils (heat/cold/rain),
 * team match for games, inside the risk window; never closed or settled. Ranked by relevance,
 * liquidity, then nearest expiry. Top Gemini candidates get live book depth attached.
 */
export async function findCandidates(risk: Risk, profile: BusinessProfile, limit = 15): Promise<MarketContract[]> {
  // season futures only when the risk/owner names a team (keeps Kalshi under its rate limit)
  const futures = risk.peril === "game" && teamsIn(`${risk.title} ${risk.trigger} ${profile.description}`).length > 0;
  const all = await listMarkets({ perils: perilFamily(risk.peril), venues: candidateVenues(risk.peril), futures });
  const top = rankCandidates(risk, profile, all, limit);
  await Promise.all(top.map(async (c) => {
    if (c.venue !== "gemini" || c.depthYes !== undefined) return;
    const b = await getBook(c);
    if (!b) return;
    if (c.yesAsk !== null) c.depthYes = b.yes.filter((l) => l.price <= c.yesAsk! + 0.02).reduce((s, l) => s + l.size, 0);
    if (c.noAsk !== null) c.depthNo = b.no.filter((l) => l.price <= c.noAsk! + 0.02).reduce((s, l) => s + l.size, 0);
  }));
  // Hedgehog parametric cover (lib/markets/parametric): only for perils no venue lists, never instead of a real market.
  // OFF by default (user decision: real markets only); HEDGEHOG_PARAMETRIC=1 re-enables. lib/markets/proxies.ts
  if (parametricEnabled() && isParametricPeril(risk.peril) && !top.some((c) => c.peril === risk.peril && c.venue !== "hedgehog")) {
    top.push(...await parametricCandidates(risk, profile, parseWindow(risk.window)).catch(() => []));
  }
  return top;
}

/** Named underlyings in multi-asset perils (crypto coins, metals, energy). A risk that names one only gets contracts on it. */
const UNDERLYINGS: [string, string, RegExp][] = [
  ["btc", "btc", /\bbtc\b|bitcoin/i], ["eth", "eth", /\beth\b|ethereum|\bether\b/i], ["sol", "sol", /\bsol\b|solana/i], ["xrp", "xrp", /\bxrp\b|ripple/i],
  ["zec", "zec", /\bzec\b|zcash/i], ["hype", "hype", /\bhype\b|hyperliquid/i], ["doge", "doge", /\bdoge/i],
  ["gold", "gold", /\bgold\b|\bxau\b/i], ["silver", "silver", /\bsilver\b|\bxag\b/i], ["copper", "copper", /\bcopper\b/i],
  ["natgas", "natgas", /natural gas|henry hub|\bnat ?gas\b|propane/i],
  ["wti", "crude", /\bwti\b/i], ["brent", "crude", /\bbrent\b/i], ["crude", "crude", /\bcrude\b|\boil\b|diesel/i],
  ["gasoline", "gasoline", /(?<!natural )\bgas (price|prices)\b|gasoline|pump price/i],
];
export function underlyings(text: string): { key: string; group: string }[] {
  return UNDERLYINGS.filter(([, , re]) => re.test(text)).map(([key, group]) => ({ key, group }));
}

// "other" still reaches natural gas and metals (they were "other" before they got their own perils).
// hail / flood / wildfire also search their closest real market family (lib/markets/proxies.ts): tornado counts, rain totals.
const perilFamily = (p: Peril): Peril[] => (p === "heat" || p === "cold" ? ["heat", "cold"] : p === "other" ? ["other", "natgas", "metals"] : [p, ...proxyPerils(p)]);
const candidateVenues = (p: Peril): VenueId[] => (POLY_PERILS.includes(p) || PROXIES[p] ? ["gemini", "kalshi", "polymarket"] : ["gemini", "kalshi"]);

/** Pure ranking step of findCandidates over a given market universe (no network; used by the eval harness). */
export function rankCandidates(risk: Risk, profile: BusinessProfile, universe: MarketContract[], limit = 15, nowDate = new Date()): MarketContract[] {
  const family = perilFamily(risk.peril), venues = candidateVenues(risk.peril);
  const all = universe.filter((c) => family.includes(c.peril) && venues.includes(c.venue));
  const now = nowDate.getTime();
  const win = parseWindow(risk.window, nowDate);
  const winDays = daysBetween(win.start, win.end);
  // month / season exposure (a soaked month, a playoff run, the fuel bill until year end): horizon-matched contracts first
  const longWin = risk.horizon === "month" || risk.horizon === "season" || win.kind === "month" || win.kind === "season";
  const stages = longWin && risk.peril === "game" ? stageWanted(`${risk.title} ${risk.trigger}`) : [];
  const owns = longWin && risk.peril === "game" ? ownTeamsIn(`${risk.title} ${risk.trigger} ${profile.description}`) : [];
  const lgWanted = longWin && risk.peril === "game" ? leagueIn(`${risk.title} ${risk.trigger} ${risk.window ?? ""}`) : undefined;
  const local = !NATIONAL_PERILS.includes(risk.peril);
  const loc = normLoc(risk.location || profile.city);
  const text = `${risk.title} ${risk.trigger} ${risk.lossReasoning ?? ""} ${profile.description}`;
  // the nickname names the league ("Eagles" = NFL): a Philadelphia NBA game is not the Eagles' (QA cycle 2)
  const cityName = (risk.location || profile.city).split(",")[0].trim();
  const riskOwn = risk.peril === "game" ? (ownTeamsIn(`${risk.title} ${risk.trigger}`).length ? ownTeamsIn(`${risk.title} ${risk.trigger}`)
    : ownTeamsIn(`${cityName} ${risk.title}. ${cityName} ${risk.trigger}`)) : []; // "Eagles" is ambiguous alone, "Philadelphia Eagles" is not
  const lgOf = (riskOwn.length ? [...new Set(riskOwn.flatMap((t) => t.league))] : (leagueIn(`${risk.title} ${risk.trigger}`) ? [leagueIn(`${risk.title} ${risk.trigger}`)!] : []));
  const wantTeams = risk.peril === "game" && riskOwn.length && !teamsIn(`${risk.title} ${risk.trigger}`).length ? riskOwn.map((t) => ({ names: t.names, league: t.league }))
    : risk.peril === "game" ? teamsIn(`${risk.title} ${risk.trigger}`).length ? teamsIn(`${risk.title} ${risk.trigger}`) : teamsIn(text) : [];
  const target = triggerNumber(risk.trigger);
  const wantU = !["heat", "cold", "rain", "game"].includes(risk.peril) ? underlyings(`${risk.title} ${risk.trigger}`) : [];
  // "other" spans shutdowns, recessions, stock indexes...: the risk's own distinctive words pick the event ("Government shutdown on Dec 12")
  const otherWords = risk.peril === "other" ? [...new Set((`${risk.title} ${risk.trigger}`.toLowerCase().match(/[a-z]{5,}/g) ?? [])
    .filter((w) => !["price", "prices", "above", "below", "business", "occurs", "during", "spike", "drops", "rises", "before", "after", "through", "until"].includes(w)))] : [];
  const named = new Set<string>(); // "other" contracts whose title names the risk's own words

  const scored: { c: MarketContract; s: number; exp: number }[] = [];
  for (const c of all) {
    if (c.status !== "open") continue;
    const exp = Date.parse(c.expiry);
    if (Number.isFinite(exp) && exp <= now) continue;
    if (c.yesAsk === null && c.noAsk === null) continue;
    if (staleSameDay(c, nowDate)) continue; // today's weather after 10 am: already mostly observed
    if (offSeasonHurricane(c, nowDate)) continue;
    // place: city / region match; a statewide market ("Texas" hurricane landfall) covers the state's cities; a nationwide
    // market (US tornado count) only counts for national perils (incl. the storm proxy for hail)
    if (isNationalPlace(c.location) ? local && !NATIONAL_PERILS.includes(c.peril) : !locMatches(c.location, loc) && !sameState(c.location, risk.location || profile.city) && !sameState(c.location, profile.city)) continue;
    if (!proxyFits(risk.peril, c)) continue; // proxy markets only on the side that tracks the loss (wet month for flood, dry for wildfire)
    const meta = contractMeta(c.id);

    // time window
    const evStart = meta?.eventDate ?? (Number.isFinite(exp) ? centralDate(new Date(exp)) : win.start);
    const evEnd = meta?.eventEnd ?? evStart;
    if (evEnd < win.start) continue;
    const gap = evStart > win.end ? daysBetween(win.end, evStart) : 0;
    if (gap > (longWin && winDays >= 30 ? (local ? 7 : 14) : local ? 3 : 45)) continue;
    let s = 3 / (1 + gap / 2);
    if (longWin && risk.peril === "game" && !meta?.futureKind && (risk.horizon === "season" || win.kind === "season")) continue; // a playoff run is not next week's game
    if (longWin) {
      // a price / level printed at the end of the exposure (diesel on Dec 31 for "through December") is the horizon's own measurement
      const endPrint = !local && risk.peril !== "game" && Math.abs(daysBetween(win.end, evEnd)) <= 10;
      s += 2 * (endPrint ? Math.max(0.8, horizonFit({ start: evStart, end: evEnd }, win)) : horizonFit({ start: evStart, end: evEnd }, win));
      if (daysBetween(evStart, evEnd) <= 1 && !endPrint) s -= 1.5; // one day / one game for a month or season exposure
      // no strike named ("diesel stays high"): strikes that are an insurance price on some side before the far tails / sure things
      if (target === null && risk.peril !== "game" && [c.yesAsk, c.noAsk].some((a) => a !== null && a >= 0.1 && a <= 0.6)) s += 1;
      if (meta?.futureKind && stages.length) s += stages.includes(meta.futureKind) ? 2 - stages.indexOf(meta.futureKind) * 0.5 : -1;
      if (meta?.futureKind && meta.league && (lgWanted ? meta.league !== lgWanted : owns.length && !owns.some((o) => o.league.includes(meta.league!)))) continue; // a Longhorns football risk never gets the NCAAM title
    } else if (winDays <= 14 && daysBetween(win.end, evEnd) > 30 && !meta?.futureKind) s -= 1.5; // year-end / season contract for a this-week risk

    // relevance
    if (c.peril === risk.peril) s += 2;
    s += stormKindScore(`${risk.title} ${risk.trigger} ${risk.peril}`, c); // hurricane risk -> landfall markets, hail -> tornado counts
    if (otherWords.length) { const hit = otherWords.filter((w) => c.eventTitle.toLowerCase().includes(w)).length; s += hit ? Math.min(4, 2 * hit) : -2; if (hit) named.add(c.id); }
    if (wantU.length) {
      const have = underlyings(c.eventTitle);
      if (have.length && !have.some((h) => wantU.some((w) => w.group === h.group))) continue; // gold is not copper, SOL is not BTC
      if (have.some((h) => wantU.some((w) => w.key === h.key))) s += 1;                       // WTI risk: WTI before Brent
    }
    if (risk.peril === "game") {
      if (lgOf.length && meta?.league && !lgOf.includes(meta.league)) continue;
      const tm = wantTeams.length ? teamMatch(c, meta, wantTeams) : null;
      if (wantTeams.length && !tm) continue;
      if (tm === "self") s += 3; else if (tm === "opponent") s += 2;
    }
    const d = boundsDistance(meta?.bounds, target);
    if (d !== null) s += 2 / (1 + 10 * d);
    const b = meta?.bounds;
    if (b && target !== null) {
      // YES region on the triggering side of the threshold (">=78F" for "high >= 78F") is the natural hedge
      const lower = risk.peril === "cold" || /\b(below|under|less|lower|drops?|falls?)\b|</i.test(risk.trigger);
      if (!lower && b.lo !== undefined && b.lo >= target - 1e-9) s += 1.5;
      else if (!lower && b.lo !== undefined && b.hi === undefined && b.lo >= target * 0.97) s += 1;
      if (lower && b.hi !== undefined && b.hi <= target + 1e-9 && b.lo === undefined) s += 1.5;
    }
    if (meta?.eventEnd && meta.eventEnd !== meta.eventDate && daysBetween(meta.eventDate ?? win.start, meta.eventEnd) > 7 && daysBetween(win.start, win.end) < 7) s -= 0.5; // monthly market for a short window
    // season future for a short game risk: this week's games first. Keyed on !longWin, not the window length: an unparsed
    // short window ("Nov 23", "Nov 21-22", the LLM's usual format) defaults to 30 days and would otherwise rank futures first
    if (meta?.futureKind && !longWin) s -= 2;

    // liquidity & price sanity
    const depth = Math.max(c.depthYes ?? 0, c.depthNo ?? 0, meta?.volume ?? 0, meta?.openInterest ?? 0);
    s += Math.min(1.5, Math.log10(1 + depth) / 3);
    const spread = c.yesAsk !== null && c.yesBid !== null ? c.yesAsk - c.yesBid : 0.1;
    s -= Math.min(1, spread * 3);
    const cheapest = Math.min(c.yesAsk ?? 1, c.noAsk ?? 1);
    if (cheapest > 0.85) s -= 1;
    if (c.tradable) s += 0.3;
    if (c.venue === "gemini") s += GEMINI_BONUS;          // primary venue: priced + backed on Gemini
    if (c.venue === "polymarket") s -= 2;                 // read-only context: below anything buyable
    scored.push({ c, s, exp: Number.isFinite(exp) ? exp : Infinity });
  }
  preferGemini(scored);
  scored.sort((a, b) => b.s - a.s || a.exp - b.exp);
  if (named.size) return scored.filter((x) => named.has(x.c.id)).slice(0, limit).map((x) => ({ ...x.c })); // a shutdown risk never gets the NASDAQ
  return scored.slice(0, limit).map((x) => { const note = proxyNote(risk.peril, x.c); return note ? { ...x.c, proxyNote: note } : { ...x.c }; });
}

/**
 * Atlantic hurricane / landfall contracts observed only between mid-November and May: the season is over, the true chance is
 * ~0 whatever the ask, so they are not insurance (QA cycle 1: 52% of a Miami marina's budget on a Cat 4 landfall by Dec 31).
 */
export function offSeasonHurricane(c: MarketContract, now = new Date()): boolean {
  if (!/hurricane|landfall|tropical storm|named storm/i.test(`${c.eventTitle} ${c.label}`)) return false;
  const today = centralDate(now);
  const m = contractMeta(c.id);
  const end = m?.eventEnd ?? (Number.isFinite(Date.parse(c.expiry)) ? centralDate(c.expiry) : "");
  if (!end) return false;
  const inSeason = (ymd: string) => { const md = ymd.slice(5); return md >= "06-01" && md <= "11-15"; };
  // any in-season day between today and the end of observation keeps it
  for (let d = today, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) if (inSeason(d)) return false;
  return true;
}

/** Perils where Polymarket adds candidates (read-only context lines). */
export const POLY_PERILS: Peril[] = ["game", "fed", "cpi", "gas", "oil", "heat", "cold", "snow", "water", "quake", "storm", "rain", "flood"];
export const GEMINI_BONUS = 0.6;
/** Kalshi lines in a peril/date slot Gemini also covers drop this much (unless Gemini's side is unusable there). */
export const KALSHI_DUP_PENALTY = 1.5;

/** A Gemini contract is a usable hedge when some side is offered at an insurance price and the book is not empty. */
export function geminiUsable(c: MarketContract): boolean {
  const ok = (ask: number | null, depth?: number) => ask !== null && ask <= 0.85 && (depth === undefined || depth >= 5);
  const spreadOk = c.yesAsk === null || c.yesBid === null || c.yesAsk - c.yesBid <= 0.2;
  return spreadOk && (ok(c.yesAsk, c.depthYes) || ok(c.noAsk, c.depthNo));
}

/** Same insured event across venues: peril + event day + place (city for weather, sorted teams for games). */
export function slotKey(c: MarketContract): string {
  const m = contractMeta(c.id);
  const day = m?.eventDate ?? (c.expiry ? centralDate(new Date(c.expiry)) : "");
  const peril = c.peril === "cold" ? "heat" : c.peril;
  const day2 = peril === "fed" || peril === "cpi" ? day.slice(0, 7) : day; // decision/print month: venues close a day apart
  let where = normLoc(c.location);
  if (c.peril === "game") where = [m?.teams?.[0] ?? c.label, m?.opponents?.[0] ?? ""].map((x) => x.toLowerCase()).sort().join("/") + (m?.futureKind ? `|${m.futureKind}` : "");
  return `${peril}|${day2}|${where}`;
}

/**
 * "Prefer Gemini unless Kalshi is clearly better": when a peril/day/place slot has a usable Gemini contract,
 * every Kalshi contract in that slot is pushed down by KALSHI_DUP_PENALTY. Kalshi stays on top for perils
 * Gemini doesn't list (rain, gas, Fed, CPI) and for slots where Gemini has no ask, only > $0.85, or an empty book.
 */
export function preferGemini<T extends { c: MarketContract; s: number }>(scored: T[]): T[] {
  const geminiSlots = new Set(scored.filter((x) => x.c.venue === "gemini" && geminiUsable(x.c)).map((x) => slotKey(x.c)));
  for (const x of scored) if (x.c.venue === "kalshi" && geminiSlots.has(slotKey(x.c))) x.s -= KALSHI_DUP_PENALTY;
  return scored;
}

// ---------- cross-venue check (Polymarket) ----------

/** Adds `crossCheck` ("Polymarket says X%") to lines whose event Polymarket also lists. Never throws. */
export async function attachCrossChecks(lines: QuoteLine[]): Promise<QuoteLine[]> {
  const perils = [...new Set(lines.filter((l) => l.contract.venue !== "polymarket").map((l) => l.contract.peril))].filter((p) => POLY_PERILS.includes(p));
  if (!perils.length) return lines;
  try {
    const poly = await listPolymarkets(perils);
    const aliases = TEAMS.map(({ re, names }) => ({ re, names }));
    for (const l of lines) {
      const cc = crossCheckLine(l, poly, aliases);
      if (cc) l.crossCheck = cc;
    }
  } catch { /* optional */ }
  return lines;
}

// ---------- getContract ----------

/** Fresh prices + status + resolution for one contract id (`gemini:<instrumentSymbol>` | `kalshi:<ticker>`). */
export async function getContract(id: string): Promise<MarketContract | null> {
  const i = id.indexOf(":");
  const venue = id.slice(0, i), sym = id.slice(i + 1);
  if (venue === "kalshi") return getKalshiContract(sym);
  if (venue === "polymarket") return getPolymarket(id);
  if (venue === "hedgehog") return getParametric(id);
  if (venue !== "gemini") return null;
  const guesses: string[] = [];
  const cached = [...srcCache.values()].flatMap((x) => x.v).find((c) => c.id === id);
  if (cached) guesses.push(cached.eventTicker);
  const bare = sym.replace(/^GEMI-/, "");
  const parts = bare.split("-");
  for (let k = parts.length - 1; k >= 1; k--) guesses.push(parts.slice(0, k).join("-"));
  for (const t of [...new Set(guesses)]) {
    try {
      const ev = await eventByTicker(t, 0);
      if (!ev?.contracts) continue;
      const found = normalizeGeminiEvents([ev], { includeProps: true }).find((c) => c.id === id);
      if (found) return found;
    } catch { /* try the next split */ }
  }
  return null;
}

// ---------- hitRate ----------

export interface HitRate { settled: number; yesCount: number; threshold?: number; source: string; samples?: { date: string; value: string; yes: boolean }[] }

/**
 * Backtest: how often did the peril happen in the last `days` days?
 *  - heat/cold + city: Gemini settled "Highest temperature in <city>" events; a day counts as YES when the
 *    winning bin is >= threshold (heat, default 90°F) or <= threshold (cold, default 40°F).
 *  - rain + city: Kalshi settled daily rain markets (KXRAIN multi-city, KXRAINDAUS) for that city.
 * Returns null when there is no history for the peril/location.
 */
export async function hitRate(peril: Peril, location?: string, days = 30, opts: { threshold?: number } = {}): Promise<HitRate | null> {
  const loc = normLoc(location);
  const since = addDays(centralDate(new Date()), -days);
  try {
    if ((peril === "heat" || peril === "cold") && loc) {
      const evs = await settledEvents({ category: "Weather", search: (location ?? "").split(",")[0].trim(), max: 300 });
      const thr = opts.threshold ?? (peril === "heat" ? 90 : 40);
      const samples: NonNullable<HitRate["samples"]> = [];
      for (const c of normalizeGeminiEvents(evs)) {
        const m = contractMeta(c.id);
        if (c.resolution !== "yes" || normLoc(c.location) !== loc || !m?.eventDate || m.eventDate < since || !m.bounds) continue;
        if (/°C/.test(m.bounds.unit ?? "")) continue;
        const b = m.bounds;
        // conservative: a bin counts only if every value in it is past the threshold
        const yes = peril === "heat" ? b.lo !== undefined && b.lo >= thr : b.hi !== undefined && b.hi <= thr;
        samples.push({ date: m.eventDate, value: c.label, yes });
      }
      if (!samples.length) return null;
      samples.sort((a, b) => a.date.localeCompare(b.date));
      return { settled: samples.length, yesCount: samples.filter((s) => s.yes).length, threshold: thr, source: "gemini settled WXHIGH", samples };
    }
    if (peril === "rain" && loc) {
      const series = loc === "austin" ? ["KXRAIN", "KXRAINDAUS"] : ["KXRAIN"];
      const rs = await Promise.allSettled(series.map((s) => settledKalshi(s, days)));
      const byDate = new Map<string, boolean>();
      for (const r of rs) {
        if (r.status !== "fulfilled") continue;
        for (const c of r.value) {
          const m = contractMeta(c.id);
          if (normLoc(c.location) !== loc || !m?.eventDate || !c.resolution || m.eventDate < since) continue;
          byDate.set(m.eventDate, (byDate.get(m.eventDate) ?? false) || c.resolution === "yes");
        }
      }
      if (!byDate.size) return null;
      const samples = [...byDate].sort().map(([date, yes]) => ({ date, value: yes ? "rain" : "dry", yes }));
      return { settled: samples.length, yesCount: samples.filter((s) => s.yes).length, source: "kalshi settled daily rain", samples };
    }
  } catch {
    return null;
  }
  return null;
}
