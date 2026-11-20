// Tax record for one wallet, read straight from Solana devnet. Server-only.
// policies (getProgramAccounts, memcmp owner) -> signatures per policy PDA (paginated) -> getTransaction (jsonParsed)
// -> lib/tax/extract. Read-only: never signs or sends.
// Caching: parsed tx summaries are immutable -> memory + .data/tax-tx-cache.json; chain reads per owner -> memory,
// 5 min, then stale-while-revalidate; signatures of settled/expired policies -> memory, forever.
// Rate limit: RPC calls go one at a time with a small gap and 429 backoff (public devnet RPC throttles hard).
import fs from "node:fs";
import path from "node:path";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { env } from "../env";
import { store } from "../store";
import { getConnection, rpcUrl } from "../solana/connection";
import { CoverClient, type DecodedPolicy } from "../solana/policyClient";
import { filterYear, summarizeTx, toRows, totals, yearsOf, type PolicyMeta, type TaxRow, type TaxTotals, type TxSummary } from "./extract";

export interface TaxRecord {
  owner: string;
  year: number | null;
  tz: string;
  rows: TaxRow[]; // filtered to `year` (all years when null), oldest first
  totals: TaxTotals[]; // [requested year], or one per year with rows (newest first) when no year is given
  years: number[];
  policies: number;
  asOfSlot: number;
  rpcHost: string;
  network: "devnet";
  generatedAt: string;
  provenance: string;
  unverified: number; // rows whose tx event sum did not match the owner's token delta
}

const RECORD_TTL_MS = 5 * 60_000;
const GAP_MS = Number(process.env.TAX_RPC_GAP_MS ?? 120);

// ---------------------------------------------------------------- tx summary disk cache (keyed owner:sig)

const cacheFile = () => path.join(env.dataDir(), "tax-tx-cache.json");
let txCache: Map<string, TxSummary> | null = null;
function loadTxCache() {
  if (txCache) return txCache;
  txCache = new Map();
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as Record<string, TxSummary>)) txCache.set(k, v); } catch { /* none yet */ }
  return txCache;
}
function saveTxCache() {
  try {
    fs.mkdirSync(env.dataDir(), { recursive: true });
    const tmp = `${cacheFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(loadTxCache())));
    fs.renameSync(tmp, cacheFile());
  } catch { /* cache is best-effort */ }
}

// ---------------------------------------------------------------- throttled RPC

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Public devnet RPC rate-limits hard: one call at a time with a gap. A dedicated endpoint (QuickNode) takes parallel calls.
const DEDICATED = () => /quiknode|helius|alchemy|triton/i.test(process.env.SOLANA_RPC_URL ?? "");
const MAX_PARALLEL = () => Number(process.env.TAX_RPC_PARALLEL ?? (DEDICATED() ? 6 : 1));
const GAP = () => (DEDICATED() ? 0 : GAP_MS);
let active = 0;
const waiting: (() => void)[] = [];
async function slot(): Promise<() => void> {
  if (active >= MAX_PARALLEL()) await new Promise<void>((r) => waiting.push(r));
  active++;
  return () => { active--; waiting.shift()?.(); };
}
/** Limit concurrent RPC calls made here (1 + gap on public RPC, 6 on a dedicated endpoint); retry 429 / fetch errors with backoff. */
async function rpc<T>(fn: () => Promise<T>): Promise<T> {
  const release = await slot();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const v = await fn();
        if (GAP()) await sleep(GAP());
        return v;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt >= 4 || !/429|Too Many|rate|fetch failed|ECONNRESET|timeout/i.test(msg)) throw e;
        await sleep(500 * 2 ** attempt);
      }
    }
  } finally { release(); }
}

async function allSignatures(pda: PublicKey): Promise<string[]> {
  const conn = getConnection();
  const out: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const batch = await rpc(() => conn.getSignaturesForAddress(pda, { before, limit: 1000 }, "confirmed"));
    for (const s of batch) if (!s.err) out.push(s.signature);
    if (batch.length < 1000) break;
    before = batch[batch.length - 1].signature;
  }
  return out;
}

// ---------------------------------------------------------------- build

const sideOf = (pda: string): string | null => {
  const local = store.get("policies", pda) as Record<string, unknown> | undefined;
  return local?.side === "yes" || local?.side === "no" ? (local.side as string) : null;
};

type ChainData = { txs: { summary: TxSummary; policyPda: string }[]; meta: Map<string, PolicyMeta>; policies: number; asOfSlot: number; rpcHost: string; generatedAt: string };
const chainCache = new Map<string, { at: number; data: ChainData }>();
const inflight = new Map<string, Promise<ChainData>>();
// Signatures of settled / expired policies never change: fetch them once per process.
const finalSigs = new Map<string, string[]>();

async function build(owner: string): Promise<ChainData> {
  const conn = getConnection();
  const client = new CoverClient({ connection: conn });
  const policies: DecodedPolicy[] = await rpc(() => client.listPolicies(owner));
  const meta = new Map<string, PolicyMeta>(policies.map((p) => [p.pda, { pda: p.pda, policyId: p.policyId, marketRef: p.marketRef, peril: p.peril, side: sideOf(p.pda) }]));
  const mint = client.mint.toBase58();

  // signature -> first policy PDA it was found under (batch buys touch several policies; events carry the rest)
  const sigs = new Map<string, string>();
  const ordered = [...policies].sort((a, b) => a.policyId - b.policyId);
  // fetched in parallel (rpc() bounds concurrency), merged in policy order so "first PDA" stays deterministic
  const lists = await Promise.all(ordered.map(async (p) => {
    let list = finalSigs.get(p.pda);
    if (!list) {
      list = await allSignatures(new PublicKey(p.pda));
      if (p.status !== "open") finalSigs.set(p.pda, list);
    }
    return list;
  }));
  ordered.forEach((p, i) => { for (const s of lists[i]) if (!sigs.has(s)) sigs.set(s, p.pda); });

  const cache = loadTxCache();
  let dirty = false;
  const fetched = await Promise.all([...sigs].map(async ([sig, pda]) => {
    const key = `${owner}:${sig}`;
    let summary = cache.get(key);
    if (!summary) {
      const tx: ParsedTransactionWithMeta | null = await rpc(() => conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }));
      if (!tx) return null; // not yet visible; picked up on the next refresh
      summary = summarizeTx(sig, tx, owner, mint);
      cache.set(key, summary);
      dirty = true;
    }
    return { summary, policyPda: pda };
  }));
  const txs: { summary: TxSummary; policyPda: string }[] = fetched.filter((x): x is { summary: TxSummary; policyPda: string } => !!x);
  if (dirty) saveTxCache();

  const asOfSlot = await rpc(() => conn.getSlot("confirmed"));
  const rpcHost = (() => { try { return new URL(rpcUrl()).host; } catch { return "devnet RPC"; } })();
  return { txs, meta, policies: policies.length, asOfSlot, rpcHost, generatedAt: new Date().toISOString() };
}

// Last chain read per owner on disk, so a restart / hot reload serves it at once (marked stale) while re-reading.
const snapFile = () => path.join(env.dataDir(), "tax-records.json");
function readSnapshots(): Record<string, Omit<ChainData, "meta"> & { meta: PolicyMeta[] }> {
  try { return JSON.parse(fs.readFileSync(snapFile(), "utf8")); } catch { return {}; }
}
function saveSnapshot(owner: string, d: ChainData) {
  try {
    const all = readSnapshots();
    all[owner] = { ...d, meta: [...d.meta.values()] };
    const tmp = `${snapFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, snapFile());
  } catch { /* best-effort */ }
}
function loadSnapshot(owner: string): ChainData | null {
  const d = readSnapshots()[owner];
  return d ? { ...d, meta: new Map(d.meta.map((m) => [m.pda, m])) } : null;
}

