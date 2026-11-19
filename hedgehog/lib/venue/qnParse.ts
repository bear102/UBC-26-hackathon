// Parser for QuickNode Streams / Webhooks Solana payloads (pure; unit-tested with tests/fixtures/qn-*.json).
// Robust to: raw block arrays ([{ blockHeight, transactions:[...] }]), { data: [...] } wrappers, filter outputs
// ({ matchedTransactions:[...] }), single transactions, getTransaction-style ({ transaction:{signatures,message}, meta })
// and flattened ({ signature, accountKeys, meta }) shapes. accountKeys may be strings or { pubkey } objects.

/** positionIds: when given, a memo-only match (tx touches none of our mints/accounts) must name a known position. */
export interface QnWatch { mints: Set<string>; accounts: Set<string>; positionIds?: Set<string> }
export interface TokenDelta { mint: string; owner?: string; delta: number }
export interface QnHit {
  signature: string;
  kind: "fill" | "transfer";
  positionId?: string;
  redeem: boolean;
  slot?: number;
  deltas: TokenDelta[];
  text: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const MEMO_RE = /hedgehog:(redeem:)?(pos_[a-z0-9]+)/;

function looksLikeTx(o: Obj): boolean {
  const t = o.transaction;
  if (isObj(t) && (Array.isArray(t.signatures) || isObj(t.message))) return true;
  if (Array.isArray(t) && typeof t[0] === "string") return isObj(o.meta);     // [base64, "base64"] encoding
  return typeof o.signature === "string" && (isObj(o.meta) || Array.isArray(o.accountKeys) || Array.isArray(o.accounts));
}

/** Depth-first collection of transaction-like objects anywhere in the payload. */
export function extractTransactions(payload: unknown, out: Obj[] = [], depth = 0, ctx: { slot?: number } = {}): Obj[] {
  if (depth > 8 || payload == null) return out;
  if (Array.isArray(payload)) { for (const v of payload) extractTransactions(v, out, depth + 1, ctx); return out; }
  if (!isObj(payload)) return out;
  if (looksLikeTx(payload)) { out.push(ctx.slot != null && payload.slot == null ? { ...payload, slot: ctx.slot } : payload); return out; }
  const slot = typeof payload.slot === "number" ? payload.slot : typeof payload.parentSlot === "number" ? payload.parentSlot + 1 : ctx.slot;
  for (const v of Object.values(payload)) if (v && typeof v === "object") extractTransactions(v, out, depth + 1, { slot });
  return out;
}

function sigOf(tx: Obj): string | undefined {
  if (typeof tx.signature === "string") return tx.signature;
  const t = tx.transaction;
  if (isObj(t) && Array.isArray(t.signatures) && typeof t.signatures[0] === "string") return t.signatures[0];
  if (Array.isArray(tx.signatures) && typeof tx.signatures[0] === "string") return tx.signatures[0] as string;
  return undefined;
}

function keyStr(k: unknown): string | undefined {
  if (typeof k === "string") return k;
  if (isObj(k) && typeof k.pubkey === "string") return k.pubkey;
  return undefined;
}

export function accountKeysOf(tx: Obj): string[] {
  const keys: string[] = [];
  const t = tx.transaction;
  const msg = isObj(t) ? t.message : undefined;
  const lists: unknown[] = [tx.accountKeys, tx.accounts];
  if (isObj(msg)) lists.push(msg.accountKeys, msg.staticAccountKeys);
  const meta = tx.meta;
  if (isObj(meta) && isObj(meta.loadedAddresses)) lists.push(meta.loadedAddresses.writable, meta.loadedAddresses.readonly);
  for (const l of lists) if (Array.isArray(l)) for (const k of l) { const s = keyStr(k); if (s) keys.push(s); }
  return keys;
}

function amt(b: Obj): number {
  const u = b.uiTokenAmount;
  if (isObj(u)) {
    if (typeof u.uiAmountString === "string") return Number(u.uiAmountString);
    if (typeof u.uiAmount === "number") return u.uiAmount;
    if (typeof u.amount === "string") return Number(u.amount) / 10 ** (Number(u.decimals) || 0);
  }
  return Number(b.amount ?? 0) || 0;
}

export function tokenDeltas(tx: Obj): TokenDelta[] {
  const meta = isObj(tx.meta) ? tx.meta : {};
  const pre = Array.isArray(meta.preTokenBalances) ? (meta.preTokenBalances as Obj[]) : [];
  const post = Array.isArray(meta.postTokenBalances) ? (meta.postTokenBalances as Obj[]) : [];
  const m = new Map<string, TokenDelta>();
  const k = (b: Obj) => `${b.accountIndex}|${b.mint}`;
  for (const b of post) m.set(k(b), { mint: String(b.mint), owner: b.owner as string | undefined, delta: amt(b) });
  for (const b of pre) {
    const e = m.get(k(b)) ?? { mint: String(b.mint), owner: b.owner as string | undefined, delta: 0 };
    e.delta -= amt(b); m.set(k(b), e);
  }
  return [...m.values()].filter((d) => Math.abs(d.delta) > 1e-12);
}

const short = (s?: string) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "?");

/** Returns one hit per (successful) transaction touching our outcome mints / desk, deduped by signature. */
export function parseQnPayload(payload: unknown, watch: QnWatch): QnHit[] {
  const hits = new Map<string, QnHit>();
  for (const tx of extractTransactions(payload)) {
    const signature = sigOf(tx);
    if (!signature || hits.has(signature)) continue;
    const meta = isObj(tx.meta) ? tx.meta : undefined;
    if (meta && meta.err != null) continue;
    const deltas = tokenDeltas(tx);
    const keys = accountKeysOf(tx);
    const memo = JSON.stringify(tx).match(MEMO_RE);
    const touches = deltas.some((d) => watch.mints.has(d.mint)) || keys.some((k) => watch.mints.has(k) || watch.accounts.has(k));
    if (!touches && (!memo || (watch.positionIds && !watch.positionIds.has(memo[2])))) continue;
    const redeem = !!memo?.[1];
    const positionId = memo?.[2];
    const outcome = deltas.filter((d) => watch.mints.has(d.mint));
    const recv = outcome.find((d) => d.delta > 0);
    const burned = outcome.find((d) => d.delta < 0);
    let text: string;
    if (redeem) text = `QuickNode: payout tx for ${positionId}${burned ? ` (${-burned.delta} outcome tokens burned)` : ""}`;
    else if (memo && recv) text = `QuickNode: ${recv.delta} outcome tokens minted to ${short(recv.owner)} (${positionId})`;
    else if (recv) text = `QuickNode: ${recv.delta} outcome tokens moved to ${short(recv.owner)}`;
    else if (burned) text = `QuickNode: ${-burned.delta} outcome tokens left ${short(burned.owner)}`;
    else text = `QuickNode: tx ${short(signature)} touched the Hedgehog desk`;
    hits.set(signature, {
      signature, kind: memo && !redeem ? "fill" : "transfer", positionId, redeem,
      slot: typeof tx.slot === "number" ? tx.slot : undefined, deltas, text,
    });
  }
  return [...hits.values()];
}
