// Gemini private PM API, HMAC-SHA384. Two key profiles: A = hedge agent, B = attestor. SPEC §4.2.
import crypto from "node:crypto";
import { env } from "./env";

export type Profile = "A" | "B";
type Creds = { key: string; secret: string };

function creds(p: Profile): Creds {
  const key = process.env[`GEMINI_API_KEY_${p}`] || process.env[p === "A" ? "GEMINI_AGENT_KEY" : "GEMINI_ATTEST_KEY"] || "";
  const secret = process.env[`GEMINI_API_SECRET_${p}`] || process.env[p === "A" ? "GEMINI_AGENT_SECRET" : "GEMINI_ATTEST_SECRET"] || "";
  return { key, secret };
}
export const hasKeys = (p: Profile) => Boolean(creds(p).key && creds(p).secret);

const lastNonce: Record<Profile, number> = { A: 0, B: 0 };
function nonce(p: Profile) {
  const n = Math.max(Date.now(), lastNonce[p] + 1);
  lastNonce[p] = n;
  return n;
}

export class GeminiError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`Gemini ${path} ${status}: ${body.slice(0, 300)}`);
  }
  get fatal() { return this.status === 401 || this.status === 403 || /terms/i.test(this.body); }
}

export type CallLog = { t: string; profile: Profile; path: string; params: unknown; status: number; ms: number; body: string };
export const callLog: CallLog[] = [];

export async function priv<T>(p: Profile, path: string, params: Record<string, unknown> = {}): Promise<T> {
  const c = creds(p);
  if (!c.key) throw new Error(`Gemini key profile ${p} is not configured`);
  const payload = { request: path, nonce: nonce(p), ...params };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = crypto.createHmac("sha384", c.secret).update(b64).digest("hex");
  const t0 = Date.now();
  const r = await fetch(env.geminiTrade() + path, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain", "Content-Length": "0", "Cache-Control": "no-cache",
      "X-GEMINI-APIKEY": c.key, "X-GEMINI-PAYLOAD": b64, "X-GEMINI-SIGNATURE": sig,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await r.text();
  callLog.push({ t: new Date().toISOString(), profile: p, path, params, status: r.status, ms: Date.now() - t0, body: text.slice(0, 4000) });
  if (callLog.length > 500) callLog.shift();
  if (!r.ok) throw new GeminiError(r.status, text, path);
  return JSON.parse(text) as T;
}

export type PMOrder = {
  orderId: string | number; status: string; symbol?: string; side?: string; outcome?: string;
  quantity?: string; filledQuantity?: string; remainingQuantity?: string; price?: string; avgExecutionPrice?: string;
  createdAt?: string; [k: string]: unknown;
};
export type OrderReq = { symbol: string; side: "buy" | "sell"; outcome: "yes" | "no"; price: number; quantity: number };

const fmtQty = (q: number) => (Math.round(q * 100) / 100).toFixed(2);
const fmtPx = (p: number) => (Math.round(p * 100) / 100).toFixed(2);

function orderBody(o: OrderReq) {
  return { symbol: o.symbol, orderType: "limit", side: o.side, quantity: fmtQty(o.quantity), price: fmtPx(o.price), outcome: o.outcome, timeInForce: "immediate-or-cancel" };
}

export const termsStatus = (p: Profile = "A") => priv<{ hasAcceptedLatest?: boolean; [k: string]: unknown }>(p, "/v1/prediction-markets/terms/status");
export const termsAccept = (p: Profile = "A") => priv<unknown>(p, "/v1/prediction-markets/terms/accept");

export type BatchResult = { results: Array<{ order?: PMOrder; error?: string; message?: string; [k: string]: unknown }>; [k: string]: unknown };
export const batchOrder = (orders: OrderReq[], p: Profile = "A") =>
  priv<BatchResult>(p, "/v1/prediction-markets/order/batch", { orders: orders.map(orderBody) });
export const placeOrder = (o: OrderReq, p: Profile = "A") => priv<PMOrder>(p, "/v1/prediction-markets/order", orderBody(o));

export type Position = { symbol: string; totalQuantity: string; quantityOnHold?: string; avgPrice?: string; outcome?: string; resolutionSide?: string | null; contractMetadata?: { eventTicker?: string; [k: string]: unknown }; [k: string]: unknown };
export const positions = (p: Profile = "B") => priv<{ positions: Position[] } | Position[]>(p, "/v1/prediction-markets/positions")
  .then((r) => (Array.isArray(r) ? r : r.positions ?? []));
export const orderHistory = (q: { status?: string; symbol?: string; from?: number; to?: number; limit?: number } = {}, p: Profile = "B") =>
  priv<{ orders: PMOrder[] } | PMOrder[]>(p, "/v1/prediction-markets/orders/history", q).then((r) => (Array.isArray(r) ? r : r.orders ?? []));
export const balances = (p: Profile = "A") => priv<unknown>(p, "/v1/balances");