function refresh(owner: string): Promise<ChainData> {
  let p = inflight.get(owner);
  if (!p) {
    p = build(owner)
      .then((data) => { chainCache.set(owner, { at: Date.now(), data }); saveSnapshot(owner, data); return data; })
      .finally(() => inflight.delete(owner));
    inflight.set(owner, p);
  }
  return p;
}

/**
 * Tax record for `owner` (base58 pubkey), optionally one year, dates in `tz`.
 * Chain reads are cached ~5 min per owner; after that the cached record is served while a refresh runs
 * (stale-while-revalidate). `fresh` waits for a new read.
 */
export async function taxRecord(owner: string, opts: { year?: number | null; tz?: string; fresh?: boolean } = {}): Promise<TaxRecord> {
  const pk = new PublicKey(owner).toBase58();
  const tz = opts.tz || "America/Chicago";
  let hit = chainCache.get(pk);
  if (!hit && !opts.fresh) {
    const snap = loadSnapshot(pk);
    if (snap) chainCache.set(pk, (hit = { at: 0, data: snap })); // stale: served now, refreshed below
  }
  let data: ChainData;
  if (!hit || opts.fresh) data = await refresh(pk);
  else {
    data = hit.data;
    if (Date.now() - hit.at > RECORD_TTL_MS) refresh(pk).catch(() => {});
  }
  const allRows = toRows(data.txs, data.meta, tz);
  const year = opts.year ?? null;
  const years = yearsOf(allRows);
  return {
    owner: pk, tz, policies: data.policies, asOfSlot: data.asOfSlot, rpcHost: data.rpcHost, network: "devnet",
    generatedAt: data.generatedAt,
    provenance: `As of slot ${data.asOfSlot}, read from Solana devnet via ${data.rpcHost}`,
    unverified: allRows.filter((r) => !r.verified).length,
    years,
    year,
    rows: filterYear(allRows, year),
    totals: (year ? [year] : years).map((y) => totals(allRows, y)),
  };
}
