// One open policy per owner + business + market: /api/cover/buy and /api/cover/buy-plan refuse a second one
// (QA: a reload lost the plan's "Covered" state and the same cover could be bought twice).
import type { DecodedPolicy } from "../solana/policyClient";
import { store } from "../store";
import { VenueError } from "./types";

/** The open policy (if any) that already covers this business on this market. `businessOf` = our record's businessId. */
export function findDuplicate(
  onchain: Pick<DecodedPolicy, "pda" | "policyId" | "marketRef" | "status">[],
  businessOf: (pda: string) => string | null | undefined,
  want: { businessId?: string | null; marketRef: string },
) {
  const biz = want.businessId ?? null;
  return onchain.find((p) => p.status === "open" && p.marketRef === want.marketRef && (businessOf(p.pda) ?? null) === biz);
}

/** Throws 409 already_covered when the owner already holds an open policy for this business + market. */
export function assertNotCovered(onchain: DecodedPolicy[], want: { businessId?: string | null; marketRef: string }) {
  const dup = findDuplicate(onchain, (pda) => (store.get("policies", pda) as { businessId?: string | null } | undefined)?.businessId, want);
  if (dup) throw new VenueError(`You already have an open policy on this market (#${dup.policyId}).`, 409, "already_covered");
}

/** The owner's on-chain policies, or [] if the RPC is down (the guard then fails open; the buy itself still needs RPC). */
export async function ownerPolicies(list: () => Promise<DecodedPolicy[]>): Promise<DecodedPolicy[]> {
  try { return await list(); } catch { return []; }
}
