// What the product shows. USER DECISION (2026-11-19): only real markets (Gemini / Kalshi / Polymarket) exist in the
// product; Hedgehog parametric markets are off and test / e2e records are hidden. Data is never deleted: every read
// path (feed, policies, positions, backing, reserves, cover info) filters at read time through this one module.
//
//   HEDGEHOG_SHOW_TEST=1        show everything (debugging; also shows hedgehog:* refs)
//   HEDGEHOG_PARAMETRIC=1       hedgehog:* market refs are real product again (lib/markets/proxies.ts)
//   HEDGEHOG_TEST_OWNERS=a,b    extra wallets whose records count as test
//
// Owner-scoped reads are unaffected: a viewer always sees records they own, even when the wallet is a test wallet.
import { parametricEnabled } from "./markets/proxies";
import type { FeedEvent } from "./types";

/** Repo test wallets: keys/merchant.json (e2e / smoke merchant) and keys/attestor.json (oracle, e2e self-buys). */
export const TEST_OWNERS: readonly string[] = [
  "J4FoVwkNE55ormL59fEnfEFwh8PzXekgg9AFnZMPA81p",
  "5LQKRaTS8nkd1ag37huyKVNBc5iaFDRG1LnCYTvCu5Es",
];
/** businessIds used by scripts, smoke tests and audits (never by a real intake). */
export const TEST_BUSINESS_IDS: readonly string[] = [
  "parametric-demo", "flow-audit", "qn-check", "e2e-test", "smoke-cover-all", "settlement-proof",
];

export const showTest = (): boolean => process.env.HEDGEHOG_SHOW_TEST === "1";

