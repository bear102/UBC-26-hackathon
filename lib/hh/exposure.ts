// M1 Risk Scan (SPEC §14.2): one sentence about a business → the live Gemini markets that move its revenue or costs.
// Rule: the LLM picks markets and writes words; code computes every number (probability = mid, cost = Σ ask, depth from the book).
import crypto from "node:crypto";
import { searchEvents, book, type GEvent, type Book } from "./gemini";
import { quoteBin } from "./pricing";
import { env } from "./env";
import { kindOf, templateCards } from "./catalog";
import { venueFor, liveCapable, bookBase, isSandbox, hostOf, type Venue } from "./venue";
import { llmJson, llmProvider, errCode, cleanText, within } from "./llm";
export { within };

export type Shape = "exclusive" | "ladder";
export type Channel = "revenue" | "cost" | "financing";
export type Action = "promo" | "hedge" | "plan";

export type ExposureRow = {
  id: string;
  event_ticker: string; event_title: string; category: string; expiry?: string;
  symbols: string[]; labels: string[];
  shape: Shape; channel: Channel; action: Action; action_forced?: string;
  impact_usd: number; impact_source: "ai" | "default";
  why: string; basis_note: string; settles_on: string;
  p_bad: number | null; cost_per_usd: number | null; depth: number;
  flags: string[];              // thin, illiquid, no-book
  venue: { mode: "live" | "paper"; host: string; sandbox: boolean; why?: string };
};
export type Profile = { business_type: string; city: string; revenue_drivers?: string[]; cost_drivers?: string[]; financing?: string };
export type ExposureMap = { profile: Profile; rows: ExposureRow[]; source: "llm" | "fallback"; note?: string; ms: number; catalogSize: number };

type Raw = GEvent & { venueHint?: "trade"; source?: unknown; sourceDetails?: { agency?: string; index?: string; [k: string]: unknown } | null; volume24h?: string | number; [k: string]: unknown };

const DAY = 86400_000;
const CITIES = ["AUS", "SAT", "HOU", "DFW"];

// Same narrow queries as the promo catalog (shared HTTP cache). "Texas"/"Houston"/"Dallas" return 2-4 MB each and add
// nothing the filter keeps (checked 2026-11-19: 15.7 MB → 5 MB, 26 → 29 kept events).
const DATA_QUERIES = ["Spurs", "Rockets", "Mavericks", "Longhorns", "Aggies", "TCU", "Baylor", "SMU", "UTSA", "Austin", "San Antonio"];
const DATA_EXTRA = ["category=Weather", "category=Crypto", "category=Commodities", "category=Economics"];
const TRADE_EXTRA = ["category=Crypto", "category=Commodities"];
const hasAsk = (e: GEvent) => e.contracts?.some((c) => c.prices?.bestAsk) ?? false;

/** Live events a small Texas business could be exposed to (data venue + the trade venue's own financial events).
 *  Every search URL runs in parallel with its own time bound; the cache is stale-while-revalidate so a warm server
 *  never waits on Gemini. */
type CatCache = { t: number; v: Raw[]; inflight?: Promise<Raw[]> };
const catCache = ((globalThis as any).__hhSuiteCat2 ??= { t: 0, v: [] as Raw[] }) as CatCache;
const CAT_FRESH_MS = 60_000, CAT_STALE_MS = 5 * 60_000, CAT_QUERY_MS = Number(process.env.HH_CATALOG_QUERY_MS || 6_000);
let lastPartial = false; // some query timed out: keep the result only briefly so the next scan picks up the rest

export async function suiteCatalog(): Promise<Raw[]> {
  const age = Date.now() - catCache.t;
  if (catCache.v.length && age < CAT_FRESH_MS) return catCache.v;
  const refresh = refreshCatalog();
  if (catCache.v.length && age < CAT_STALE_MS) { refresh.catch(() => {}); return catCache.v; } // serve stale, refresh behind
  return refresh;
}

function refreshCatalog(): Promise<Raw[]> {
  return (catCache.inflight ??= suiteCatalogFresh()
    .then((v) => { if (v.length) { catCache.t = Date.now() - (lastPartial ? CAT_FRESH_MS - 10_000 : 0); catCache.v = v; } return v.length ? v : catCache.v; })
    .finally(() => { catCache.inflight = undefined; }));
}

