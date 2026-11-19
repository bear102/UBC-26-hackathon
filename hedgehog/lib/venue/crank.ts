// Settlement crank logic (used by scripts/worker.ts). For open positions: when the market settles, redeem winners and
// mark losers; when it is voided (settled with no YES/NO for VOID_AFTER_MS past expiry) refund the premium.
// Also recovers devnet buys whose confirm call never arrived (memo lookup).
// Hedgehog Cover policies (when `cover` is given): settle_policy from the official resolution (outcome = resolution ==
// the policy's side), or expire_policy (premium refund) once expiry + grace has passed without one. A policy whose
// market is real but still awaiting the venue's result (closed / under review) is held open up to RESULT_WAIT_MS past
// its deadline (settle_policy has no onchain deadline), so a slow venue pays out instead of refunding. Measured lags:
// docs/SETTLEMENT.md.
import { store } from "../store";
import type { MarketContract, Position } from "../types";
import { OwnerSignatureRequired, type GetContract, type Venue } from "./types";

export const VOID_AFTER_MS = 24 * 3600_000;
/** How long past a policy's expiry + grace the crank keeps waiting for a venue result before refunding. */
export const RESULT_WAIT_MS = () => (Number(process.env.COVER_RESULT_WAIT_H) || 72) * 3600_000;

/** The venue has not posted YES/NO yet for a live (not voided) market: keep the policy open instead of refunding. */
export function awaitingResult(c: MarketContract, policyExpiry: string, now = Date.now()): boolean {
  if (c.status === "settled") return false; // settled without YES/NO = cancelled: refund
  const exp = Date.parse(policyExpiry);
  return Number.isFinite(exp) && now < exp + RESULT_WAIT_MS();
}

/** A market that settled without a YES/NO answer (cancelled/voided), a day past its expiry. */
export function isVoided(c: MarketContract, now = Date.now()): boolean {
  if (c.status !== "settled" || c.resolution === "yes" || c.resolution === "no") return false;
  const exp = Date.parse(c.expiry);
  return Number.isFinite(exp) && now - exp > VOID_AFTER_MS;
}

export interface CoverCrank {
  graceSecs: number;
  listOpen(): Promise<{ pda: string; marketRef: string; expiry: string; policyId: number; payoutUsd: number; premiumUsd: number; owner: string }[]>;
  settle(pda: string, outcome: boolean): Promise<string>;
  expire(pda: string): Promise<string>;
}
export interface CrankDeps { getContract: GetContract; venueFor: (network: Position["network"]) => Venue; log?: (s: string) => void; cover?: CoverCrank; now?: () => number }
export interface CrankResult { checked: number; confirmed: number; won: number; lost: number; redeemed: number; voided: number; policiesSettled: number; policiesExpired: number; policiesAwaiting?: number; errors: string[] }

export async function runCrank(d: CrankDeps): Promise<CrankResult> {
  const log = d.log ?? (() => {});
  const res: CrankResult = { checked: 0, confirmed: 0, won: 0, lost: 0, redeemed: 0, voided: 0, policiesSettled: 0, policiesExpired: 0, errors: [] };
  const nowMs = d.now ?? Date.now;
  const contracts = new Map<string, MarketContract | null>();
  const lookupFailed = new Set<string>(); // venue API error this pass (vs. "not found"): never refund on a blip
  const contractOf = async (id: string) => {
    if (!contracts.has(id)) contracts.set(id, await d.getContract(id).catch((e) => { res.errors.push(`getContract ${id}: ${e}`); lookupFailed.add(id); return null; }));
    return contracts.get(id)!;
  };

  for (let pos of store.list("positions").filter((p) => p.status === "open" || p.status === "won")) {
    res.checked++;
    const venue = d.venueFor(pos.network);
    try {
      if (!pos.txSig) {
        const v = venue as Venue & { findBuySignature?: (p: Position) => Promise<string | null> };
        if (!v.findBuySignature || Date.now() - Date.parse(pos.createdAt) > 24 * 3600_000) continue;
        const sig = await v.findBuySignature(pos);
        if (!sig) continue;
        pos = await venue.confirmBuy(pos.id, sig);
        res.confirmed++; log(`confirmed ${pos.id} via memo lookup: ${sig}`);
      }
      const c = await contractOf(pos.contractId);
      if (c && pos.status === "open" && isVoided(c, nowMs()) && venue.refund) {
        const r = await venue.refund(pos);
        store.upsert("positions", { ...pos, status: "redeemed", voided: true, settledAt: new Date().toISOString(), payoutUsd: r.payoutUsd, redeemTxSig: r.txSig || undefined });
        store.feed({ id: `voided:${pos.id}`, source: "crank", kind: "redeemed", positionId: pos.id, txSig: r.txSig || undefined,
          text: `${c.eventTitle || c.id} was cancelled (no YES/NO result): refunded $${r.payoutUsd.toFixed(2)} premium to ${pos.owner.slice(0, 4)}…${pos.owner.slice(-4)}` });
        res.voided++; log(`voided ${pos.id}: refunded $${r.payoutUsd} ${r.txSig}`);
        continue;
      }
      if (!c || c.status !== "settled" || (c.resolution !== "yes" && c.resolution !== "no")) continue;
      const now = new Date().toISOString();
      const won = c.resolution === pos.side;
      if (pos.status === "open") {
        store.feed({ id: `resolved:${pos.id}`, source: "crank", kind: "resolved", positionId: pos.id,
          text: `${c.eventTitle || c.id} — ${c.label || ""} settled ${c.resolution.toUpperCase()}: ${pos.side.toUpperCase()} hedge ${won ? "pays out" : "expired (premium was the cost of cover)"}` });
        if (!won) {
          store.upsert("positions", { ...pos, status: "lost", settledAt: now, payoutUsd: 0 });
          res.lost++; log(`lost ${pos.id}`); continue;
        }
        pos = store.upsert("positions", { ...pos, status: "won", settledAt: now });
        res.won++;
      }
      try {
        const r = await venue.redeem(pos);
        store.upsert("positions", { ...pos, status: "redeemed", payoutUsd: r.payoutUsd, redeemTxSig: r.txSig || undefined });
        store.feed({ id: `redeemed:${pos.id}`, source: "crank", kind: "redeemed", positionId: pos.id, txSig: r.txSig || undefined,
          text: r.payoutUsd > 0 ? `Paid $${r.payoutUsd.toFixed(2)} to ${pos.owner.slice(0, 4)}…${pos.owner.slice(-4)} for ${pos.contractId} (${pos.network})`
            : `Nothing to pay for ${pos.id}: outcome tokens no longer in the owner's wallet` });
        res.redeemed++; log(`redeemed ${pos.id}: $${r.payoutUsd} ${r.txSig}`);
      } catch (e) {
        if (e instanceof OwnerSignatureRequired) {
          store.feed({ id: `redeem-needed:${pos.id}`, source: "crank", kind: "info", positionId: pos.id, text: `Hedge ${pos.id} won — sign the redemption in the app to collect $${pos.contracts}` });
        } else throw e;
      }
    } catch (e) {
      const msg = `${pos.id}: ${(e as Error).message ?? e}`;
      res.errors.push(msg); log(`error ${msg}`);
    }
  }
  if (d.cover) await crankPolicies(d.cover, contractOf, res, log, nowMs, lookupFailed);
  return res;
}