const testOwners = (): Set<string> =>
  new Set([...TEST_OWNERS, ...(process.env.HEDGEHOG_TEST_OWNERS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);

/** A market ref / contract id the product does not show: e2e fixtures, and Hedgehog parametric unless enabled. */
export function isHiddenMarketRef(ref: string | null | undefined): boolean {
  if (!ref || showTest()) return false;
  if (ref.startsWith("e2e:") || ref.includes("#e2e")) return true;
  return ref.startsWith("hedgehog:") && !parametricEnabled();
}

/** Any record with an owner / business / market (position, policy, desk hedge). */
export interface Recordish {
  id?: string | null;
  owner?: string | null;
  businessId?: string | null;
  marketRef?: string | null;
  contractId?: string | null;
}

/**
 * Test / hidden record? `viewer` = the wallet asking (owner-scoped query): its own records are never hidden.
 * Always false with HEDGEHOG_SHOW_TEST=1.
 */
export function isTestRecord(r: Recordish, viewer?: string | null): boolean {
  if (showTest()) return false;
  if (viewer && r.owner && r.owner === viewer) return false;
  if (r.owner && testOwners().has(r.owner)) return true;
  if (r.businessId && (TEST_BUSINESS_IDS.includes(r.businessId) || /^(e2e|smoke|test)[-_:]/i.test(r.businessId))) return true;
  if (r.id && r.id.includes("#e2e")) return true;
  return isHiddenMarketRef(r.marketRef) || isHiddenMarketRef(r.contractId);
}

export const visibleRecords = <T extends Recordish>(rows: T[], viewer?: string | null): T[] =>
  showTest() ? rows : rows.filter((r) => !isTestRecord(r, viewer));

// ---------------------------------------------------------------- feed

type TxRecord = Recordish & { txSig?: string | null; redeemTxSig?: string | null; settleTxSig?: string | null; pda?: string | null; refId?: string | null; kind?: string };
export interface FeedIndex { hiddenIds: Set<string>; hiddenTx: Set<string>; visibleTx: Set<string>; hiddenShortOwners: string[] }

/**
 * Index the records feed events point at (positions by id, policies by PDA, desk hedges by ref, all by tx signature)
 * so an event can be traced to its record. Events are hidden when their record is.
 */
export function feedIndex(records: { positions?: TxRecord[]; policies?: TxRecord[]; hedges?: TxRecord[] }, viewer?: string | null): FeedIndex {
  const idx: FeedIndex = { hiddenIds: new Set(), hiddenTx: new Set(), visibleTx: new Set(), hiddenShortOwners: [] };
  const add = (r: TxRecord, keys: (string | null | undefined)[]) => {
    const hidden = isTestRecord(r, viewer);
    if (hidden) for (const k of keys) if (k) idx.hiddenIds.add(k);
    for (const t of [r.txSig, r.redeemTxSig, r.settleTxSig]) if (t) (hidden ? idx.hiddenTx : idx.visibleTx).add(t);
  };
  for (const p of records.positions ?? []) add(p, [p.id]);
  for (const p of records.policies ?? []) add(p, [p.id, p.pda]);
  for (const h of records.hedges ?? []) add(h, [h.id, h.refId]);
  // crank texts name the owner as "J4Fo…A81p" / "J4Fo…"; a viewer who owns the wallet still sees them
  idx.hiddenShortOwners = [...testOwners()].filter((o) => o !== viewer).map((o) => `${o.slice(0, 4)}…`);
  return idx;
}

/** The record id a feed event id points at ("policy_settled:<pda>", "desk_hedge:hedge:policy:<pda>", "redeemed:<pos>"). */
export function feedRefId(e: Pick<FeedEvent, "id">): string | null {
  const m = e.id.match(/^(?:policy_bought|policy_settled|policy_expired|resolved|redeemed|voided|redeem-needed|fill):(.+)$/)
    ?? e.id.match(/^desk_hedge:hedge:(?:policy|position):(.+)$/);
  return m ? m[1] : null;
}

/**
 * Hide a feed event that belongs to a hidden record. QuickNode events are matched by tx signature; an event that
 * cannot be traced to any record (e.g. "tx touched the desk") stays visible.
 */
export function isHiddenFeedEvent(e: FeedEvent, idx: FeedIndex): boolean {
  if (showTest()) return false;
  if (e.positionId && idx.hiddenIds.has(e.positionId)) return true;
  const ref = feedRefId(e);
  if (ref && idx.hiddenIds.has(ref)) return true;
  if (e.txSig && idx.hiddenTx.has(e.txSig) && !idx.visibleTx.has(e.txSig)) return true;
  const t = e.text ?? "";
  if (/\be2e:|#e2e/.test(t)) return true;
  if (!parametricEnabled() && /\bhedgehog:[a-z]/.test(t)) return true;
  return idx.hiddenShortOwners.some((s) => t.includes(s));
}

// ---------------------------------------------------------------- onchain totals

export interface TestPolicySummary { policies: number; testPolicies: number; openTestPolicies: number; openTestExposureUsd: number; label: string }

/**
 * Split onchain Cover policies into product vs test for display. The vault balance and total exposure are NEVER
 * reduced: test policies are real onchain liabilities backed by the same vault, so hiding them from the totals would
 * misstate the reserves. Counts are shown as "N policies (M test)" and the test share of exposure is reported beside it.
 */
export function summarizeTestPolicies(
  rows: { owner: string; marketRef: string; status: string; payoutUsd: number; pda: string }[],
  businessIdOf: (pda: string) => string | null | undefined = () => undefined,
): TestPolicySummary {
  const test = rows.filter((p) => isTestRecord({ owner: p.owner, marketRef: p.marketRef, businessId: businessIdOf(p.pda) }));
  const open = test.filter((p) => p.status === "open");
  const openTestExposureUsd = Math.round(open.reduce((s, p) => s + p.payoutUsd, 0) * 100) / 100;
  return { policies: rows.length, testPolicies: test.length, openTestPolicies: open.length, openTestExposureUsd, label: `${rows.length} policies (${test.length} test)` };
}
