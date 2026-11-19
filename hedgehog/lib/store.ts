// Tiny JSON-file store shared by API routes, worker and scripts. Server-only.
// Collections: positions, feed, quotes, policies, hedges (desk backing orders on Gemini), kv. One file per collection in .data/.
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import type { FeedEvent, Position, Quote } from "./types";
import type { DeskHedge } from "./venue/geminiHedge";

type Collections = { positions: Position; feed: FeedEvent; quotes: Quote & { id: string }; policies: Record<string, unknown> & { id: string }; hedges: DeskHedge };

function file(name: string) {
  fs.mkdirSync(env.dataDir(), { recursive: true });
  return path.join(env.dataDir(), `${name}.json`);
}
function readAll<K extends keyof Collections>(name: K): Collections[K][] {
  const f = file(name);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
}
function writeAll<K extends keyof Collections>(name: K, rows: Collections[K][]) {
  const f = file(name);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
  fs.renameSync(tmp, f);
}

export const store = {
  list<K extends keyof Collections>(name: K): Collections[K][] { return readAll(name); },
  get<K extends keyof Collections>(name: K, id: string): Collections[K] | undefined { return readAll(name).find((r) => r.id === id); },
  upsert<K extends keyof Collections>(name: K, row: Collections[K]) {
    const rows = readAll(name); const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row; else rows.push(row);
    writeAll(name, rows); return row;
  },
  feed(e: Omit<FeedEvent, "id" | "at"> & { id?: string }) {
    const ev: FeedEvent = { id: e.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...e } as FeedEvent;
    const rows = readAll("feed");
    if (rows.some((r) => r.id === ev.id)) return ev; // idempotent (webhook retries)
    rows.push(ev); writeAll("feed", rows.slice(-500)); return ev;
  },
};
