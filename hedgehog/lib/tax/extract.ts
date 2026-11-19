// Tax record: pure extraction from parsed Solana transactions (no RPC, no Next). Used by lib/tax/record.ts.
// Amounts come from the chain only: the hedgehog_policy program's Anchor events (PolicyBought / PolicySettled /
// PolicyExpired, emitted as "Program data:" logs) split a tx per policy, and the owner's token delta from
// pre/postTokenBalances must match their sum (`verified`).
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import type { ParsedTransactionWithMeta, TokenBalance } from "@solana/web3.js";
import idlJson from "../solana/idl/hedgehog_policy.json";

export const POLICY_PROGRAM_ID = idlJson.address;
export const TOKEN_DECIMALS = 6;
const coder = new BorshCoder(idlJson as Idl);

export type TaxType = "premium" | "payout" | "refund";
export type Instr = "BuyPolicy" | "SettlePolicy" | "ExpirePolicy";
const INSTR_TYPE: Record<Instr, TaxType> = { BuyPolicy: "premium", SettlePolicy: "payout", ExpirePolicy: "refund" };

/** One money movement for one policy inside one tx, as read from the chain. */
export interface TxEvent {
  instruction: Instr;
  type: TaxType;
  policy: string | null; // policy PDA (from the event); null only on the no-event fallback
  amountUsd: number; // signed, from the owner's point of view (premium < 0)
  outcome?: boolean; // SettlePolicy only
}

/** Per-tx summary (immutable once confirmed, so it is safe to cache forever). */
export interface TxSummary {
  signature: string;
  slot: number;
  blockTime: number | null; // unix secs
  failed: boolean;
  events: TxEvent[];
  ownerDeltaUsd: number; // owner's net token change for the settlement mint in this tx
  mint: string | null;
  verified: boolean; // sum(events) == ownerDelta
}

const usdOf = (units: bigint | number | string) => Number(units.toString()) / 10 ** TOKEN_DECIMALS;

/**
 * Walk the logs with an invoke stack so we only read "Instruction:" and "Program data:" lines our program emitted
 * (not a CPI'd token program or another program in the same tx).
 */
export function programLogs(logs: string[], programId = POLICY_PROGRAM_ID): { instructions: Instr[]; data: string[] } {
  const stack: string[] = [];
  const instructions: Instr[] = [];
  const data: string[] = [];
  for (const l of logs) {
    let m = l.match(/^Program (\w+) invoke \[\d+\]$/);
    if (m) { stack.push(m[1]); continue; }
    m = l.match(/^Program (\w+) (success|failed)/);
    if (m) { stack.pop(); continue; }
    if (stack[stack.length - 1] !== programId) continue;
    m = l.match(/^Program log: Instruction: (BuyPolicy|SettlePolicy|ExpirePolicy)$/);
    if (m) { instructions.push(m[1] as Instr); continue; }
    m = l.match(/^Program data: (.+)$/);
    if (m) data.push(m[1]);
  }
  return { instructions, data };
}

/** Owner's net token change per mint in a tx (post - pre), in base units. */
export function ownerDeltas(tx: ParsedTransactionWithMeta, owner: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const add = (bals: TokenBalance[] | null | undefined, sign: bigint) => {
    for (const b of bals ?? []) {
      if (b.owner !== owner) continue;
      out.set(b.mint, (out.get(b.mint) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
    }
  };
  add(tx.meta?.preTokenBalances, -1n);
  add(tx.meta?.postTokenBalances, 1n);
  return out;
}

/** Classify a parsed tx and extract the owner's Hedgehog Cover money events. */
export function summarizeTx(signature: string, tx: ParsedTransactionWithMeta, owner: string, preferMint?: string): TxSummary {
  const failed = !!tx.meta?.err;
  const { instructions, data } = programLogs(tx.meta?.logMessages ?? []);
  const events: TxEvent[] = [];
  for (const b64 of data) {
    type Ev = { name: string; data: Record<string, unknown> };
    let ev: Ev | null = null;
    try { ev = coder.events.decode(b64) as Ev | null; } catch { ev = null; }
    if (!ev) continue;
    const d = ev.data as Record<string, { toString(): string; toBase58?: () => string } | boolean>;
    const evOwner = (d.owner as { toBase58(): string } | undefined)?.toBase58();
    if (evOwner && evOwner !== owner) continue; // someone else's policy in the same tx
    const policy = (d.policy as { toBase58(): string }).toBase58();
    if (ev.name === "PolicyBought") events.push({ instruction: "BuyPolicy", type: "premium", policy, amountUsd: -usdOf(d.premium.toString()) });
    else if (ev.name === "PolicySettled") {
      const paid = usdOf(d.paid.toString());
      if (paid > 0) events.push({ instruction: "SettlePolicy", type: "payout", policy, amountUsd: paid, outcome: d.outcome === true });
    } else if (ev.name === "PolicyExpired") {
      const refund = usdOf(d.refund.toString());
      if (refund > 0) events.push({ instruction: "ExpirePolicy", type: "refund", policy, amountUsd: refund });
    }
  }

  const deltas = ownerDeltas(tx, owner);
  let mint: string | null = preferMint && deltas.has(preferMint) ? preferMint : null;
  if (!mint) for (const [k, v] of deltas) if (v !== 0n) { mint = k; break; }
  const ownerDeltaUsd = mint ? usdOf(deltas.get(mint) ?? 0n) : 0;

  // Fallback (no decodable events, e.g. an older program build): one policy instruction -> the whole owner delta.
  if (!events.length && !failed && instructions.length === 1 && ownerDeltaUsd !== 0) {
    const ins = instructions[0];
    const t = INSTR_TYPE[ins];
    if ((t === "premium") === ownerDeltaUsd < 0) events.push({ instruction: ins, type: t, policy: null, amountUsd: ownerDeltaUsd });
  }
  const sum = events.reduce((a, e) => a + e.amountUsd, 0);
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    failed,
    events: failed ? [] : events,
    ownerDeltaUsd,
    mint,
    verified: !failed && Math.abs(sum - ownerDeltaUsd) < 1e-9,
  };
}

// ---------------------------------------------------------------- rows, totals, CSV

export interface PolicyMeta { pda: string; policyId: number; marketRef: string; peril: string; side: string | null }

export interface TaxRow {
  date: string; // local YYYY-MM-DD in `tz`
  time: string; // ISO UTC
  type: TaxType;
  amountUsd: number; // signed: premium < 0
  policyPda: string;
  policyId: number | null;
  marketRef: string;
  peril: string;
  side: string | null;
  signature: string;
  slot: number;
  explorer: string;
  verified: boolean;
}

export interface TaxTotals { year: number; premiumsPaid: number; payoutsReceived: number; refunds: number; net: number; count: number }

export const explorerTxUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export function localDate(unixSecs: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(unixSecs * 1000));
  } catch {
    return new Date(unixSecs * 1000).toISOString().slice(0, 10);
  }
}

