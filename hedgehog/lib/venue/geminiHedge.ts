// "Sold on Solana, hedged on Gemini" — the desk's backing order (reinsurance) for Gemini-priced exposure.
//
// When a business buys devnet outcome tokens (mock venue) or a Hedgehog Cover policy on a Gemini contract,
// Hedgehog is short that outcome. The desk offsets it by buying the SAME contract/outcome on Gemini, so a YES
// costs the desk nothing net: the Gemini position pays Hedgehog $1/contract exactly when Hedgehog owes $1.
//
// Default = DRY-RUN: the order is computed, recorded (.data/hedges.json) and shown in the feed, never sent.
// LIVE only when GEMINI_TRADE_KEY + GEMINI_TRADE_SECRET are set AND HEDGE_LIVE=1 (real money; user's call).
import crypto from "node:crypto";
import { store } from "../store";
import type { MarketContract } from "../types";

export const HEDGE_SLIPPAGE = 0.02;   // limit = current ask + 2¢ (IOC, so it never rests on the book)
export const HEDGE_MAX_PRICE = 0.99;
export const GEMINI_TRADE_BASE = () => process.env.GEMINI_TRADE_BASE || "https://api.gemini.com";

export interface BackingPlan {
  symbol: string;          // Gemini instrumentSymbol
  outcome: "yes" | "no";
  quantity: number;        // whole contracts, each pays $1 (= the exposure Hedgehog sold)
  limitPrice: number;      // $ per contract
  refAsk: number;          // ask when planned
  notionalUsd: number;     // quantity × limitPrice (max the desk spends)
}