/** Warm the Risk Scan catalog (call once at server start). With `keepWarm`, refresh it every ~60 s in the background. */
export function prewarmSuite(opts: { keepWarm?: boolean } = {}): Promise<number> {
  const g = globalThis as any;
  if (opts.keepWarm && !g.__hhSuiteWarm) {
    g.__hhSuiteWarm = setInterval(() => { refreshCatalog().catch(() => {}); }, 61_000);
    g.__hhSuiteWarm.unref?.();
  }
  return suiteCatalog().then((v) => v.length, () => 0);
}

async function suiteCatalogFresh(): Promise<Raw[]> {
  const now = Date.now();
  let partial = false;
  const TO = [] as Raw[];
  const one = async (q: string[], extra: string[], base?: string) => {
    const r = await within(searchEvents(q, extra, base) as Promise<Raw[]>, CAT_QUERY_MS, TO);
    if (r === TO) partial = true;
    return r;
  };
  const tradeOn = liveCapable() && env.geminiTrade() !== env.geminiPublic();
  const [dataLists, tradeLists] = await Promise.all([
    Promise.all([...DATA_QUERIES.map((q) => one([q], [])), ...DATA_EXTRA.map((x) => one([], [x]))]),
    tradeOn ? Promise.all(TRADE_EXTRA.map((x) => one([], [x], env.geminiTrade()))) : Promise.resolve([] as Raw[][]),
  ]);
  lastPartial = partial;
  return filterCatalog(dataLists.flat(), tradeLists.flat(), now);
}

/** Pure: merge data-venue and trade-venue events and keep what a small Texas business could use (unit-tested).
 *  A financial event the trade venue lists WITH a book replaces the data-venue copy (its symbols/strikes can differ),
 *  so the LLM and the rows see the contracts the Hedge Desk can actually buy. */
export function filterCatalog(data: Raw[], trade: Raw[], now = Date.now()): Raw[] {
  const byT = new Map<string, Raw>();
  for (const e of data) if (e?.ticker && e.status === "active" && !byT.has(e.ticker)) byT.set(e.ticker, e);
  const tradeBooked = new Set<string>();
  for (const e of trade) {
    if (!e?.ticker || e.status !== "active") continue;
    if (hasAsk(e)) { byT.set(e.ticker, { ...e, venueHint: "trade" }); tradeBooked.add(e.ticker); }
    else if (!byT.has(e.ticker)) byT.set(e.ticker, e);
  }
  const all = [...byT.values()];
  // crypto: hourly/daily BTC|ETH ladders only; prefer the ones the trade venue can fill, then the soonest
  const cryptoRank = (e: Raw) => (tradeBooked.has(e.ticker) ? 0 : 1);
  const rank = (e: Raw) => (e.category === "Crypto" ? cryptoRank(e) : 0);
  const sorted = all.sort((a, b) => rank(a) - rank(b) || Date.parse(a.expiryDate ?? "") - Date.parse(b.expiryDate ?? ""));
  const keep: Raw[] = [];
  let crypto = 0;
  for (const e of sorted) {
    const exp = Date.parse(e.expiryDate ?? "");
    if (!Number.isFinite(exp) || exp < now + 20 * 60_000) continue;
    const horizon = e.category === "Economics" ? 100 * DAY : 45 * DAY;
    if (exp > now + horizon) continue;
    if (!hasAsk(e)) continue; // no book anywhere: not usable (e.g. empty WTI month-end)
    if (e.category === "Weather") {
      const city = e.ticker.split("-")[1];
      if (!CITIES.includes(city) || exp > now + 3 * DAY) continue;
      // same rule as the promo catalog: the measured day must still be before ~noon CT (expiry is 22:59:59 CT that day)
      if (process.env.HH_WEATHER_ANYTIME !== "1" && exp - (10 * 3600 + 59 * 60 + 59) * 1000 < now + 30 * 60_000) continue;
    }
    else if (e.category === "Sports") { if (kindOf(e) !== "game") continue; }
    else if (e.category === "Crypto") {
      if (!/^(BTC|ETH)\d{10}$/.test(e.ticker)) continue; // no 5/15-min noise
      if (++crypto > 4) continue;
    } else if (!["Commodities", "Economics"].includes(e.category)) continue;
    keep.push(e);
  }
  return keep.sort((a, b) => Date.parse(a.expiryDate ?? "") - Date.parse(b.expiryDate ?? "")).slice(0, 70);
}