/** Turn tx summaries into rows (oldest first). `policyPda` is used for the no-event fallback. */
export function toRows(txs: { summary: TxSummary; policyPda: string }[], meta: Map<string, PolicyMeta>, tz: string): TaxRow[] {
  const seen = new Set<string>();
  const rows: TaxRow[] = [];
  for (const { summary: s, policyPda } of txs) {
    if (s.failed || s.blockTime == null) continue;
    for (const e of s.events) {
      const pda = e.policy ?? policyPda;
      const key = `${s.signature}:${pda}:${e.type}`;
      if (seen.has(key)) continue; // a batch tx is listed under each of its policies
      seen.add(key);
      const m = meta.get(pda);
      rows.push({
        date: localDate(s.blockTime, tz),
        time: new Date(s.blockTime * 1000).toISOString(),
        type: e.type,
        amountUsd: round2(e.amountUsd),
        policyPda: pda,
        policyId: m?.policyId ?? null,
        marketRef: m?.marketRef ?? "",
        peril: m?.peril ?? "",
        side: m?.side ?? null,
        signature: s.signature,
        slot: s.slot,
        explorer: explorerTxUrl(s.signature),
        verified: s.verified,
      });
    }
  }
  return rows.sort((a, b) => a.time.localeCompare(b.time) || a.slot - b.slot || (a.policyId ?? 0) - (b.policyId ?? 0));
}

const round2 = (n: number) => Math.round(n * 1e6) / 1e6; // keep micro-dollar precision; UI rounds to cents

export const yearOf = (r: TaxRow) => Number(r.date.slice(0, 4));
export const filterYear = (rows: TaxRow[], year?: number | null) => (year ? rows.filter((r) => yearOf(r) === year) : rows);
export const yearsOf = (rows: TaxRow[]) => [...new Set(rows.map(yearOf))].sort((a, b) => b - a);

export function totals(rows: TaxRow[], year: number): TaxTotals {
  const t = { year, premiumsPaid: 0, payoutsReceived: 0, refunds: 0, net: 0, count: 0 };
  for (const r of rows) {
    if (yearOf(r) !== year) continue;
    t.count++;
    if (r.type === "premium") t.premiumsPaid += -r.amountUsd;
    else if (r.type === "payout") t.payoutsReceived += r.amountUsd;
    else t.refunds += r.amountUsd;
  }
  const c = (n: number) => Math.round(n * 100) / 100;
  return { year, premiumsPaid: c(t.premiumsPaid), payoutsReceived: c(t.payoutsReceived), refunds: c(t.refunds), net: c(t.payoutsReceived + t.refunds - t.premiumsPaid), count: t.count };
}

const TYPE_LABEL: Record<TaxType, string> = { premium: "Premium paid", payout: "Payout received", refund: "Premium refund" };

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = ["Date", "Time (UTC)", "Type", "Amount (USD)", "Policy ID", "Market", "Peril", "Side", "Policy account", "Transaction", "Slot", "Explorer", "Verified vs token balance"];

export function toCsv(rows: TaxRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      r.date, r.time, TYPE_LABEL[r.type], r.amountUsd.toFixed(2), r.policyId ?? "", r.marketRef, r.peril, r.side ?? "",
      r.policyPda, r.signature, r.slot, r.explorer, r.verified ? "yes" : "no",
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
