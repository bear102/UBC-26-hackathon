import crypto from "node:crypto";
import { config } from "./config";

export type GContract = {
  id: string; label: string; ticker: string; instrumentSymbol: string; status: string; marketState?: string;
  expiryDate: string; effectiveDate?: string;
  strike?: { type: string; value?: string; availableAt?: string } | null;
  prices?: { buy?: { yes?: string; no?: string }; sell?: { yes?: string; no?: string }; bestBid?: string; bestAsk?: string; lastTradePrice?: string };
  resolutionSide?: string | null;
};
export type GEvent = {
  id: string; title: string; ticker: string; category: string; type: string; status: string;
  expiryDate?: string; volume?: string; contracts: GContract[];
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

/** Public, keyless: active prediction-market events. */
export async function activeEvents(limit = 300): Promise<GEvent[]> {
  const out: GEvent[] = [];
  for (let offset = 0; offset < limit; offset += 100) {
    const r = await getJson<{ data: GEvent[] }>(`${config.geminiPublic}/v1/prediction-markets/events?status=active&limit=100&offset=${offset}`);
    out.push(...r.data);
    if (r.data.length < 100) break;
  }
  return out;
}

export async function eventByTicker(ticker: string): Promise<GEvent | null> {
  try {
    const r = await getJson<GEvent | { data: GEvent }>(`${config.geminiPublic}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`);
    return "data" in r ? r.data : r;
  } catch { return null; }
}

export async function recentlySettled(limit = 200): Promise<GEvent[]> {
  const r = await getJson<{ data: GEvent[] } | GEvent[]>(`${config.geminiPublic}/v1/prediction-markets/events/recently-settled?limit=${limit}`);
  return Array.isArray(r) ? r : r.data;
}

/** Public spot + hourly candles from Gemini's exchange API. */
export async function candles(symbol: string, tf: "1m" | "5m" | "15m" | "1hr" = "1hr"): Promise<number[][]> {
  return getJson<number[][]>(`${config.geminiPublic}/v2/candles/${symbol}/${tf}`);
}
export async function spot(symbol: string): Promise<number> {
  const t = await getJson<{ last: string }>(`${config.geminiPublic}/v1/pubticker/${symbol}`);
  return Number(t.last);
}

// ---------------- Authenticated trading (sandbox by default) ----------------
export const tradingEnabled = () => Boolean(config.geminiKey && config.geminiSecret);

async function priv<T>(pathName: string, params: Record<string, unknown> = {}): Promise<T> {
  const payload = { request: pathName, nonce: Date.now(), ...params };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = crypto.createHmac("sha384", config.geminiSecret).update(b64).digest("hex");
  const r = await fetch(config.geminiTrade + pathName, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain", "Content-Length": "0", "Cache-Control": "no-cache",
      "X-GEMINI-APIKEY": config.geminiKey, "X-GEMINI-PAYLOAD": b64, "X-GEMINI-SIGNATURE": sig,
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Gemini ${pathName} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export async function ensureTerms() {
  const s = await priv<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status");
  if (!s.hasAcceptedLatest) await priv("/v1/prediction-markets/terms/accept");
}

export async function placeLimitOrder(o: { symbol: string; outcome: "yes" | "no"; price: number; quantity: number }) {
  return priv<{ orderId: number; status: string; filledQuantity?: string; avgExecutionPrice?: string }>("/v1/prediction-markets/order", {
    symbol: o.symbol, orderType: "limit", side: "buy", outcome: o.outcome,
    price: o.price.toFixed(2), quantity: String(o.quantity), timeInForce: "immediate-or-cancel",
  });
}

export async function positions() {
  return priv<{ positions: unknown[] }>("/v1/prediction-markets/positions");
}
