// Long-horizon market context for the LLM prompts (risk map, brainstorm, matcher).
//
// The per-peril universe and the catalog used to show season futures as scattered event lines with venue expiries
// (Kalshi futures expire in 2029 as a placeholder), and game nights crowded them out. This module renders them as
// their own compact section: one line per OWN team (every stage, both venues, settle month from meta.eventEnd) plus the
// period / long-dated macro series (monthly rain, diesel at year end, the mortgage-rate path, shutdown, recession),
// and a season calendar (league dates + the next FOMC meetings) so "through the playoffs" or "the meeting before the
// loan resets" can be written as concrete windows. Pure: no network, no LLM.
import type { BusinessProfile, MarketContract } from "../types";
import { LEAGUE_CALENDAR, type FutureKind } from "../markets/futures";
import { centralDate, contractMeta, daysBetween } from "../markets/normalize";
import { ownFutureTeam, ownTeamsIn, type OwnTeam } from "./horizon";

const monthLabel = (ymd: string) => {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
};
const dayLabel = (ymd: string) => {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
};
const p2 = (n: number | null | undefined) => (n == null ? "-" : n.toFixed(2));

/** Last day the contract observes (US Central YYYY-MM-DD): meta.eventEnd, never a placeholder venue expiry. */
export function settleDay(c: MarketContract, nowMs = Date.now()): string {
  const m = contractMeta(c.id);
  const d = m?.eventEnd ?? m?.eventDate;
  // a meta date in the past on an open contract is a ticker-parse slip (KXRAINDAUS-14FEB27 -> 2014-02-27): use the expiry
  return d && d >= centralDate(new Date(nowMs - 2 * 86_400_000)) ? d : centralDate(c.expiry);
}

/** A season future, a period market (observes 20+ days) or anything settling 25+ days out. */
export function isLongContract(c: MarketContract, nowMs = Date.now()): boolean {
  const m = contractMeta(c.id);
  if (m?.futureKind) return true;
  const today = centralDate(new Date(nowMs));
  if (m?.eventDate && m.eventEnd && daysBetween(m.eventDate, m.eventEnd) >= 20) return true;
  const end = m?.eventEnd ?? m?.eventDate;
  if (end && end >= today) return daysBetween(today, end) >= 25; // "Diesel price at year-end" observes one day, 6 weeks out
  // no meta at all (hand-built contracts): a far expiry is long only when the title names no single day / game
  if (!m && /\b(today|tonight|this week|on (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2})\b|\s(vs\.?|v\.?|at|@)\s/i.test(c.eventTitle)) return false;
  const exp = Date.parse(c.expiry);
  return Number.isFinite(exp) && exp - nowMs > 45 * 86_400_000;
}

const STOP = new Set(["with", "from", "that", "this", "they", "their", "when", "what", "have", "into", "more", "most", "days", "week", "weeks", "about", "every", "each", "just", "than", "then", "your", "ours", "over", "back", "only", "sell", "lose", "lost", "price", "prices", "high", "year", "will", "much", "many"]);
/** The owner's own words (4+ letters, singular), for matching market titles ("mortgage", "diesel", "rain", "inflation"). */
export function ownerWords(description: string): string[] {
  return [...new Set((description.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/s$/, "")))];
}
const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/**
 * Relevance of a market line to this owner: their own words in the title (+2), team words (+4), own city (+2) or
 * Texas (+1), an insurance-priced contract (+1); context-only Polymarket (-2), settling 15+ months out (-3).
 */
export function lineScore(o: { title: string; text: string; venue?: string; settleYmds?: string[] }, profile: Pick<BusinessProfile, "description" | "city">, tw: string[], nowMs = Date.now()): number {
  const city = profile.city.split(",")[0].trim().toLowerCase();
  const t = o.title.toLowerCase(), l = o.text.toLowerCase();
  let s = 0;
  if (tw.some((w) => l.includes(w))) s += 4;
  s += Math.min(4, 2 * ownerWords(profile.description).filter((w) => t.includes(w)).length); // "mortgage" + "rate"
  if (l.includes(city)) s += 2;
  else if (/\btexas\b|austin|houston|dallas|san antonio|ercot/.test(l)) s += 1;
  if (o.venue === "polymarket" || / \| polymarket \| /.test(o.text)) s -= 2;
  if (/ YES 0\.(0[5-9]|[1-5]\d|60)\b/.test(o.text)) s += 1;
  const months = (o.settleYmds ?? []).map((d) => (Number(d.slice(0, 4)) - new Date(nowMs).getUTCFullYear()) * 12 + Number(d.slice(5, 7)) - 1 - new Date(nowMs).getUTCMonth());
  const fromText = [...o.text.matchAll(/settles? [^|]*?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (20\d\d)/gi)]
    .map((m) => (Number(m[2]) - new Date(nowMs).getUTCFullYear()) * 12 + MON[m[1].toLowerCase()] - new Date(nowMs).getUTCMonth());
  const all = [...months, ...fromText];
  if (all.length && Math.min(...all) > 15) s -= 3; // "before 2035": not a small-business hedge
  return s;
}