async function crankPolicies(cover: CoverCrank, contractOf: (id: string) => Promise<MarketContract | null>, res: CrankResult, log: (s: string) => void, nowMs: () => number, lookupFailed: Set<string> = new Set()) {
  let open: Awaited<ReturnType<CoverCrank["listOpen"]>>;
  try { open = await cover.listOpen(); } catch (e) { res.errors.push(`listPolicies: ${(e as Error).message}`); return; }
  for (const p of open) {
    try {
      const local = store.get("policies", p.pda) as Record<string, unknown> | undefined;
      // The paying side is recorded off-chain at quote time; never guess it (a NO-side policy settled as YES would pay
      // the wrong outcome). Unknown side -> no settlement; the owner gets the premium back after expiry + grace.
      const side = local?.side === "no" || local?.side === "yes" ? local.side : null;
      const c = side && p.marketRef.includes(":") ? await contractOf(p.marketRef) : null;
      const now = new Date().toISOString();
      if (c && c.status === "settled" && (c.resolution === "yes" || c.resolution === "no")) {
        const hit = c.resolution === side;
        const sig = await cover.settle(p.pda, hit);
        store.upsert("policies", { ...(local ?? {}), id: p.pda, status: hit ? "paidOut" : "expired", settledAt: now, settleTxSig: sig });
        store.feed({ id: `policy_settled:${p.pda}`, source: "crank", kind: "policy_settled", txSig: sig,
          text: hit ? `Cover #${p.policyId} triggered (${c.eventTitle || c.id} settled ${c.resolution.toUpperCase()}): paid ${p.payoutUsd} USDC to ${p.owner.slice(0, 4)}…`
            : `Cover #${p.policyId} (${c.eventTitle || c.id}) settled ${c.resolution.toUpperCase()}: no payout, premium was the cost of cover` });
        res.policiesSettled++; log(`policy ${p.pda} settled ${hit ? "YES (paid)" : "NO"}: ${sig}`);
      } else if (nowMs() > Date.parse(p.expiry) + cover.graceSecs * 1000) {
        if (side && lookupFailed.has(p.marketRef)) continue; // retry next pass
        if (c && awaitingResult(c, p.expiry, nowMs())) { res.policiesAwaiting = (res.policiesAwaiting ?? 0) + 1; continue; }
        const sig = await cover.expire(p.pda);
        store.upsert("policies", { ...(local ?? {}), id: p.pda, status: "refunded", settledAt: now, settleTxSig: sig });
        store.feed({ id: `policy_expired:${p.pda}`, source: "crank", kind: "policy_settled", txSig: sig,
          text: `Cover #${p.policyId} (${p.marketRef}) had no YES/NO result by its deadline: ${p.premiumUsd} USDC premium refunded` });
        res.policiesExpired++; log(`policy ${p.pda} expired (refund): ${sig}`);
      }
    } catch (e) {
      const msg = `policy ${p.pda}: ${(e as Error).message ?? e}`;
      res.errors.push(msg); log(`error ${msg}`);
    }
  }
}
