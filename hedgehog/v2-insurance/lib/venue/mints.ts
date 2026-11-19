// Persistent (contractId, side) -> outcome mint mapping for the mock venue. Stored in .data/venue-mints.json.
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import type { Side } from "./types";

export interface MintRecord { contractId: string; side: Side; mint: string; authority: string; createdAt: string }

export const mintKey = (contractId: string, side: Side) => `${contractId}|${side}`;

export class MintRegistry {
  constructor(public file = path.join(env.dataDir(), "venue-mints.json")) {}
  all(): Record<string, MintRecord> {
    if (!fs.existsSync(this.file)) return {};
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return {}; }
  }
  get(contractId: string, side: Side, authority?: string): MintRecord | undefined {
    const r = this.all()[mintKey(contractId, side)];
    return r && (!authority || r.authority === authority) ? r : undefined;
  }
  set(rec: MintRecord) {
    const all = this.all(); all[mintKey(rec.contractId, rec.side)] = rec;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2)); fs.renameSync(tmp, this.file);
    return rec;
  }
  /** Reverse lookup: outcome mint -> record (webhook parsing). */
  byMint(mint: string): MintRecord | undefined { return Object.values(this.all()).find((r) => r.mint === mint); }
  mintSet(): Set<string> { return new Set(Object.values(this.all()).map((r) => r.mint)); }
}