export function shapeOf(e: GEvent): Shape {
  if (e.category === "Weather" || e.category === "Sports" || /^FED/.test(e.ticker)) return "exclusive";
  if (e.contracts.some((c) => /or (above|more)|^\$?[\d,.]+\+?$/i.test(c.label) || /-HI[\dD]/.test(c.instrumentSymbol))) return "ladder";
  return "exclusive";
}

const midOf = (c: GEvent["contracts"][number]) => {
  const a = Number(c.prices?.bestAsk ?? NaN), b = Number(c.prices?.bestBid ?? NaN);
  return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a / 2 : null;
};

const trim = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** Compact catalog for the LLM prompt (unit-tested). Ladders: the thresholds nearest a coin flip; exclusive: every bin with a
 *  book (a scenario needs all of them), capped. Prices as cents; dates as YYYY-MM-DD HH:MMZ. */
export function catalogLines(cat: GEvent[], maxPerEvent = 8): string {
  return cat.map((e) => {
    const shape = shapeOf(e);
    let cs = e.contracts.filter((c) => c.prices?.bestAsk);
    if (shape === "ladder" && cs.length > 5) cs = [...cs].sort((a, b) => Math.abs((midOf(a) ?? 0) - 0.5) - Math.abs((midOf(b) ?? 0) - 0.5)).slice(0, 5);
    cs = cs.slice(0, maxPerEvent);
    const exp = (e.expiryDate ?? "").replace(/:\d\d(\.\d+)?Z$/, "Z").replace("T", " ");
    const list = cs.map((c) => `${c.instrumentSymbol}="${trim(c.label, 28)}" ${Math.round(Number(c.prices?.bestAsk) * 100)}c`).join("; ");
    return `- ${e.ticker}|${e.category}|${trim(e.title, 60)}|${shape}|${exp}|${list}`;
  }).join("\n");
}

// Plain JSON Schema subset accepted by both Anthropic structured output and Google `responseJsonSchema`
// (type/properties/required/items/enum/description only; no $ref, no additionalProperties, no min/max keywords).
export const SCHEMA = {
  type: "object",
  properties: {
    profile: {
      type: "object",
      properties: {
        business_type: { type: "string" }, city: { type: "string" },
        revenue_drivers: { type: "array", items: { type: "string" } }, cost_drivers: { type: "array", items: { type: "string" } }, financing: { type: "string" },
      },
      required: ["business_type", "city"],
    },
    exposures: {
      type: "array",
      description: "at most 6, most important first",
      items: {
        type: "object",
        properties: {
          event_ticker: { type: "string" },
          symbols: { type: "array", items: { type: "string" }, description: "instrumentSymbols that pay in the scenario that HURTS the business; for a ladder event exactly one" },
          channel: { type: "string", enum: ["revenue", "cost", "financing"] },
          action: { type: "string", enum: ["promo", "hedge", "plan"] },
          impact_usd: { type: "number", description: "rough $ hit to this business if the bad scenario happens" },
          why: { type: "string", description: "<=120 chars" },
          basis_note: { type: "string", description: "<=110 chars: how the market's settlement differs from the business's real exposure" },
        },
        required: ["event_ticker", "symbols", "channel", "action", "impact_usd", "why", "basis_note"],
      },
    },
  },
  required: ["profile", "exposures"],
} as const;

