// Counter sessions, one-time codes (D13) and receipt issuance with a per-promise mutex (§3.4 #3).
import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import * as P from "./program";
import { key, send, readPromise } from "./chain";
import { load, mutate, log, randomCode, sha256, withLock } from "./store";
import { hedge } from "./engine";

export const CODE_TTL_MS = 90_000;

export function openCounter(promiseId: string): string {
  const token = crypto.randomBytes(24).toString("base64url");
  mutate((s) => { s.sessions[token] = { token, promiseId, createdAt: Date.now() }; });
  return token;
}
export function sessionOk(token: string | undefined, promiseId: string) {
  const s = token ? load().sessions[token] : undefined;
  return !!s && s.promiseId === promiseId;
}

/** Cashier tap → one single-use code (at most one unused live code per session). */
export function newCode(token: string, promiseId: string): { code: string; expiresAt: number } {
  return mutate((s) => {
    for (const c of Object.values(s.codes)) if (c.session === token && !c.usedAt && !c.reserved && Date.now() - c.createdAt < CODE_TTL_MS) c.createdAt = 0; // expire the previous unused one
    const code = randomCode();
    s.codes[code] = { code, promiseId, session: token, createdAt: Date.now() };
    return { code, expiresAt: Date.now() + CODE_TTL_MS };
  });
}
export function codeStatus(code: string) {
  const c = load().codes[code];
  if (!c) return { state: "unknown" as const };
  if (c.usedAt) return { state: "used" as const, receiptIndex: c.receiptIndex };
  if (c.reserved) return { state: "waiting_for_hedge" as const };
  if (Date.now() - c.createdAt > CODE_TTL_MS) return { state: "expired" as const };
  return { state: "live" as const };
}

export type IssueResult =
  | { ok: true; index: number; sig: string; promiseId: string }
  | { ok: false; error: string; code?: number; sig?: string; retry?: boolean; promiseId?: string };

/** Issue a receipt for `holder` using one-time `code`. Unhedged keeps the code reserved for this holder and triggers the agent. */
export async function issue(code: string, holderStr: string): Promise<IssueResult> {
  let holder: PublicKey;
  try { holder = new PublicKey(holderStr); } catch { return { ok: false, error: "BadHolder" }; }
  const c = load().codes[code];
  if (!c) return { ok: false, error: "UnknownCode" };
  if (c.usedAt) {
    if (c.holder === holder.toBase58() && c.receiptIndex != null) return { ok: true, index: c.receiptIndex, sig: c.sig!, promiseId: c.promiseId };
    return { ok: false, error: "CodeUsed" };
  }
  if (c.reserved && c.holder !== holder.toBase58()) return { ok: false, error: "CodeUsed" };
  if (!c.reserved && Date.now() - c.createdAt > CODE_TTL_MS) return { ok: false, error: "CodeExpired" };
  // retries of a reserved code are allowed for 45 s after the first Unhedged
  if (c.reserved && Date.now() - (c.usedAt ?? c.createdAt) > 10 * 60_000) return { ok: false, error: "CodeExpired" };
  const rec = load().promises[c.promiseId];
  if (!rec) return { ok: false, error: "UnknownPromise" };

  return withLock(`issue:${rec.id}`, async () => {
    const merchant = key("merchant");
    const pda = new PublicKey(rec.pda);
    const codeHash = sha256(code);
    let last: IssueResult = { ok: false, error: "Busy", retry: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = await readPromise(pda);
      if (!p) return { ok: false, error: "PromiseMissing" };
      // a phone retrying after Unhedged: don't spam failed txs while the agent is still buying
      if (load().codes[code].reserved && p.sold + 1 > p.hedgedCapacity && p.sold < p.cap) return { ok: false, error: "Unhedged", code: 6002, retry: true, promiseId: rec.id };
      const ix = await P.ixIssueReceipt(merchant.publicKey, pda, p.sold, holder, codeHash);
      const r = await send([ix], [merchant], { skipPreflight: true });
      if (r.ok) {
        mutate((s) => {
          const cc = s.codes[code]; cc.usedAt = Date.now(); cc.holder = holder.toBase58(); cc.receiptIndex = p.sold; cc.sig = r.sig; cc.reserved = false;
          s.receipts.push({ promiseId: rec.id, index: p.sold, holder: holder.toBase58(), code, sig: r.sig, ts: Date.now() });
        });
        log("info", "receipts", `receipt #${p.sold} for ${rec.id} in ${r.ms} ms`);
        return { ok: true, index: p.sold, sig: r.sig, promiseId: rec.id };
      }
      if (r.name === "Unhedged") {
        mutate((s) => { const cc = s.codes[code]; cc.reserved = true; cc.holder = holder.toBase58(); s.promises[rec.id].lastRevertAt = Date.now(); });
        log("warn", "receipts", `Unhedged revert on ${rec.id} (sold ${p.sold}) ${r.sig ?? ""} → agent top-up`);
        hedge(rec.id, "revert").catch((e) => log("error", "agent", String(e)));
        return { ok: false, error: "Unhedged", code: r.code, sig: r.sig, retry: true, promiseId: rec.id };
      }
      if (r.name) return { ok: false, error: r.name, code: r.code, sig: r.sig, promiseId: rec.id };
      last = { ok: false, error: "Busy", retry: true, sig: r.sig };
    }
    return last;
  });
}
