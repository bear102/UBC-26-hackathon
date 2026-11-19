// Cross-venue comparison: the same (or a similar) insured event on Gemini / Kalshi / Polymarket, side by side.
// Additive helper on top of lib/markets (no existing behavior changes). Used by /api/markets/compare and the
// /markets explorer. Matching rules:
//   games      same league + game day (±1) + same two teams (ticker abbreviations, else team names);
//              the side is flipped when the other venue lists the opponent ("Spurs lose" = "Clippers win").
//   thresholds same peril family + underlying (Brent ≠ WTI, daily high ≠ daily low) + day + place;
//              "same" = identical bounds, "similar" = nearest bound in the same direction (≤2°F / ≤3%).
import type { MarketContract, Peril, VenueId } from "../types";
import { contractMeta, getBook, getContract, listMarkets, normLoc } from "./index";
import { centralDate, daysBetween, parseBounds, setMeta, type Bounds } from "./normalize";

export type VenueRole = "primary" | "buyable" | "reference";
export const VENUE_ROLE_OF: Record<VenueId, VenueRole> = { gemini: "primary", kalshi: "buyable", polymarket: "reference" };
const ORDER: VenueId[] = ["gemini", "kalshi", "polymarket"];

export interface VenueQuoteRow {
  venue: VenueId;
  role: VenueRole;
  contractId: string;
  title: string;            // event title on that venue
  label: string;            // contract label on that venue
  side: "yes" | "no";       // the side that pays in the SAME scenario as the hedge
  prob: number | null;      // that venue's chance of the scenario (bid/ask midpoint)
  ask: number | null;       // cost per $1 of cover (ask on `side`)
  depth: number | null;     // contracts for sale within 2¢ of the ask (null = unknown)
  expiry: string;
  url?: string;
  match: "this" | "same" | "similar";
  matchNote?: string;       // "≥96°F instead of ≥95°F", "game on Nov 20"
  best?: boolean;           // lowest cost among buyable venues for the same question
  used?: boolean;           // the venue this hedge is priced on
}

export interface Comparison {
  contractId: string;
  side: "yes" | "no";
  peril: Peril;
  rows: VenueQuoteRow[];
  usedVenue: VenueId;
  bestVenue: VenueId | null;
  verdict: "agree" | "close" | "differ" | "single" | "similar-only";
  spreadPts: number | null;   // max - min chance across same-question rows, in points
  headline: string;           // "Gemini 11% · Kalshi 12% · Polymarket 11% — markets agree"
  flags: string[];            // ["Polymarket is 8 pts higher than Gemini"]
  why: string;                // why we use the venue we use
  asOf: string;
}

// ---------- small helpers ----------

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const yesMid = (c: MarketContract): number | null =>
  c.yesAsk !== null && c.yesBid !== null ? (c.yesAsk + c.yesBid) / 2 : c.yesAsk ?? c.yesBid ?? (c.noBid !== null ? 1 - c.noBid : c.noAsk !== null ? 1 - c.noAsk : null);
export function sideProb(c: MarketContract, side: "yes" | "no"): number | null {
  const m = yesMid(c);
  return m === null ? null : r3(side === "yes" ? m : 1 - m);
}
export const sideAsk = (c: MarketContract, side: "yes" | "no") => (side === "yes" ? c.yesAsk : c.noAsk);
const sideDepth = (c: MarketContract, side: "yes" | "no") => (side === "yes" ? c.depthYes : c.depthNo) ?? null;
const lc = (s: string | undefined) => (s ?? "").toLowerCase().trim();

export function eventDay(c: MarketContract): string {
  const m = contractMeta(c.id);
  if (m?.eventDate) return m.eventDate;
  return c.expiry && Number.isFinite(Date.parse(c.expiry)) ? centralDate(c.expiry) : "";
}

/** Peril family: cold and heat are the same daily-temperature ladders. */
export const family = (p: Peril): Peril => (p === "cold" ? "heat" : p);