const SYSTEM =
  "You are a risk analyst for small Texas businesses. Given a one-sentence business description and a catalog of LIVE Gemini prediction markets, " +
  "list up to 6 markets whose outcome would hurt this business (revenue, costs or financing). Use ONLY tickers and instrumentSymbols from the catalog (the part before '='). " +
  "Catalog line: ticker|category|title|shape|expiry|symbol=\"label\" ask in cents; ... " +
  "`symbols` = the contracts that pay in the scenario that hurts the business. 'exclusive' events: all bins of that scenario, never every bin. " +
  "'ladder' events: exactly ONE threshold; a ladder contract pays only if the price ends AT OR ABOVE the threshold, so use a ladder only when a price RISE hurts " +
  "(input costs like natural gas) or for a customer promo that pays out on a rally. " +
  "action: 'promo' = turn it into a customer money-back promo (weather, local games, BTC rally promo for crypto-friendly shops); 'hedge' = the business buys cover directly (costs like natural gas); " +
  "'plan' = just plan around it (macro like Fed, unemployment, GDP). impact_usd = a rough, conservative dollar hit for a business this size (one day/event, not a year). " +
  "Never invent odds or prices; those come from the market. Keep why/basis_note short and plain. Sort by importance.";

type LlmRow = { event_ticker: string; symbols: string[]; channel: Channel; action: Action; impact_usd: number; why: string; basis_note: string };

const CHANNELS: Channel[] = ["revenue", "cost", "financing"];
const ACTIONS: Action[] = ["promo", "hedge", "plan"];
const IMPACT_MAX = 100_000;