const STAGE: Record<FutureKind, (t: OwnTeam) => string> = {
  playoffs: () => "make playoffs",
  wins: () => "wins",
  division: () => "win division",
  round: (t) => (t.league[0] === "NBA" || t.league[0] === "NHL" ? `reach ${t.conf === "Western" ? "West" : t.conf === "Eastern" ? "East" : "conf."} finals` : "win a playoff round"),
  conference: (t) => (t.league[0] === "NBA" || t.league[0] === "NHL" ? `win ${t.conf === "Western" ? "West" : t.conf ?? "conference"}` : `win ${t.conf ?? "conference"}`),
  title: () => "title",
};
const ORDER: FutureKind[] = ["playoffs", "wins", "division", "round", "conference", "title"];

export interface TeamFutures { team: OwnTeam; ids: string[]; line: string }

/**
 * One line per own team that has live futures, e.g.
 *   "Spurs (NBA) season futures: make playoffs YES 0.97 | reach West finals 0.60 | win West 0.35 [gemini 0.37] | title 0.22 [gemini 0.24] | wins 60+ 0.60, 65+ 0.28 | settle Apr-Jun 2027"
 * Prices are YES asks (implied odds); the owner's protective side is NO (pays if the run stops).
 */
export function teamFutures(markets: MarketContract[], profile: Pick<BusinessProfile, "description">, nowMs = Date.now()): TeamFutures[] {
  const owns = ownTeamsIn(profile.description);
  if (!owns.length) return [];
  const live = markets.filter((c) => c.status === "open" && (c.yesAsk !== null || c.noAsk !== null) && contractMeta(c.id)?.futureKind);
  const out: TeamFutures[] = [];
  for (const team of owns) {
    const mine = live.filter((c) => ownFutureTeam(contractMeta(c.id), [team]));
    if (!mine.length) continue;
    const yes = (c: MarketContract) => c.yesAsk ?? (c.noAsk != null ? Math.max(0, 1 - c.noAsk) : null);
    const parts: string[] = [];
    for (const kind of ORDER) {
      const cs = mine.filter((c) => contractMeta(c.id)!.futureKind === kind);
      if (!cs.length) continue;
      if (kind === "wins") {
        // the informative rungs: implied odds 0.15-0.85, at most 3
        const rungs = cs.map((c) => ({ c, n: Number(c.label.match(/\d+/)?.[0] ?? NaN), y: yes(c) }))
          .filter((r) => Number.isFinite(r.n) && r.y != null && r.y >= 0.12 && r.y <= 0.88).sort((a, b) => a.n - b.n).slice(0, 3);
        if (rungs.length) parts.push(`wins ${rungs.map((r) => `${r.n}+ ${p2(r.y)}`).join(", ")}`);
        continue;
      }
      // primary = cheapest-to-own-NO venue (gemini first on ties), the other venue in brackets
      const sorted = [...cs].sort((a, b) => (a.noAsk ?? 9) - (b.noAsk ?? 9) || (a.venue === "gemini" ? -1 : 1));
      const [first, ...rest] = sorted;
      const other = rest.find((c) => c.venue !== first.venue);
      parts.push(`${STAGE[kind](team)} ${p2(yes(first))}${first.venue === "gemini" ? "" : ` (${first.venue})`}${other ? ` [${other.venue} ${p2(yes(other))}]` : ""}`);
    }
    if (!parts.length) continue;
    const ends = mine.map((c) => settleDay(c, nowMs)).sort();
    const a = monthLabel(ends[0]), b = monthLabel(ends[ends.length - 1]);
    const span = a === b ? a : a.slice(-4) === b.slice(-4) ? `${a.slice(0, 3)}-${b}` : `${a}-${b}`;
    const venues = [...new Set(mine.map((c) => c.venue))].join("+");
    out.push({ team, ids: mine.map((c) => c.id),
      line: `${team.nick} (${team.league.join("/")}) season futures, ${venues}: ${parts.join(" | ")} | settle ${span} (implied odds = YES ask; own-team NO pays if the run stops)` });
  }
  return out;
}

