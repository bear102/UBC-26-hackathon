// Hedgehog state store (SPEC §5.9): one JSON file, single writer (the Next server process, which also runs the worker).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Terms } from "./canon";
import type { Venue } from "./venue";

export type Card = {
  event_ticker: string; event_title: string; strip: string[]; sentence: string; why: string; applies_to: string;
  start_time?: string | null; expiry?: string; category?: string; rules_text?: string;
};
export type PromiseStatus = "HEDGING" | "HEDGE_FAILED" | "SELLING" | "CLOSED_FOR_SALES" | "SETTLED_YES" | "SETTLED_NO" | "CLOSED";
export type PromiseRec = {
  id: string;                 // promise_id (unix ms) as string
  pda: string; vault: string;
  merchantName: string;
  card: Card;
  terms: Terms; termsHash: string;
  refundUnits: number; cap: number;
  salesCloseTs: number; expectedResolveTs: number;
  topupThreshold: number;     // -1 = revert-only
  tranche: number;
  createdAt: number; createSig?: string;
  status: PromiseStatus;
  alloc: Record<string, number>;   // symbol -> contracts allocated to this promise (from its own fills)
  premium: number;                 // USD
  lastRevertAt?: number;
  agentNote?: string;
  outcome?: { winning: string; hash: string; resolvedAt: string; sig?: string; yes: boolean };
  eventSnapshot?: unknown;         // Gemini event JSON at settlement (Verify fallback)
  eventSnapshotAt?: number;
  testLabel?: string;
  venue?: Venue;                   // where it is hedged / settles (absent on early records: inferred)
};
export type CodeRec = { code: string; promiseId: string; session: string; createdAt: number; usedAt?: number; holder?: string; receiptIndex?: number; sig?: string; reserved?: boolean };
export type OrderRec = { promiseId: string; orderId: string; symbol: string; side: "buy" | "sell"; qty: number; price: number; filled: number; avgPx?: number; status: string; ts: number; raw?: unknown };
export type AttestRec = { promiseId: string; phase: number; sig?: string; capacity: number; heldBps?: number; qtyCenti: number[]; observedAt: number; ts: number; error?: string; latencyMs?: number };
export type LogRec = { ts: number; level: "info" | "warn" | "error"; scope: string; msg: string; data?: unknown };
export type ReceiptRec = { promiseId: string; index: number; holder: string; code: string; sig: string; ts: number; refunded?: boolean; refundSig?: string };
export type CosignRec = { holder: string; ts: number; createsAta: boolean; sig?: string };

export type State = {
  promises: Record<string, PromiseRec>;
  sessions: Record<string, { token: string; promiseId: string; createdAt: number }>;
  codes: Record<string, CodeRec>;
  orders: OrderRec[];
  attestations: AttestRec[];
  receipts: ReceiptRec[];
  budget: { date: string; spent: number };
  agent: { halted: boolean; haltReason?: string };
  cosigns: CosignRec[];
  log: LogRec[];
  desk?: import("./hedgeDesk").DeskTicket[];   // M3 Hedge Desk tickets (suite, §14.4)
};

const DIR = path.resolve(process.cwd(), ".data");
const FILE = path.join(DIR, "hedgehog.json");

function fresh(): State {
  return { promises: {}, sessions: {}, codes: {}, orders: [], attestations: [], receipts: [], budget: { date: today(), spent: 0 }, agent: { halted: false }, cosigns: [], log: [] };
}
export const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const g = globalThis as unknown as { __hhState?: State; __hhLastBackup?: number };

export function load(): State {
  if (g.__hhState) return g.__hhState;
  try { g.__hhState = { ...fresh(), ...JSON.parse(fs.readFileSync(FILE, "utf8")) } as State; }
  catch { g.__hhState = fresh(); }
  return g.__hhState!;
}
export function save() {
  const s = load();
  s.log = s.log.slice(-1500);
  s.cosigns = s.cosigns.filter((c) => Date.now() - c.ts < 7 * 86400_000);
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  try { fs.renameSync(tmp, FILE); }
  catch (e) {
    // Windows: renaming over a file another process (antivirus, indexer) holds open can fail with EPERM/EBUSY.
    if (!["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
    fs.copyFileSync(tmp, FILE);
  }
  if (!g.__hhLastBackup || Date.now() - g.__hhLastBackup > 10 * 60_000) {
    g.__hhLastBackup = Date.now();
    fs.mkdirSync(path.join(DIR, "backup"), { recursive: true });
    fs.copyFileSync(FILE, path.join(DIR, "backup", `hedgehog-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  }
}
export function mutate<T>(fn: (s: State) => T): T {
  const s = load();
  const r = fn(s);
  save();
  return r;
}
export function log(level: LogRec["level"], scope: string, msg: string, data?: unknown) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${msg}`;
  (level === "error" ? console.error : console.log)(line);
  mutate((s) => { s.log.push({ ts: Date.now(), level, scope, msg, data }); });
}
export function budgetToday(s: State) {
  if (s.budget.date !== today()) s.budget = { date: today(), spent: 0 };
  return s.budget;
}
export const randomCode = () => crypto.randomBytes(16).toString("base64url");
export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest();

/** Simple per-key FIFO mutex (issuance per promise, §3.4 #3). */
const locks = ((globalThis as any).__hhLocks ??= new Map<string, Promise<unknown>>()) as Map<string, Promise<unknown>>;
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(key, chained);
  await prev.catch(() => {});
  try { return await fn(); }
  finally { release(); if (locks.get(key) === chained) locks.delete(key); }
}