/** What is being measured, so Brent never matches WTI and a daily low never matches a daily high. */
export function underlying(c: MarketContract): string {
  const t = `${c.eventTitle} ${c.symbol}`.toLowerCase();
  switch (family(c.peril)) {
    case "heat": return /lowest|minimum|\blow\b|wxlow|lowt/.test(t) ? "low" : "high";
    case "oil": return /brent/.test(t) ? "brent" : /wti|crude/.test(t) ? "wti" : "oil";
    case "gas": return /diesel/.test(t) ? "diesel" : "gas";
    case "cpi": return /core/.test(t) ? "core" : /year|yoy|annual/.test(t) ? "cpi-yoy" : "cpi";
    case "crypto": { const m = c.symbol.match(/(?:GEMI-|KX)?([A-Z]{2,5})/); return (m?.[1] ?? c.eventTitle.split(/\s/)[0]).toLowerCase().replace(/\d+.*$/, ""); }
    case "rain": return /snow/.test(t) ? "snow" : "rain";
    default: return family(c.peril);
  }
}

const place = (c: MarketContract) => { const l = normLoc(c.location); return l === "us" ? "" : l; };

/** Integer-°F aware bounds identity ("Above 77" == "78°F or above"). */
export function boundsKey(b: Bounds | undefined | null): string | null {
  if (!b) return null;
  const temp = b.unit === "°F" || b.unit === "°C";
  const lo = b.lo === undefined ? "" : String(temp && !b.loInclusive ? b.lo + 1 : b.lo);
  const hi = b.hi === undefined ? "" : String(temp && !b.hiInclusive ? b.hi - 1 : b.hi);
  return `${lo}|${hi}`;
}
export const boundsOf = (c: MarketContract): Bounds | undefined => contractMeta(c.id)?.bounds ?? parseBounds(c.label) ?? undefined;
const dir = (b: Bounds) => (b.lo !== undefined && b.hi !== undefined ? "range" : b.lo !== undefined ? "up" : "down");

// ---------- games ----------

export interface GameInfo { league?: string; day: string; pair?: [string, string]; yes?: string; names: string[]; oppNames: string[] }

/** Team abbreviations from venue tickers: GEMI-NBA-2611200100-LAC-SAS-M-SAS, KXNBAGAME-26NOV19LACSAS-LAC, nba-lac-sas-2026-11-19. */
export function gameInfo(c: MarketContract): GameInfo {
  const meta = contractMeta(c.id);
  const g: GameInfo = { league: meta?.league?.toUpperCase(), day: eventDay(c), names: meta?.teams?.length ? meta.teams : [c.label], oppNames: meta?.opponents ?? [] };
  let m: RegExpMatchArray | null;
  if (c.venue === "gemini" && (m = c.symbol.match(/^GEMI-([A-Z0-9]+)-\d{10}-([A-Z0-9]+)-([A-Z0-9]+)-M-([A-Z0-9]+)$/))) {
    g.league ??= m[1]; g.pair = [m[2], m[3]]; g.yes = m[4];
  } else if (c.venue === "kalshi" && (m = c.symbol.match(/^KX([A-Z]+?)GAME-\d{2}[A-Z]{3}\d{2}([A-Z0-9]+)-([A-Z0-9]+)$/))) {
    g.league ??= m[1];
    const [cat, yes] = [m[2], m[3]];
    const other = cat.startsWith(yes) ? cat.slice(yes.length) : cat.endsWith(yes) ? cat.slice(0, cat.length - yes.length) : "";
    if (other) { g.pair = [yes, other]; g.yes = yes; }
  } else if (c.venue === "polymarket" && (m = c.eventTicker.match(/^([a-z]+)-([a-z0-9]+)-([a-z0-9]+)-\d{4}-\d{2}-\d{2}$/))) {
    g.league ??= m[1].toUpperCase(); g.pair = [m[2].toUpperCase(), m[3].toUpperCase()]; g.yes = m[2].toUpperCase();
  }
  if (!g.oppNames.length && !g.pair) {
    const parts = c.eventTitle.split(/\s+(?:vs\.?|v\.?|at|@)\s+/i).map((x) => x.replace(/[—–-].*$/, "").trim());
    if (parts.length === 2) g.oppNames = parts.filter((p) => !nameEq([p], c.label));
  }
  return g;
}

