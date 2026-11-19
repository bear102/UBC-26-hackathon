import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { DEFAULT_POLICY, type Policy } from "./policy";

export type Payment = {
  id: string; ts: number; seller: string; resource: string; amountUsdc: number;
  sig?: string; status: "settled" | "blocked" | "failed"; reason?: string; cycle: number;
};
export type Decision = {
  id: string; ts: number; cycle: number; eventTitle: string; contractLabel: string; symbol: string;
  category: string; side: "yes" | "no"; marketPrice: number; fairProb: number; edge: number;
  stakeUsd: number; quantity: number; rationale: string; model: string;
  status: "executed" | "pending_approval" | "rejected_by_human" | "blocked_by_policy" | "skipped" | "failed";
  policyNotes: string[]; commitSig?: string; commitHash?: string; orderId?: string; mode: "paper" | "gemini-sandbox";
  expiry: string; resolved?: { side: "yes" | "no" | null; pnl: number; at: number };
};
export type LogLine = { ts: number; cycle: number; stage: string; msg: string; data?: unknown };
export type State = {
  cycle: number; running: boolean; lastCycleAt?: number;
  policy: Policy; payments: Payment[]; decisions: Decision[]; log: LogLine[];
  streamEvents: { ts: number; summary: string; sig?: string }[];
  briefing?: { ts: number; text: string; audioFile?: string };
};

const FILE = path.join(DATA_DIR, "state.json");

function fresh(): State {
  return { cycle: 0, running: false, policy: { ...DEFAULT_POLICY }, payments: [], decisions: [], log: [], streamEvents: [] };
}

export function load(): State {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8")) as State;
    s.policy = { ...DEFAULT_POLICY, ...s.policy };
    s.streamEvents ??= [];
    return s;
  } catch { return fresh(); }
}

export function save(s: State) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  s.log = s.log.slice(-400);
  s.payments = s.payments.slice(-500);
  s.decisions = s.decisions.slice(-500);
  s.streamEvents = s.streamEvents.slice(-200);
  const tmp = FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, FILE);
}

/** Read-modify-write helper. Single-process writers only (the agent), UI writes are small. */
export function mutate<T>(fn: (s: State) => T): T {
  const s = load();
  const r = fn(s);
  save(s);
  return r;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