export interface DeskHedge extends BackingPlan {
  venue?: "gemini" | "kalshi" | "polymarket"; // where the backing order goes (best price); only Gemini can ever go live
  id: string;                         // `hedge:${kind}:${refId}`
  kind: "position" | "policy";
  refId: string;                      // position id or policy PDA
  owner?: string;
  businessId?: string;
  contractId: string;                 // gemini:<symbol>
  eventTitle?: string;
  label?: string;
  url?: string;                       // Gemini market (deep link)
  soldForUsd?: number;                // what the business paid Hedgehog (tokens or premium)
  marginUsd?: number;                 // soldFor − notional (desk's spread for carrying basis/settlement risk)
  mode: "dry-run" | "live";
  status: "dry-run" | "submitted" | "filled" | "partial" | "rejected" | "error";
  orderId?: string;
  filledQuantity?: number;
  avgPrice?: number;
  error?: string;
  createdAt: string;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const VENUE_NAME = { gemini: "Gemini", kalshi: "Kalshi", polymarket: "Polymarket" } as const;
const centsUp = (x: number) => Math.ceil(Math.round(x * 100 * 1e6) / 1e6) / 100;

/** Pure: the order that backs `quantity` contracts of `outcome` on a Gemini contract. Throws when it can't be priced. */
export function planBacking(c: Pick<MarketContract, "venue" | "symbol" | "yesAsk" | "noAsk" | "status">, outcome: "yes" | "no", quantity: number, slippage = HEDGE_SLIPPAGE): BackingPlan {
  if (c.status !== "open") throw new Error(`market is ${c.status}`);
  const qty = Math.floor(quantity);
  if (!Number.isFinite(qty) || qty < 1) throw new Error("quantity must be >= 1");
  const ask = outcome === "yes" ? c.yesAsk : c.noAsk;
  if (ask == null || !(ask > 0 && ask < 1)) throw new Error(`no ${outcome.toUpperCase()} ask on ${c.venue}`);
  const limitPrice = Math.min(HEDGE_MAX_PRICE, centsUp(ask + slippage));
  return { symbol: c.symbol, outcome, quantity: qty, limitPrice, refAsk: ask, notionalUsd: r2(qty * limitPrice) };
}

export const hedgeText = (h: Pick<DeskHedge, "mode" | "status" | "quantity" | "outcome" | "symbol" | "limitPrice" | "error" | "venue">) =>
  `Desk hedge on ${VENUE_NAME[h.venue ?? "gemini"]} (${h.mode === "live" ? h.status : "dry-run"}): BUY ${h.quantity} ${h.outcome.toUpperCase()} ${h.symbol} @ $${h.limitPrice.toFixed(2)}${h.error ? ` (${h.error})` : ""}`;

export const liveEnabled = () => process.env.HEDGE_LIVE === "1" && !!process.env.GEMINI_TRADE_KEY && !!process.env.GEMINI_TRADE_SECRET;

// ---------- Gemini private API (HMAC-SHA384), adapted from the v1 client (lib/hh/geminiPrivate.ts in old/) ----------

let lastNonce = 0;
type OrderResp = { orderId?: string | number; status?: string; filledQuantity?: string; avgExecutionPrice?: string; [k: string]: unknown };

async function placeGeminiOrder(p: BackingPlan): Promise<OrderResp> {
  const key = process.env.GEMINI_TRADE_KEY!, secret = process.env.GEMINI_TRADE_SECRET!;
  const path = "/v1/prediction-markets/order";
  lastNonce = Math.max(Date.now(), lastNonce + 1);
  const payload = {
    request: path, nonce: lastNonce, symbol: p.symbol, orderType: "limit", side: "buy", outcome: p.outcome,
    price: p.limitPrice.toFixed(2), quantity: String(p.quantity), timeInForce: "immediate-or-cancel",
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = crypto.createHmac("sha384", secret).update(b64).digest("hex");
  const r = await fetch(GEMINI_TRADE_BASE() + path, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "Content-Length": "0", "Cache-Control": "no-cache", "X-GEMINI-APIKEY": key, "X-GEMINI-PAYLOAD": b64, "X-GEMINI-SIGNATURE": sig },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as OrderResp;
}

// ---------- record ----------

export interface BackArgs {
  kind: DeskHedge["kind"];
  refId: string;
  contract: MarketContract;
  outcome: "yes" | "no";
  quantity: number;
  owner?: string;
  businessId?: string;
  soldForUsd?: number;
  txSig?: string;
}

/**
 * Computes, records and (only if explicitly enabled) places the desk's backing order for a confirmed
 * Gemini-priced sale. Idempotent per (kind, refId). Returns null for non-Gemini contracts. Never throws.
 */
const inflight = new Map<string, Promise<DeskHedge | null>>();

export async function backOnGemini(a: BackArgs, opts: { place?: typeof placeGeminiOrder } = {}): Promise<DeskHedge | null> {
  // Best-price venue backs the sale. Kalshi/Polymarket backing is always a recorded plan (never placed in the demo).
  const id = `hedge:${a.kind}:${a.refId}`;
  // Two concurrent confirms for the same sale must not place two orders (audit F9): share the in-flight call.
  const running = inflight.get(id);
  if (running) return running;
  const p = backOnce(id, a, opts).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function backOnce(id: string, a: BackArgs, opts: { place?: typeof placeGeminiOrder }): Promise<DeskHedge | null> {
  const prev = store.get("hedges", id);
  if (prev) return prev;
  const base = {
    id, kind: a.kind, refId: a.refId, owner: a.owner, businessId: a.businessId, contractId: a.contract.id,
    eventTitle: a.contract.eventTitle, label: a.contract.label, url: a.contract.url, soldForUsd: a.soldForUsd,
    createdAt: new Date().toISOString(),
  };
  let h: DeskHedge;
  try {
    const plan = planBacking(a.contract, a.outcome, a.quantity);
    h = { ...base, ...plan, venue: a.contract.venue, mode: "dry-run", status: "dry-run", marginUsd: a.soldForUsd != null ? r2(a.soldForUsd - plan.notionalUsd) : undefined };
    if (liveEnabled() && a.contract.venue === "gemini") {
      h.mode = "live";
      try {
        const o = await (opts.place ?? placeGeminiOrder)(plan);
        const filled = Number(o.filledQuantity ?? 0);
        h.orderId = o.orderId != null ? String(o.orderId) : undefined;
        h.filledQuantity = Number.isFinite(filled) ? filled : undefined;
        h.avgPrice = o.avgExecutionPrice ? Number(o.avgExecutionPrice) : undefined;
        h.status = filled >= plan.quantity ? "filled" : filled > 0 ? "partial" : /reject|cancel/i.test(String(o.status ?? "")) ? "rejected" : "submitted";
      } catch (e) {
        h.status = "error"; h.error = (e as Error).message.slice(0, 200);
      }
    }
  } catch (e) {
    // Could not price the backing (no ask / market closed): record it so the gap is visible, never silent.
    h = { ...base, symbol: a.contract.symbol, outcome: a.outcome, quantity: Math.floor(a.quantity), limitPrice: 0, refAsk: 0, notionalUsd: 0, mode: "dry-run", status: "error", error: (e as Error).message };
  }
  store.upsert("hedges", h);
  store.feed({ id: `desk_hedge:${id}`, source: "app", kind: "info", text: hedgeText(h), txSig: a.txSig, positionId: a.kind === "position" ? a.refId : undefined });
  return h;
}

/** Backing orders, newest first, optionally for one owner. */
export function listHedges(owner?: string): DeskHedge[] {
  return store.list("hedges").filter((h) => !owner || h.owner === owner).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

/** Route helper: look up the live contract (≤8s) and back it. Only acts on `gemini:` ids. Never throws. */
export async function backConfirmedSale(a: Omit<BackArgs, "contract"> & { contractId: string }, getContract: (id: string) => Promise<MarketContract | null>): Promise<DeskHedge | null> {
  const venue = a.contractId.split(":")[0];
  if (venue !== "gemini" && venue !== "kalshi" && venue !== "polymarket") return null;
  try {
    const contract = await Promise.race([getContract(a.contractId).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8_000))]);
    const c: MarketContract = contract ?? {
      id: a.contractId, venue, eventTitle: a.contractId, label: a.contractId, symbol: a.contractId.slice(venue.length + 1),
      eventTicker: "", peril: "other", expiry: "", yesAsk: null, yesBid: null, noAsk: null, noBid: null, tradable: true, status: "open",
    };
    return await backOnGemini({ ...a, contract: c });
  } catch (e) {
    console.warn("[desk-hedge]", (e as Error).message);
    return null;
  }
}
