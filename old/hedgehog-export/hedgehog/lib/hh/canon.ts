// Canonical resolution hash (SPEC §5.5) and terms hash (§5.6). Same code runs in the browser (WebCrypto) and node.
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) o[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}
export const canonJson = (v: unknown) => JSON.stringify(sortKeysDeep(v));

type EvLike = { ticker: string; resolvedAt?: string | null; contracts: { instrumentSymbol: string; resolutionSide?: string | null }[] };

export function canonicalResolution(e: EvLike): string {
  return canonJson({
    ticker: e.ticker,
    resolvedAt: e.resolvedAt ?? null,
    contracts: e.contracts
      .map((c) => ({ instrumentSymbol: c.instrumentSymbol, resolutionSide: c.resolutionSide ?? null }))
      .sort((a, b) => (a.instrumentSymbol < b.instrumentSymbol ? -1 : a.instrumentSymbol > b.instrumentSymbol ? 1 : 0)),
  });
}

export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const bytesToHex = (b: Uint8Array | number[]) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

export const resolutionHash = (e: EvLike) => sha256Hex(canonicalResolution(e));

export type Terms = {
  sentence: string; applies_to: string; event_ticker: string; strip: string[]; rules_doc: unknown;
  refund_usd: number; sales_close_iso: string; merchant_name: string; risk_note: string;
};
export const RISK_NOTE = "If the event is cancelled or Gemini's review runs past 72 h, customers are paid and the merchant bears the cost.";
export const termsHash = (t: Terms) => sha256Hex(canonJson(t));

/** Event is cleanly resolved: settled and every contract yes/no. */
export function isBinaryResolved(e: { status: string; contracts: { resolutionSide?: string | null }[] }) {
  return e.status === "settled" && e.contracts.every((c) => c.resolutionSide === "yes" || c.resolutionSide === "no");
}
