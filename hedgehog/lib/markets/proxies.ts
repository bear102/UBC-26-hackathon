// Real-market coverage for risks with no direct market (hail, flood, wildfire, air quality), plus the one switch that
// turns Hedgehog-made parametric contracts on or off.
//
// USER DECISION (2026-11-19): hedges use ONLY real markets on Gemini, Kalshi and Polymarket. Hedgehog parametric
// contracts (lib/markets/parametric, venue "hedgehog") are OFF unless HEDGEHOG_PARAMETRIC=1. Existing devnet policies
// on hedgehog:* contracts still settle: getContract("hedgehog:...") ignores this flag.
import type { MarketContract, Peril } from "../types";
import { contractMeta, parseBounds } from "./normalize";

/** Hedgehog parametric contracts in search, explorer, playbook and AI catalog. Default OFF. */
export const parametricEnabled = (): boolean => process.env.HEDGEHOG_PARAMETRIC === "1";

/**
 * The closest REAL market family for a risk no exchange lists directly, the side of it that tracks the loss, and the
 * honest basis-risk note shown to the AI (and through it, to the owner).
 *  wet  = YES pays on a lot of rain / high water (bounds with only a lower edge: "Above 4 inches", '>5.75"', "19 ft or more")
 *  dry  = YES pays on little rain (only an upper edge: '<3"', "Below 1 inch", or "Drier than normal")
 *  high = YES pays on a high count (tornadoes "60 or more", "Above 100")
 */
export interface Proxy { perils: Peril[]; side: "wet" | "dry" | "high"; titleRe?: RegExp; note: string }
export const PROXIES: Partial<Record<Peril, Proxy>> = {
  hail: {
    perils: ["storm"], side: "high", titleRe: /tornado/i,
    note: "No hail market exists. A high US tornado count comes with the same severe-storm outbreaks that bring hail. Take the side that pays on MORE tornadoes; it pays on a bad storm month nationwide, not on hail at your address.",
  },
  flood: {
    perils: ["rain"], side: "wet",
    note: "No flood market for your area. A very wet month is the usual cause of local flooding. Take the side that pays on MORE rain (YES on 'above N', NO on 'below N'); it pays on the rain at the official station, not on water in your building.",
  },
  wildfire: {
    perils: ["rain"], side: "dry",
    note: "No wildfire or acres-burned market is listed. Fires spread after dry spells. Take the side that pays on LESS rain (NO on 'above N', YES on 'below N' or 'Drier'); it pays on the dry spell, not on a fire near you.",
  },
};
/** Plain reason when neither a direct nor a proxy market is live (shown under "Not coverable (yet)"). */
export const NO_MARKET: Partial<Record<Peril, string>> = {
  smoke: "No exchange lists air quality or smoke, and no wildfire market is live to stand in for it.",
  hail: "No hail market, and no US storm-count market is open for this window.",
  flood: "No flood or river market near you, and no rain-total market for your city in this window.",
  wildfire: "No wildfire market, and no dry-season rain market for your area in this window.",
};

export const proxyPerils = (p: Peril): Peril[] => PROXIES[p]?.perils ?? [];

/** Does a contract from a proxy family sit on the side that tracks the risk? (direct-peril contracts always pass) */
export function proxyFits(riskPeril: Peril, c: MarketContract): boolean {
  const px = PROXIES[riskPeril];
  if (!px || c.peril === riskPeril) return true;
  if (!px.perils.includes(c.peril)) return false;
  if (px.titleRe && !px.titleRe.test(c.eventTitle)) return false;
  // a one-sided strike ("Above 5 inches", '<3"', "60 or more") hedges either way (YES or NO is the protective side);
  // a two-sided bin ("3-4.5"") or a one-day "will it rain" market does not track a wet / dry month or a storm season
  const b = contractMeta(c.id)?.bounds ?? parseBounds(c.label);
  if (px.side === "dry" && /drier/i.test(c.label)) return true;
  return !!b && (b.lo === undefined) !== (b.hi === undefined);
}

/** Storm sub-type words: a hurricane risk wants landfall markets, a hail / tornado risk wants tornado counts. */
const STORM_KINDS: [string, RegExp][] = [["hurricane", /hurricane|tropical|landfall/i], ["tornado", /tornado|hail|severe storm/i], ["disaster", /billion-dollar|disasters?\b/i]];
/** +1.5 when a storm contract is the kind the risk names, -1.5 when it is another kind, 0 otherwise / not a storm. */
export function stormKindScore(riskText: string, c: MarketContract): number {
  if (c.peril !== "storm") return 0;
  const want = STORM_KINDS.filter(([, re]) => re.test(riskText)).map(([k]) => k);
  if (!want.length) return 0;
  const have = STORM_KINDS.filter(([, re]) => re.test(c.eventTitle)).map(([k]) => k);
  if (!have.length) return 0;
  return have.some((k) => want.includes(k)) ? 1.5 : -1.5;
}

/** Basis-risk note for a proxy candidate (undefined for direct-peril contracts). */
export const proxyNote = (riskPeril: Peril, c: MarketContract): string | undefined =>
  c.peril !== riskPeril && PROXIES[riskPeril]?.perils.includes(c.peril) ? PROXIES[riskPeril]!.note : undefined;

/** Reason a risk has no candidates: the peril's own plain reason, else the generic one. */
export function noMarketReason(peril: Peril, where: string): string {
  return NO_MARKET[peril] ?? `No live market for ${peril}${where}.`;
}

// ---------- US states (hurricane landfall by state, statewide rain / quake markets) ----------

export const STATE_CODES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};
const STATE_NAMES = new Set(Object.values(STATE_CODES).map((s) => s.toLowerCase()));

/** "Austin, TX" -> "texas"; "Texas" -> "texas"; "Cocoa, FL" -> "florida"; anything else -> undefined. */
export function stateOf(place: string | undefined): string | undefined {
  const s = (place ?? "").trim();
  const m = s.match(/,\s*([A-Z]{2})\b/);
  if (m && STATE_CODES[m[1]]) return STATE_CODES[m[1]].toLowerCase();
  return STATE_NAMES.has(s.toLowerCase()) ? s.toLowerCase() : undefined;
}
/** Is the contract place a whole US state that contains the business ("Texas" for "Austin, TX")? */
export const sameState = (contractLoc: string | undefined, businessLoc: string | undefined): boolean => {
  const c = (contractLoc ?? "").trim().toLowerCase();
  return STATE_NAMES.has(c) && stateOf(businessLoc) === c;
};
/** A nationwide place label ("US", "United States") or none. */
export const isNationalPlace = (loc: string | undefined): boolean => !loc || /^(us|usa|u\.s\.|united states|national)$/i.test(loc.trim());
