// Settlement crank logic (used by scripts/worker.ts). For open positions: when the market settles, redeem winners and
// mark losers. Also recovers devnet buys whose confirm call never arrived (memo lookup).
import { store } from "../store";
import type { MarketContract, Position } from "../types";
import { OwnerSignatureRequired, type GetContract, type Venue } from "./types";

export interface CrankDeps { getContract: GetContract; venueFor: (network: Position["network"]) => Venue; log?: (s: string) => void }
export interface CrankResult { checked: number; confirmed: number; won: number; lost: number; redeemed: number; errors: string[] }

export async function runCrank(d: CrankDeps): Promise<CrankResult> {
  const log = d.log ?? (() => {});
  const res: CrankResult = { checked: 0, confirmed: 0, won: 0, lost: 0, redeemed: 0, errors: [] };
  const contracts = new Map<string, MarketContract | null>();
  const contractOf = async (id: string) => {
    if (!contracts.has(id)) contracts.set(id, await d.getContract(id).catch((e) => { res.errors.push(`getContract ${id}: ${e}`); return null; }));
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
  return res;
}
