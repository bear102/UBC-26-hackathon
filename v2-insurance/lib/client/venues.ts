// One vocabulary for every venue on every page: names, roles, badge styles, and how we print
// chance / cost per $1 / depth / expiry. Server matching lives in lib/markets/compare.ts.
import type { MarketContract, QuoteLine, VenueId } from "@/lib/types";

export type VenueRole = "primary" | "buyable" | "reference";

export const VENUES: Record<VenueId, { name: string; role: VenueRole; roleLabel: string; desc: string; cls: string }> = {
  gemini: {
    name: "Gemini", role: "primary", roleLabel: "Primary · hedged", cls: "badge-gemini",
    desc: "Our main market. Its live prices set your cost, and Hedgehog backs every sale with a matching order on Gemini.",
  },
  kalshi: {
    name: "Kalshi", role: "buyable", roleLabel: "via DFlow on Solana", cls: "badge-kalshi",
    desc: "Used where Gemini lists nothing (rain, snow, Texas power, lake levels, diesel, CPI) or has no sellers. Kalshi markets are tokenized on Solana by DFlow, so you hold an SPL outcome token.",
  },
  polymarket: {
    name: "Polymarket", role: "reference", roleLabel: "Reference only", cls: "badge-polymarket",
    desc: "Reference only — Polymarket isn't available to US desks. A second opinion on the odds (and the only venue for some disaster events); we never buy there.",
  },
};
export const VENUE_ORDER: VenueId[] = ["gemini", "kalshi", "polymarket"];
export const venueName = (v: string) => VENUES[v as VenueId]?.name ?? v;

/** Chance of the event (0..1) → "11%", "<1%", ">99%". */
export function fmtChance(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  if (p < 0.01) return "<1%";
  if (p > 0.99) return ">99%";
  return `${Math.round(p * 100)}%`;
}
/** Cost per $1 of cover → "11¢". */
export const fmtPer1 = (a: number | null | undefined) => (a == null ? "no sellers" : `${Math.round(a * 100)}¢`);
/** Contracts for sale near the price → "3,125" / "12k" / "1.1M". Each contract = $1 of cover. */
export function fmtDepth(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "—";
  if (d >= 1e6) return `${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e4) return `${Math.round(d / 1000)}k`;
  return Math.round(d).toLocaleString("en-US");
}
/** Owner's timezone (browser). Falls back to US Central (our Austin demo businesses) during server render. */
export function fmtExpiry(iso: string | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: tz ?? "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}
export function fmtDay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "—";
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

// ---------- comparison client ----------

export interface VenueQuoteRow {
  venue: VenueId; role: VenueRole; contractId: string; title: string; label: string; side: "yes" | "no";
  prob: number | null; ask: number | null; depth: number | null; expiry: string; url?: string;
  match: "this" | "same" | "similar"; matchNote?: string; best?: boolean; used?: boolean;
}
export interface Comparison {
  contractId: string; side: "yes" | "no"; peril: string; rows: VenueQuoteRow[]; usedVenue: VenueId; bestVenue: VenueId | null;
  verdict: "agree" | "close" | "differ" | "single" | "similar-only"; spreadPts: number | null; headline: string; flags: string[]; why: string; asOf: string;
}

const mid = (c: MarketContract, side: "yes" | "no") => {
  const m = c.yesAsk !== null && c.yesBid !== null ? (c.yesAsk + c.yesBid) / 2 : c.yesAsk ?? c.yesBid;
  return m == null ? null : side === "yes" ? m : 1 - m;
};

/** Offline comparison from the quote line alone (+ its Polymarket cross-check). Used when the API is unavailable. */
export function localComparison(line: QuoteLine): Comparison {
  const c = line.contract;
  const rows: VenueQuoteRow[] = [{
    venue: c.venue, role: VENUES[c.venue].role, contractId: c.id, title: c.eventTitle, label: c.label, side: line.side,
    prob: mid(c, line.side) ?? line.impliedProb, ask: line.side === "yes" ? c.yesAsk : c.noAsk, depth: (line.side === "yes" ? c.depthYes : c.depthNo) ?? null,
    expiry: c.expiry, url: c.url, match: "this", used: true, best: true,
  }];
  const cc = line.crossCheck;
  if (cc) rows.push({ venue: "polymarket", role: "reference", contractId: cc.contractId, title: cc.title, label: cc.title, side: line.side, prob: cc.prob, ask: null, depth: null, expiry: c.expiry, url: cc.url, match: cc.exact ? "same" : "similar" });
  const diff = cc ? Math.round((cc.prob - (rows[0].prob ?? 0)) * 100) : 0;
  const verdict: Comparison["verdict"] = !cc ? "single" : !cc.exact ? "similar-only" : Math.abs(diff) <= 3 ? "agree" : Math.abs(diff) <= 7 ? "close" : "differ";
  return {
    contractId: c.id, side: line.side, peril: c.peril, rows, usedVenue: c.venue, bestVenue: c.venue, verdict, spreadPts: cc ? Math.abs(diff) : null,
    headline: rows.map((r) => `${venueName(r.venue)} ${fmtChance(r.prob)}`).join(" · "),
    flags: cc && cc.exact && Math.abs(diff) >= 4 ? [`Polymarket is ${Math.abs(diff)} pts ${diff > 0 ? "higher" : "lower"} than ${venueName(c.venue)}`] : [],
    why: c.venue === "gemini" ? VENUES.gemini.desc : c.venue === "kalshi" ? "Gemini doesn't list this market, so we use Kalshi. You still get a Solana outcome token." : VENUES.polymarket.desc,
    asOf: new Date().toISOString(),
  };
}

const memo = new Map<string, { t: number; p: Promise<Comparison> }>();

/** Cross-venue comparison for a quote line (POST /api/markets/compare), memoized 30s; falls back to localComparison. */
export function getComparison(line: QuoteLine): Promise<Comparison> {
  const key = `${line.contractId}|${line.side}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < 30_000) return hit.p;
  const p = (async () => {
    try {
      const r = await fetch("/api/markets/compare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contract: line.contract, side: line.side }), cache: "no-store" });
      if (!r.ok) throw new Error(`compare ${r.status}`);
      return (await r.json()) as Comparison;
    } catch {
      return localComparison(line);
    }
  })();
  memo.set(key, { t: Date.now(), p });
  return p;
}

/** /markets deep link for a risk: group + city. */
export function marketsHref(peril: string, location?: string): string {
  const group = peril === "heat" || peril === "cold" ? "heat" : peril === "game" ? "games" : peril === "oil" || peril === "gas" ? "energy" : peril === "fed" || peril === "cpi" ? "rates"
    : peril === "water" || peril === "quake" || peril === "storm" ? "disaster" : peril === "natgas" || peril === "metals" ? "commodities" : peril;
  const sp = new URLSearchParams({ risk: group });
  const city = (location ?? "").split(",")[0].trim();
  if (city && city !== "US" && ["heat", "rain", "snow", "power", "disaster"].includes(group)) sp.set("city", city);
  return `/markets?${sp.toString()}`;
}
