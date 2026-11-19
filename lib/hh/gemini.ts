// Gemini public prediction-market API (no auth). SPEC §4.1.
import { env } from "./env";

export type GPrices = { bestBid?: string | null; bestAsk?: string | null; lastTradePrice?: string | null; buy?: { yes?: string; no?: string }; sell?: { yes?: string; no?: string } };
export type GContract = {
  id: string; label: string; ticker: string; instrumentSymbol: string; status: string; marketState?: string;
  expiryDate?: string; prices?: GPrices; description?: unknown; resolutionSide?: string | null; resolvedAt?: string | null;
  quantityMinimum?: string; quantityIncrement?: string; priceIncrement?: string;
};
export type GEvent = {
  id: string; title: string; ticker: string; category: string; type: string; status: string;
  startTime?: string | null; expiryDate?: string; effectiveDate?: string; resolvedAt?: string | null;
  volume?: string; contracts: GContract[]; subcategory?: unknown; series?: unknown;
};
export type BookLevel = { price: string; amount: string; timestamp?: string };
export type Book = { bids: BookLevel[]; asks: BookLevel[] };

const cache = new Map<string, { t: number; v: unknown }>();

async function getJson<T>(url: string, ttlMs = 0): Promise<T> {
  if (ttlMs > 0) {
    const c = cache.get(url);
    if (c && Date.now() - c.t < ttlMs) return c.v as T;
  }
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`GET ${url} -> ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`GET ${url} -> ${r.status}`), { fatal: true });
      const v = (await r.json()) as T;
      if (ttlMs > 0) cache.set(url, { t: Date.now(), v });
      return v;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) break;
      if (i < 3) await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

export async function activeEvents(max = 600): Promise<GEvent[]> {
  const out: GEvent[] = [];
  for (let offset = 0; offset < max; offset += 100) {
    const r = await getJson<{ data: GEvent[] }>(`${env.geminiPublic()}/v1/prediction-markets/events?status=active&limit=100&offset=${offset}`, 30_000);
    out.push(...r.data);
    if (r.data.length < 100) break;
  }
  return out;
}

/** Search active events (the paginated list is unstable and omits events; `search=` is reliable). */
export async function searchEvents(queries: string[], extra: string[] = [], base = env.geminiPublic()): Promise<GEvent[]> {
  const seen = new Map<string, GEvent>();
  const urls = [
    ...queries.map((q) => `${base}/v1/prediction-markets/events?status=active&limit=500&search=${encodeURIComponent(q)}`),
    ...extra.map((q) => `${base}/v1/prediction-markets/events?status=active&limit=500&${q}`),
  ];
  for (const u of urls) {
    try {
      const r = await getJson<{ data: GEvent[] }>(u, 60_000);
      for (const e of r.data) if (e.status === "active" && !seen.has(e.ticker)) seen.set(e.ticker, e);
    } catch { /* one failed query should not kill the catalog */ }
  }
  return [...seen.values()];
}

export async function eventByTicker(ticker: string, ttlMs = 0, base = env.geminiPublic()): Promise<GEvent> {
  const r = await getJson<GEvent | { data: GEvent }>(`${base}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`, ttlMs);
  return "data" in r && !(r as unknown as GEvent).ticker ? (r as { data: GEvent }).data : (r as GEvent);
}

export async function book(symbol: string, ttlMs = 5_000, base = env.geminiPublic()): Promise<Book> {
  return getJson<Book>(`${base}/v1/book/${encodeURIComponent(symbol)}`, ttlMs);
}

/** Plain text of a Gemini rich-text description (SPEC §5.6 display rule). */
export function richText(node: unknown): string {
  let out = "";
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n.nodeType === "text" && typeof n.value === "string") out += n.value;
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (typeof n.nodeType === "string" && (n.nodeType === "paragraph" || n.nodeType.startsWith("heading-") || n.nodeType === "list-item")) out += "\n";
  };
  if (typeof node === "string") return node.trim();
  walk(node);
  return out.trim();
}