function nameEq(xs: string[], y: string): boolean {
  const b = lc(y).replace(/\s+win$/, "");
  if (!b) return false;
  return xs.some((x) => { const a = lc(x); return a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`); });
}

const leagueEq = (a?: string, b?: string) => !a || !b || a === b || a.startsWith(b) || b.startsWith(a);

/** Same game? Returns whether `o`'s YES team is the same team as `c`'s YES team (true), the opponent (false), or null. */
export function sameGame(c: MarketContract, o: MarketContract): boolean | null {
  if (c.peril !== "game" || o.peril !== "game") return null;
  const a = gameInfo(c), b = gameInfo(o);
  if (!leagueEq(a.league, b.league)) return null;
  if (a.day && b.day && Math.abs(daysBetween(a.day, b.day)) > 1) return null;
  if (a.pair && b.pair && a.yes && b.yes) {
    const sa = [...a.pair].sort().join("/"), sb = [...b.pair].sort().join("/");
    if (sa === sb) return a.yes === b.yes;
  }
  // name fallback (nicknames vs city names): YES team on one side must be named on the other
  if (b.names.some((n) => nameEq(a.names, n))) return true;
  if (b.names.some((n) => nameEq(a.oppNames, n))) return false;
  return null;
}

// ---------- equivalence ----------

export interface Equivalent { contract: MarketContract; side: "yes" | "no"; match: "same" | "similar"; note?: string }

/** Best equivalent of (c, side) among `pool` (any venues). */
export function findEquivalent(c: MarketContract, side: "yes" | "no", pool: MarketContract[]): Equivalent | null {
  const flip = (s: "yes" | "no") => (s === "yes" ? "no" : "yes");
  if (c.peril === "game") {
    let best: Equivalent | null = null;
    for (const o of pool) {
      if (o.id === c.id || o.status !== "open") continue;
      const same = sameGame(c, o);
      if (same === null) continue;
      const e: Equivalent = { contract: o, side: same ? side : flip(side), match: "same" };
      const [d1, d2] = [eventDay(c), eventDay(o)];
      if (d1 && d2 && d1 !== d2) e.note = `listed for ${d2}`;
      if (!best || (same && best.side !== side)) best = e; // prefer a contract on the same team (YES = YES)
    }
    return best;
  }
  const b = boundsOf(c);
  const day = eventDay(c), und = underlying(c), where = place(c);
  const weather = ["heat", "rain", "cold"].includes(c.peril);
  let best: (Equivalent & { dist: number }) | null = null;
  for (const o of pool) {
    if (o.id === c.id || o.status !== "open" || family(o.peril) !== family(c.peril) || underlying(o) !== und || place(o) !== where) continue;
    const od = eventDay(o);
    const dayGap = day && od ? Math.abs(daysBetween(day, od)) : 99;
    if (weather ? dayGap !== 0 : dayGap > 3) continue;
    const ob = boundsOf(o);
    if (!b || !ob) {
      // no numeric bounds (e.g. "Will it rain in Austin?"): same day + place + same yes/no question
      if (!b && !ob && dayGap === 0 && (c.peril === "rain" || lc(o.label) === lc(c.label))) {
        const e = { contract: o, side, match: "same" as const, dist: 0 };
        if (!best || best.dist > 0) best = e;
      }
      continue;
    }
    const temp = b.unit === "°F" || b.unit === "°C";
    if (boundsKey(b) === boundsKey(ob) && dayGap === 0) { best = { contract: o, side, match: "same", dist: -1 }; break; }
    if (dir(b) !== dir(ob)) continue;
    const v = b.lo ?? b.hi!, ov = ob.lo ?? ob.hi!;
    const dist = Math.abs(v - ov) / (temp ? 1 : Math.max(1e-9, Math.abs(v)));
    const ok = temp ? dist <= 2 : dist <= 0.03;
    if (!ok) continue;
    const sameQ = dist < 1e-9 || (boundsKey(b) === boundsKey(ob));
    const match: "same" | "similar" = sameQ && dayGap === 0 ? "same" : "similar";
    const notes = [] as string[];
    if (!sameQ) notes.push(`${ob.text} instead of ${b.text}`);
    if (dayGap) notes.push(`settles ${od}`);
    if (sameQ && dayGap === 0 && o.venue === "polymarket") notes.push("asks “hit during the period”, not “settle above”");
    const e = { contract: o, side, match: o.venue === "polymarket" && !(dayGap === 0 && sameQ) ? "similar" as const : match, note: notes.join(" · ") || undefined, dist: dist + dayGap * 0.01 };
    if (!best || e.dist < best.dist) best = e;
  }
  if (!best) return null;
  const { dist: _d, ...rest } = best;
  void _d;
  return rest;
}

// ---------- comparison ----------

function row(c: MarketContract, side: "yes" | "no", match: VenueQuoteRow["match"], note?: string): VenueQuoteRow {
  return {
    venue: c.venue, role: VENUE_ROLE_OF[c.venue], contractId: c.id, title: c.eventTitle, label: c.label, side,
    prob: sideProb(c, side), ask: sideAsk(c, side), depth: sideDepth(c, side) === null ? null : Math.round(sideDepth(c, side)!), expiry: c.expiry, url: c.url, match, matchNote: note,
  };
}

const NAME: Record<VenueId, string> = { gemini: "Gemini", kalshi: "Kalshi", polymarket: "Polymarket" };
const pctS = (p: number | null) => (p === null ? "—" : p < 0.01 ? "<1%" : p > 0.99 ? ">99%" : `${Math.round(p * 100)}%`);

/** Fill unknown depth from live books (Gemini/Kalshi), within 2¢ of the ask. Bounded by `ms`. */
async function fillDepth(rows: VenueQuoteRow[], byId: Map<string, MarketContract>, ms = 2500) {
  await Promise.race([
    Promise.all(rows.filter((r) => r.depth === null && r.venue !== "polymarket").map(async (r) => {
      const c = byId.get(r.contractId);
      if (!c) return;
      const b = await getBook(c);
      const lv = b?.[r.side];
      if (!lv?.length) return;
      const top = Math.min(...lv.map((l) => l.price));
      r.depth = Math.round(lv.filter((l) => l.price <= top + 0.02 + 1e-9).reduce((s, l) => s + l.size, 0));
    })),
    new Promise((res) => setTimeout(res, ms)),
  ]);
}

/** Build the comparison for an already-resolved contract against a pool of markets (pure apart from optional depth fill). */
export function buildComparison(c: MarketContract, side: "yes" | "no", pool: MarketContract[]): Comparison {
  const rows: VenueQuoteRow[] = [{ ...row(c, side, "this"), used: true }];
  for (const v of ORDER) {
    if (v === c.venue) continue;
    const eq = findEquivalent(c, side, pool.filter((o) => o.venue === v));
    if (eq) rows.push(row(eq.contract, eq.side, eq.match, eq.note));
  }
  rows.sort((a, b) => ORDER.indexOf(a.venue) - ORDER.indexOf(b.venue));
  const same = rows.filter((r) => r.match !== "similar" && r.prob !== null);
  const used = rows.find((r) => r.used)!;

  // best price among buyable venues asking the same question
  const buyable = rows.filter((r) => r.match !== "similar" && r.role !== "reference" && r.ask !== null && r.ask <= 0.99);
  let best: VenueQuoteRow | null = null;
  for (const r of buyable) if (!best || r.ask! < best.ask! - 0.005 || (Math.abs(r.ask! - best.ask!) <= 0.005 && r.used)) best = r;
  if (best) best.best = true;

  const probs = same.map((r) => r.prob!);
  const spread = probs.length >= 2 ? Math.round((Math.max(...probs) - Math.min(...probs)) * 100) : null;
  const verdict: Comparison["verdict"] = rows.length === 1 ? "single" : same.length < 2 ? "similar-only" : spread! <= 3 ? "agree" : spread! <= 7 ? "close" : "differ";

  const flags: string[] = [];
  for (const r of rows) {
    if (r.used || r.prob === null || used.prob === null) continue;
    const d = Math.round((r.prob - used.prob) * 100);
    if (r.match === "similar") continue;
    if (Math.abs(d) >= 4) flags.push(`${NAME[r.venue]} is ${Math.abs(d)} pts ${d > 0 ? "higher" : "lower"} than ${NAME[used.venue]}`);
  }

  const parts = rows.map((r) => `${NAME[r.venue]} ${pctS(r.prob)}${r.match === "similar" ? "*" : ""}`);
  const tail = verdict === "agree" ? "markets agree" : verdict === "close" ? "markets roughly agree" : verdict === "differ" ? `markets disagree by ${spread} pts`
    : verdict === "single" ? `only ${NAME[c.venue]} lists this` : "only similar questions elsewhere";
  const headline = `${parts.join(" · ")} — ${tail}`;

  const g = rows.find((r) => r.venue === "gemini" && !r.used);
  const k = rows.find((r) => r.venue === "kalshi" && !r.used && r.match !== "similar");
  const cents = (x: number) => `${Math.round(x * 100)}¢`;
  let why: string;
  if (c.venue === "gemini") {
    why = "Gemini is our primary venue: its live order book prices your cover, and Hedgehog backs every sale with a matching order on Gemini.";
    if (k?.ask != null && used.ask != null && k.ask < used.ask - 0.01) why += ` Kalshi is ${cents(used.ask - k.ask)} cheaper per $1 right now; we stay on Gemini so the cover is backed.`;
  } else if (c.venue === "kalshi") {
    if (!g) why = `Gemini doesn't list this market, so we use Kalshi. You still get a Solana outcome token.`;
    else if (g.match === "similar") why = `Gemini only lists a similar question (${g.label}), so we use Kalshi's exact one.`;
    else if (g.ask === null) why = "Gemini lists the same question but nobody is selling it right now, so we use Kalshi.";
    else if (g.ask > 0.85) why = `Gemini's price (${cents(g.ask)}) is too high to be insurance, so we use Kalshi.`;
    else if (used.ask !== null && g.ask > used.ask + 0.01) why = `Gemini is ${cents(g.ask - used.ask)} dearer per $1 for the same question, so we use Kalshi.`;
    else why = "Kalshi was the AI's pick; Gemini lists the same question at about the same price.";
  } else {
    why = "Polymarket is reference only: we can't buy there, so this line is shown for context.";
  }

  return { contractId: c.id, side, peril: c.peril, rows, usedVenue: c.venue, bestVenue: best?.venue ?? null, verdict, spreadPts: spread, headline, flags, why, asOf: new Date().toISOString() };
}

/**
 * Compare a contract across venues. `hint` is the client's copy of the contract (used when the id is not live,
 * e.g. demo fixtures: we then derive its date/bounds from the text and compare against live markets).
 */
export async function compareContract(id: string, side: "yes" | "no", hint?: MarketContract | null, opts: { depth?: boolean } = {}): Promise<Comparison | null> {
  const perilHint = hint?.peril;
  const fams: Peril[] = perilHint ? [...new Set<Peril>([perilHint, family(perilHint), ...(family(perilHint) === "heat" ? (["cold"] as Peril[]) : [])])] : [];
  let pool = await listMarkets({ perils: fams.length ? fams : undefined, venues: ["gemini", "kalshi", "polymarket"] });
  let c = pool.find((x) => x.id === id) ?? null;
  if (!c && !hint) {
    c = await getContract(id).catch(() => null);
    if (c) pool = await listMarkets({ perils: [...new Set<Peril>([c.peril, family(c.peril), ...(family(c.peril) === "heat" ? (["cold"] as Peril[]) : [])])], venues: ["gemini", "kalshi", "polymarket"] });
  }
  if (!c && hint) {
    c = hint;
    if (!contractMeta(c.id)) {
      const day = (() => {
        const m = c.eventTitle.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
        if (m) { const d = new Date(`${m[1]} ${m[2]}, ${m[3] ?? new Date(c.expiry || Date.now()).getUTCFullYear()} 12:00`); if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10); }
        return c.expiry ? centralDate(c.expiry) : undefined;
      })();
      const loc = c.location ?? (c.eventTitle.match(/\bin ([A-Z][a-zA-Z .]+?)(?: on| in|\?|$)/)?.[1]);
      if (loc && !c.location) c = { ...c, location: loc };
      setMeta(c.id, { eventDate: day, bounds: parseBounds(c.label) ?? undefined });
    }
  }
  if (!c) return null;
  const cmp = buildComparison(c, side, pool);
  if (opts.depth !== false) {
    const byId = new Map(pool.map((x) => [x.id, x]));
    byId.set(c.id, c);
    await fillDepth(cmp.rows, byId);
  }
  return cmp;
}