/** Pure: keep LLM rows that name a catalog event and at least one of its contracts; normalize enums/impact (unit-tested). */
export function validateLlmRows(rows: unknown, byTicker: Map<string, GEvent>): LlmRow[] {
  if (!Array.isArray(rows)) return [];
  const out: LlmRow[] = [];
  for (const r of rows as Partial<LlmRow>[]) {
    if (!r || typeof r !== "object") continue;
    const e = byTicker.get(String(r.event_ticker ?? ""));
    if (!e) continue;
    const syms = new Set(e.contracts.map((c) => c.instrumentSymbol));
    const symbols = [...new Set((Array.isArray(r.symbols) ? r.symbols : []).map(String).filter((s) => syms.has(s)))];
    if (!symbols.length) continue;
    out.push({
      event_ticker: e.ticker, symbols,
      channel: CHANNELS.includes(r.channel as Channel) ? (r.channel as Channel) : "revenue",
      action: ACTIONS.includes(r.action as Action) ? (r.action as Action) : "plan",
      impact_usd: Math.min(IMPACT_MAX, Math.max(0, Number(r.impact_usd) || 0)),
      why: String(r.why ?? ""), basis_note: String(r.basis_note ?? ""),
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** Pure: which contracts a row really covers (unit-tested). Ladder → the single threshold nearest a coin flip.
 *  Exclusive → null if the strip covers every bin (pays always: not a risk, p would be ~1). */
export function pickSymbols(e: GEvent, wanted: string[]): string[] | null {
  const syms = new Set(e.contracts.map((c) => c.instrumentSymbol));
  let symbols = [...new Set(wanted.filter((s) => syms.has(s)))];
  if (!symbols.length) return null;
  if (shapeOf(e) === "ladder") {
    if (symbols.length > 1) symbols = [symbols.map((s) => ({ s, m: midOf(e.contracts.find((c) => c.instrumentSymbol === s)!) ?? 0 })).sort((a, b) => Math.abs(a.m - 0.5) - Math.abs(b.m - 0.5))[0].s];
    return symbols;
  }
  const live = e.contracts.filter((c) => c.status !== "settled" && c.status !== "resolved");
  if (live.length > 1 && live.every((c) => symbols.includes(c.instrumentSymbol))) return null;
  return symbols;
}

/** Pure numbers of a strip from per-leg quotes: P(bad) = Σ mid (exclusive bins are disjoint; a ladder row has one leg). */
export function stripNumbers(bins: { mid: number | null; ask: number | null; depth: number }[]) {
  const p_bad = !bins.length || bins.some((b) => b.mid == null) ? null : Math.round(Math.min(1, bins.reduce((a, b) => a + (b.mid as number), 0)) * 1000) / 1000;
  const cost = !bins.length || bins.some((b) => b.ask == null) ? null : Math.round(bins.reduce((a, b) => a + (b.ask as number), 0) * 10000) / 10000;
  const depth = bins.length ? Math.floor(Math.min(...bins.map((b) => b.depth))) : 0;
  return { p_bad, cost, depth };
}

function settlesOn(e: Raw): string {
  const sd = e.sourceDetails;
  if (sd && (sd.agency || sd.index)) return [sd.agency, sd.index].filter(Boolean).join(" · ");
  if (typeof e.source === "string" && e.source) return e.source;
  if (e.category === "Weather") return "NWS climate report (airport station)";
  if (e.category === "Sports") return "official game result";
  return "Gemini contract rules";
}

const EMPTY: Book = { bids: [], asks: [] };
const ENRICH_MS = Number(process.env.HH_ENRICH_MS || 5_000);
/** Book from the event JSON's top of book (amount unknown → depth 0) when the live book call is slow. */
const topOfBook = (c: GEvent["contracts"][number] | undefined): Book => ({
  bids: c?.prices?.bestBid ? [{ price: String(c.prices.bestBid), amount: "0" }] : [],
  asks: c?.prices?.bestAsk ? [{ price: String(c.prices.bestAsk), amount: "0" }] : [],
});

async function enrich(e: Raw, r: LlmRow, impactSource: "ai" | "default"): Promise<ExposureRow | null> {
  const symbols = pickSymbols(e, r.symbols ?? []);
  if (!symbols) return null;
  const shape = shapeOf(e);
  const contracts = symbols.map((s) => e.contracts.find((c) => c.instrumentSymbol === s)!);
  const flags: string[] = [];
  // Numbers come from the book of the venue this risk would actually be hedged on (sandbox when it lists the event AND
  // has a book there; otherwise production odds, labelled paper).
  const paper = (why: string): Venue => ({ data: env.geminiPublic(), trade: env.geminiTrade(), mode: "paper", resolve: env.geminiPublic(), why });
  let venue = await within(venueFor(e.ticker, symbols), ENRICH_MS - 1_500, paper("venue check timed out"));
  const fetchBooks = (base: string) => Promise.all(symbols.map(async (s) => {
    const b = await within(book(s, 5_000, base).then((x) => ({ x, ok: true })), 3_000, { x: EMPTY, ok: false });
    return b;
  }));
  let books = await fetchBooks(bookBase(venue));
  if (venue.mode === "live" && books.some((b) => !b.x.asks?.length) && env.geminiPublic() !== venue.trade) {
    venue = paper(`no book on ${hostOf(venue.trade)}`);
    books = await fetchBooks(venue.data);
  }
  const bookOf = (i: number): Book => {
    if (books[i].ok) return books[i].x;
    if (!flags.includes("stale")) flags.push("stale"); // book call slow: event-list top of book, depth unknown
    return e.venueHint === "trade" && venue.mode !== "live" ? EMPTY : topOfBook(contracts[i]);
  };
  const bins = symbols.map((s, i) => quoteBin(s, bookOf(i), env.limitSlippage()));
  const { p_bad, cost, depth } = stripNumbers(bins);

  if (cost == null) flags.push("no-book");
  else if (depth < 50 && !flags.includes("stale")) flags.push("thin");
  const v24 = Number(e.volume24h ?? NaN);
  if (Number.isFinite(v24) && v24 === 0) flags.push("illiquid");

  let action: Action = r.action;
  let forced: string | undefined;
  const promoOk = kindOf(e) != null;
  if (action === "promo" && !promoOk) { action = "hedge"; forced = "not a promo market"; }
  if (e.category === "Economics" || e.category === "Politics") { if (action !== "plan") forced = "macro markets are plan-only"; action = "plan"; }
  else if (cost != null && cost > 0.75 && action !== "plan") { action = "plan"; forced = `cover costs ${Math.round(cost * 100)}¢ per $1`; }
  else if (cost == null && action !== "plan") { action = "plan"; forced = "no order book"; }

  const settles = settlesOn(e);
  const impact = Math.min(IMPACT_MAX, Math.max(0, Math.round(Number(r.impact_usd) || 0)));
  return {
    id: crypto.createHash("sha256").update(`${e.ticker}|${symbols.join(",")}`).digest("hex").slice(0, 12),
    event_ticker: e.ticker, event_title: e.title, category: e.category, expiry: e.expiryDate,
    symbols, labels: contracts.map((c) => c.label), shape,
    channel: r.channel, action, action_forced: forced,
    impact_usd: impact || 100, impact_source: impact ? impactSource : "default",
    why: cleanText(r.why).slice(0, 120),
    basis_note: `Settles on ${settles}. ${cleanText(r.basis_note).slice(0, 110)}`.trim(),
    settles_on: settles,
    p_bad, cost_per_usd: cost, depth,
    flags,
    venue: { mode: venue.mode, host: hostOf(venue.mode === "live" ? venue.trade : venue.data), sandbox: venue.mode === "live" && isSandbox(venue.trade), why: venue.why },
  };
}

/** Rank: expected hit (P × $) first; rows with a usable price before rows without (unit-tested). */
export function rankRows<T extends { id: string; p_bad: number | null; impact_usd: number; cost_per_usd: number | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => (b.p_bad ?? 0) * b.impact_usd - (a.p_bad ?? 0) * a.impact_usd || Number(b.cost_per_usd != null) - Number(a.cost_per_usd != null));
}

/** Keyword fallback when the LLM is missing, slow or wrong: promo templates + simple cost/financing rows. */
async function fallbackRows(text: string, cat: Raw[]): Promise<{ profile: Profile; rows: LlmRow[] }> {
  const t = text.toLowerCase();
  const rows: LlmRow[] = [];
  const byTicker = new Map(cat.map((e) => [e.ticker, e]));
  try {
    const promoCat = cat.flatMap((e) => { const k = kindOf(e); return k ? [{ ...e, kind: k }] : []; });
    for (const c of await within(templateCards(promoCat), 3_000, [])) {
      if (!byTicker.has(c.event_ticker)) continue;
      const wx = c.event_ticker.startsWith("WXHIGH");
      const btc = /^BTC/.test(c.event_ticker);
      if (wx && !/coffee|cart|iced|patio|truck|drink|cafe|tea|smoothie|ice/.test(t)) continue;
      if (btc && !/crypto|bitcoin|btc|coffee|cart/.test(t)) continue;
      if (!wx && !btc && !/bar|pub|watch|game|sport|wing|beer/.test(t)) continue;
      rows.push({ event_ticker: c.event_ticker, symbols: c.strip, channel: "revenue", action: "promo", impact_usd: wx ? 150 : btc ? 100 : 250, why: c.why, basis_note: wx ? "Airport station, not your street corner." : "Same contract settles the promo and the hedge." });
    }
  } catch { /* templates are best-effort */ }
  // Prefer an event the trade venue lists with a book (so the Hedge Desk can actually buy it), else the latest one with a
  // two-sided book; threshold nearest a coin flip. Catalog copies of trade-venue events carry the trade venue's prices.
  const ladderNear = async (re: RegExp) => {
    const cands: { e: Raw; c: GEvent["contracts"][number] }[] = [];
    for (const e of cat.filter((x) => re.test(x.ticker)).sort((a, b) => Number(b.venueHint === "trade") - Number(a.venueHint === "trade") || Date.parse(b.expiryDate ?? "") - Date.parse(a.expiryDate ?? ""))) {
      const c = e.contracts.filter((x) => x.prices?.bestAsk && x.prices?.bestBid).sort((a, b) => Math.abs((midOf(a) ?? 0) - 0.5) - Math.abs((midOf(b) ?? 0) - 0.5))[0];
      if (c) cands.push({ e, c });
    }
    const live = await Promise.all(cands.slice(0, 4).map((x) => within(venueFor(x.e.ticker, [x.c.instrumentSymbol]).then((v) => v.mode === "live"), 3_000, false)));
    return cands[live.indexOf(true)] ?? cands[0] ?? null;
  };
  const [gas, btc] = await Promise.all([
    /gas|griddle|stove|kitchen|restaurant|taco|taqueria|grill|bbq|bakery/.test(t) ? ladderNear(/^NGAS\d{10}$/) : null,
    /crypto|bitcoin|btc/.test(t) ? ladderNear(/^BTC\d{10}$/) : null,
  ]);
  if (gas) rows.push({ event_ticker: gas.e.ticker, symbols: [gas.c.instrumentSymbol], channel: "cost", action: "hedge", impact_usd: 300, why: "Gas griddles and ovens: a price spike raises next month's bill.", basis_note: "Your utility bill follows the index with a lag." });
  // A ladder contract pays when BTC ends at/above the strike: that covers a "coffee's on us if BTC rallies" promo, not a drop.
  if (btc) rows.push({ event_ticker: btc.e.ticker, symbols: [btc.c.instrumentSymbol], channel: "revenue", action: "promo", impact_usd: 100, why: `Crypto fans: "coffee's on us if BTC ends ${btc.c.label}"; this contract pays the refunds.`, basis_note: "Gemini's BTC index at expiry, not your sale price." });
  if (/loan|sba|credit|mortgage|lease|rate/.test(t)) {
    const fed = cat.find((e) => /^FED/.test(e.ticker));
    const hike = fed?.contracts.find((c) => /hike/i.test(c.label) && c.prices?.bestAsk);
    if (fed && hike) rows.push({ event_ticker: fed.ticker, symbols: [hike.instrumentSymbol], channel: "financing", action: "plan", impact_usd: 200, why: "A variable-rate loan costs more after a hike.", basis_note: "The Fed decision, not your lender's rate." });
  }
  const city = /san antonio/.test(t) ? "San Antonio" : /houston/.test(t) ? "Houston" : /dallas/.test(t) ? "Dallas" : "Austin";
  return { profile: { business_type: text.slice(0, 60), city }, rows: rows.slice(0, 6) };
}

const cache = ((globalThis as any).__hhExposureCache ??= new Map<string, { t: number; v: ExposureMap }>()) as Map<string, { t: number; v: ExposureMap }>;
const llmMs = (p: string) => Number(process.env.HH_SCAN_LLM_MS || (p === "google" ? 16_000 : 25_000));

async function enrichAll(raw: LlmRow[], byTicker: Map<string, Raw>, src: "ai" | "default"): Promise<ExposureRow[]> {
  const rows = await Promise.all(raw.map((r) => within(enrich(byTicker.get(r.event_ticker)!, r, src), ENRICH_MS + 1_000, null)));
  return rows.filter((r): r is ExposureRow => !!r);
}

export async function scanExposures(text: string, opts: { fresh?: boolean } = {}): Promise<ExposureMap> {
  const key = crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.t < 10 * 60_000) return hit.v;
  const t0 = Date.now();
  const cat = await suiteCatalog();
  if (!cat.length) throw Object.assign(new Error("Gemini market list is unreachable right now; try again in a minute"), { status: 503 });
  const byTicker = new Map(cat.map((e) => [e.ticker, e]));
  let profile: Profile | null = null, rows: ExposureRow[] = [], source: ExposureMap["source"] = "llm", note: string | undefined;
  const provider = llmProvider();
  if (provider) {
    try {
      const out = await llmJson({ system: SYSTEM, user: `Business: ${text.slice(0, 400)}\n\nLive Gemini catalog:\n${catalogLines(cat)}`, schema: SCHEMA, timeoutMs: llmMs(provider), maxTokens: provider === "google" ? 3000 : undefined });
      if (out.refused) throw Object.assign(new Error("refused"), { status: "refused" });
      let parsed: { profile?: Profile; exposures?: unknown };
      try { parsed = JSON.parse(out.text || "{}"); } catch { throw Object.assign(new Error("bad JSON"), { status: "bad-json" }); }
      profile = parsed.profile && typeof parsed.profile.business_type === "string" ? parsed.profile : null;
      const raw = validateLlmRows(parsed.exposures, byTicker);
      if (!raw.length) throw Object.assign(new Error("no valid markets"), { status: "no-valid-markets" });
      rows = await enrichAll(raw, byTicker, "ai");
      if (!rows.length) throw Object.assign(new Error("no usable rows"), { status: "no-usable-rows" });
      note = provider;
    } catch (e) {
      source = "fallback"; note = `${provider} ${errCode(e)}; keyword fallback`;
    }
  } else { source = "fallback"; note = "no LLM key; keyword fallback"; }
  if (source === "fallback") {
    const fb = await fallbackRows(text, cat);
    profile = profile ?? fb.profile;
    rows = await enrichAll(fb.rows, byTicker, "default");
  }
  const v: ExposureMap = { profile: profile ?? { business_type: text.slice(0, 60), city: "Austin" }, rows: rankRows(rows), source, note, ms: Date.now() - t0, catalogSize: cat.length };
  if (rows.length) cache.set(key, { t: Date.now(), v });
  return v;
}
