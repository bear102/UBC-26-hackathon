// Pure pricing helpers (unit-tested).
import type { MarketContract } from "../types";
import { VenueError, type Side } from "./types";

export const MAX_ASK = 0.85;           // above this it's not "insurance" (DESIGN §3 step 4)
export const MAX_CONTRACTS = 10_000;

export function askFor(c: MarketContract, side: Side): number | null {
  const v = side === "yes" ? c.yesAsk : c.noAsk;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Mark price for an open position: best bid on our side, else mid/ask, else last-resolved value. */
export function markFor(c: MarketContract, side: Side): number | null {
  if (c.status === "settled" && c.resolution) return c.resolution === side ? 1 : 0;
  const bid = side === "yes" ? c.yesBid : c.noBid;
  if (typeof bid === "number" && Number.isFinite(bid)) return bid;
  return askFor(c, side);
}

/** Validates the contract/side/size and returns the price the owner pays.
 *  costUsd = contracts × ask, rounded UP to whole cents; raw = costUsd in base units of the settlement token. */
export function priceBuy(c: MarketContract, side: Side, contracts: number, decimals = 6) {
  if (!Number.isInteger(contracts) || contracts < 1 || contracts > MAX_CONTRACTS) throw new VenueError(`contracts must be an integer 1..${MAX_CONTRACTS}`);
  if (side !== "yes" && side !== "no") throw new VenueError("side must be yes|no");
  if (c.status !== "open") throw new VenueError(`market ${c.id} is ${c.status}, not open`);
  const ask = askFor(c, side);
  if (ask == null || ask <= 0) throw new VenueError(`no ${side} ask for ${c.id}`);
  if (ask > MAX_ASK) throw new VenueError(`${side} ask ${ask} > ${MAX_ASK}: too expensive to be insurance`);
  if (ask >= 1) throw new VenueError(`bad ask ${ask}`);
  const cents = centsUp(contracts * ask);
  return { ask, costUsd: cents / 100, raw: usdToRaw(cents / 100, decimals) };
}

/** Round a dollar amount up to whole cents, tolerating float noise (0.07*3 = 0.21000000000000002 -> 21). */
export function centsUp(usd: number): number {
  return Math.ceil(Math.round(usd * 100 * 1e6) / 1e6);
}

export function usdToRaw(usd: number, decimals = 6): bigint {
  // via integer cents to avoid float error
  const cents = BigInt(Math.round(usd * 100));
  return decimals >= 2 ? cents * 10n ** BigInt(decimals - 2) : cents / 10n ** BigInt(2 - decimals);
}

export function rawToUsd(raw: bigint, decimals = 6): number {
  return Number(raw) / 10 ** decimals;
}