/** Next FOMC decision days from the live Fed markets (fallback: the published 2026-27 schedule). */
export function nextFomc(markets: MarketContract[], nowMs = Date.now(), n = 3): string[] {
  const today = centralDate(new Date(nowMs));
  const days = new Set<string>();
  for (const c of markets) {
    if (c.peril !== "fed" || c.venue !== "kalshi" || !/fed decision/i.test(c.eventTitle)) continue;
    const d = contractMeta(c.id)?.eventDate ?? centralDate(c.expiry);
    if (d >= today) days.add(d);
  }
  const list = days.size >= n ? [...days] : ["2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09"];
  return list.filter((d) => d >= today).sort().slice(0, n);
}

/** "Season calendar: NBA regular season ends Apr 11, 2027; playoffs through Jun 20, 2027; ... Next FOMC: Dec 9, 2026, ..." */
export function seasonCalendar(markets: MarketContract[], profile: Pick<BusinessProfile, "description">, nowMs = Date.now()): string {
  const today = centralDate(new Date(nowMs));
  const owns = ownTeamsIn(profile.description);
  const leagues = owns.length ? [...new Set(owns.flatMap((t) => t.league))] : ["NBA", "NFL"];
  const lg = leagues.filter((l) => LEAGUE_CALENDAR[l]).map((l) => {
    const c = LEAGUE_CALENDAR[l];
    const bits: string[] = [];
    if (c.wins && c.wins >= today) bits.push(`regular season ends ${dayLabel(c.wins)}`);
    if (c.playoffs && c.playoffs >= today && l !== "NBA" && l !== "NHL") bits.push(`playoff field set ${dayLabel(c.playoffs)}`);
    if (c.conference && c.conference >= today) bits.push(`conference title ${dayLabel(c.conference)}`);
    if (c.title && c.title >= today) bits.push(`title ${dayLabel(c.title)}`);
    return bits.length ? `${l} ${bits.join(", ")}` : "";
  }).filter(Boolean);
  const fomc = nextFomc(markets, nowMs);
  return `Season calendar: ${[...lg, fomc.length ? `next FOMC decisions ${fomc.map(dayLabel).join(", ")}` : ""].filter(Boolean).join("; ")}.`;
}

/**
 * The "SEASON FUTURES & PERIOD MARKETS" section of the risk-map universe: own-team futures lines, then period / long
 * macro events (own city first for weather), up to `perPeril` per peril, each with the month it settles.
 */
export function longUniverse(markets: MarketContract[], profile: BusinessProfile, nowMs = Date.now(), perPeril = 2, max = 14): string {
  const open = markets.filter((m) => m.status === "open" && isLongContract(m, nowMs));
  if (!open.length) return "";
  const city = profile.city.split(",")[0].trim().toLowerCase();
  const lines: string[] = teamFutures(open, profile, nowMs).map((t) => `  - ${t.line}`);
  const byPeril = new Map<string, Map<string, MarketContract[]>>();
  for (const m of open) {
    if (contractMeta(m.id)?.futureKind || m.peril === "game") continue; // teams: one line each above
    if (["heat", "cold", "rain", "snow"].includes(m.peril) && m.location && m.location.toLowerCase() !== city) continue;
    const ev = byPeril.get(m.peril) ?? new Map<string, MarketContract[]>(); byPeril.set(m.peril, ev);
    const k = `${m.eventTitle} [${m.venue}, settles ${dayLabel(settleDay(m, nowMs))}]`; ev.set(k, [...(ev.get(k) ?? []), m]);
  }
  // most relevant first (owner's words, own city / Texas, priced, tradable venue, settles within ~15 months), per-peril cap
  const scored: { s: number; line: string }[] = [];
  for (const [peril, events] of byPeril) {
    const far = ["quake", "water", "storm", "snow"].includes(peril);
    const list = [...events.entries()].map(([t, cs]) => {
      const priced = cs.filter((c) => (c.yesAsk ?? 0) >= 0.05 && (c.yesAsk ?? 1) <= 0.6).slice(0, 3);
      const line = `  - ${peril}: ${t}: ${(priced.length ? priced : cs.slice(0, 3)).map((c) => `${c.label}${c.yesAsk != null ? ` YES ${p2(c.yesAsk)}` : ""}`).join(" / ")}`;
      return { s: lineScore({ title: cs[0].eventTitle, text: line, venue: cs[0].venue, settleYmds: [settleDay(cs[0], nowMs)] }, profile, [], nowMs), line };
    }).filter((x) => x.s >= (far ? 2 : 1) && (!x.line.includes(", polymarket,") || x.s >= 3)).sort((a, b) => b.s - a.s);
    scored.push(...list.slice(0, far ? 1 : perPeril));
  }
  lines.push(...scored.sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.line));
  return lines.join("\n");
}
