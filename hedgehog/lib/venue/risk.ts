// Desk risk controls for outcome tokens sold by the mock venue (DEVNET) and Cover policies.
// (docs/FLOW-AUDIT.md F3/F5/F6.) The Cover program tracks its own exposure against the vault on-chain; tokens are
// paid from the desk wallet, so this ledger is what stops the desk from selling more $1 payouts than it should carry.
//
//  - exposure ledger: worst-case payout ($1 × contracts) of every confirmed open/won position, plus buys built in
//    the last PENDING_TTL_MS that may still land (their desk co-signature dies with the blockhash, ~60-90 s).
//  - caps: DESK_MAX_EXPOSURE_USD (all markets, default 500) and DESK_MAX_PER_MARKET_USD (one contract, default 100).
//  - backing circuit breaker: if the desk could not back a previous Gemini sale on a contract (error/rejected/partial),
//    stop selling that contract until someone looks (clear by deleting the hedge row or setting DESK_IGNORE_BACKING=1).
//    Armed when backing is LIVE (HEDGE_LIVE=1 + keys) or DESK_BACKING_BREAKER=1; in dry-run nothing is really hedged,
//    so a transient Gemini API error at confirm time must not pause a demo market.
import { store } from "../store";
import { liveEnabled } from "./geminiHedge";
import type { Position } from "../types";
import type { DeskHedge } from "./geminiHedge";
import { VenueError } from "./types";

export const PENDING_TTL_MS = 3 * 60_000;

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};
export const deskLimits = () => ({
  maxTotalUsd: num("DESK_MAX_EXPOSURE_USD", 500),
  maxPerMarketUsd: num("DESK_MAX_PER_MARKET_USD", 100),
});

/** Worst-case $ the desk owes on outcome tokens if a position's side wins. */
export function positionLiability(p: Position, now = Date.now()): number {
  if (p.network !== "devnet") return 0; // mainnet DFlow tokens are paid by Kalshi/DFlow, not the desk
  if (p.status === "open" || p.status === "won") {
    if (p.txSig) return p.contracts;
    return now - Date.parse(p.createdAt) < PENDING_TTL_MS ? p.contracts : 0; // built, may still land
  }
  return 0;
}

export interface Exposure { totalUsd: number; byContract: Record<string, number>; openPositions: number; pendingPositions: number }

export function deskExposure(positions: Position[] = store.list("positions"), now = Date.now()): Exposure {
  const byContract: Record<string, number> = {};
  let totalUsd = 0, openPositions = 0, pendingPositions = 0;
  for (const p of positions) {
    const l = positionLiability(p, now);
    if (!l) continue;
    byContract[p.contractId] = (byContract[p.contractId] ?? 0) + l;
    totalUsd += l;
    if (p.txSig) openPositions++; else pendingPositions++;
  }
  return { totalUsd, byContract, openPositions, pendingPositions };
}

/** Throws 409 `capacity` when selling `contracts` more of `contractId` would breach a cap. */
export function checkCapacity(contractId: string, contracts: number, exp: Exposure = deskExposure(), lim = deskLimits()) {
  const onMarket = exp.byContract[contractId] ?? 0;
  if (onMarket + contracts > lim.maxPerMarketUsd) {
    const left = Math.max(0, Math.floor(lim.maxPerMarketUsd - onMarket));
    throw new VenueError(`desk capacity: at most $${lim.maxPerMarketUsd} of payouts per market (${left} contracts left on ${contractId})`, 409, "capacity");
  }
  if (exp.totalUsd + contracts > lim.maxTotalUsd) {
    const left = Math.max(0, Math.floor(lim.maxTotalUsd - exp.totalUsd));
    throw new VenueError(`desk capacity: at most $${lim.maxTotalUsd} of open payouts in total (${left} contracts left)`, 409, "capacity");
  }
}

const BAD_BACKING: DeskHedge["status"][] = ["error", "rejected", "partial"];

/** Previous sales on this contract the desk could not (fully) back. */
export function unbackedHedges(contractId: string, hedges: DeskHedge[] = store.list("hedges")): DeskHedge[] {
  return hedges.filter((h) => h.contractId === contractId && BAD_BACKING.includes(h.status));
}

/** Throws 409 `backing_failed` if a previous Gemini backing order on this contract failed (circuit breaker). */
export function checkBacking(contractId: string, hedges?: DeskHedge[]) {
  if (process.env.DESK_IGNORE_BACKING === "1" || !contractId.startsWith("gemini:")) return;
  if (!liveEnabled() && process.env.DESK_BACKING_BREAKER !== "1") return;
  const bad = unbackedHedges(contractId, hedges);
  if (bad.length) throw new VenueError(`sales paused on ${contractId}: the desk could not back an earlier sale on Gemini (${bad[0].status}${bad[0].error ? `: ${bad[0].error}` : ""})`, 409, "backing_failed");
}

/** Throws 409 `price_moved` when the server price exceeds what the owner was shown (+1% and 1¢ tolerance). */
export function checkPriceMoved(serverUsd: number, shownUsd?: number) {
  if (shownUsd == null || !Number.isFinite(shownUsd)) return;
  if (serverUsd > shownUsd * 1.01 + 0.01) throw new VenueError(`price moved: now $${serverUsd.toFixed(2)} (you saw $${shownUsd.toFixed(2)}); refresh the quote`, 409, "price_moved");
}
