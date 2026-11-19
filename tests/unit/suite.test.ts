// Suite (SPEC §14): Hedge Desk sizing, market shape, text cleanup. Pure functions only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeTicket, floorStep, tickLimit, limitsWithin, humanOrderError, parseBatch } from "../../lib/hh/hedgeDesk";
import { shapeOf, filterCatalog, validateLlmRows, pickSymbols, stripNumbers, rankRows, catalogLines, SCHEMA } from "../../lib/hh/exposure";
import { cleanText, googleThinking, retryableStatus, within } from "../../lib/hh/llm";
import type { GEvent } from "../../lib/hh/gemini";

const bk = (asks: [number, number][], bids: [number, number][] = []) => ({
  asks: asks.map(([p, a]) => ({ price: String(p), amount: String(a) })), bids: bids.map(([p, a]) => ({ price: String(p), amount: String(a) })),
});

test("single ladder threshold: qty = payout, premium = book walk", () => {
  const z = sizeTicket([{ symbol: "NG-HI4", label: "$4 or above", book: bk([[0.35, 0.76], [0.36, 250]], [[0.31, 250]]) }], 100);
  assert.equal(z.legs[0].qty, 100);
  assert.equal(z.premium, 35.99); // 0.76*0.35 + 99.24*0.36
  assert.equal(z.fillable, true);
  assert.equal(z.p_bad, 0.33);
  assert.equal(z.expected_payout, 33);
});

test("exclusive strip: buy payout of each bin, p = sum of mids", () => {
  const z = sizeTicket([
    { symbol: "A", label: "a", book: bk([[0.2, 100]], [[0.18, 100]]) },
    { symbol: "B", label: "b", book: bk([[0.3, 100]], [[0.28, 100]]) },
  ], 50);
  assert.equal(z.premium, 25);
  assert.equal(z.fair, 24);
  assert.equal(z.p_bad, 0.48);
});

test("not enough depth → not fillable; empty book → no premium", () => {
  assert.equal(sizeTicket([{ symbol: "A", label: "a", book: bk([[0.5, 250]]) }], 300).fillable, false);
  const z = sizeTicket([{ symbol: "A", label: "a", book: bk([]) }], 10);
  assert.equal(z.premium, null);
  assert.equal(z.fillable, false);
});

test("shapeOf: weather/sports/Fed exclusive, '$X or above' ladders", () => {
  const ev = (category: string, ticker: string, labels: string[]) => ({ category, ticker, contracts: labels.map((l, i) => ({ label: l, instrumentSymbol: `${ticker}-X${i}` })) }) as unknown as GEvent;
  assert.equal(shapeOf(ev("Weather", "WXHIGH-AUS-1", ["74°F or above", "72°F to 73°F"])), "exclusive");
  assert.equal(shapeOf(ev("Economics", "FED261211", ["Hike 25bps", "Maintain"])), "exclusive");
  assert.equal(shapeOf(ev("Commodities", "NGAS2611302200", ["$3.8 or above", "$4 or above"])), "ladder");
  assert.equal(shapeOf(ev("Crypto", "BTC2611192200", ["$63,000 or above"])), "ladder");
});

test("cleanText fixes garbled arrows and drops replacement chars", () => {
  assert.equal(cleanText("Spurs lose â†’ $1 back"), "Spurs lose → $1 back");
  assert.equal(cleanText("Under 72°F -> $1 back"), "Under 72°F → $1 back");
  assert.equal(cleanText("odd� text"), "odd text");
});

// ---- hardening (2026-11-19): increments, ticks, spend caps, Gemini errors, catalog merge, LLM row validation ----

test("floorStep / tickLimit: quantity increments and the 1¢ tick, capped at 0.99", () => {
  assert.equal(floorStep(20, 1), 20);
  assert.equal(floorStep(20.567, 0.01), 20.56);
  assert.equal(floorStep(0.3, 0.1), 0.3);
  assert.equal(tickLimit(0.35, 0.02), 0.37);
  assert.equal(tickLimit(0.98, 0.02), 0.99);
  assert.equal(tickLimit(0.99, 0.02), 0.99);
  assert.equal(tickLimit(0.355, 0.0, 0.01), 0.36); // never below the ask
  assert.equal(tickLimit(0.4, 0.02, 0.05), 0.4);
});

test("sizeTicket honours quantityIncrement/minimum and only counts depth within the limit", () => {
  const z = sizeTicket([{ symbol: "A", label: "a", book: bk([[0.4, 5], [0.5, 100]], [[0.38, 10]]), meta: { quantityIncrement: "0.01", quantityMinimum: "0.01", priceIncrement: "0.01" } }], 10);
  assert.equal(z.legs[0].limit, 0.42);
  assert.equal(z.legs[0].qty, 10);
  assert.equal(z.legs[0].depth, 5);
  assert.equal(z.fillable, false); // the 0.50 level is beyond ask+2¢: an IOC at 0.42 would only get 5
  const big = sizeTicket([{ symbol: "A", label: "a", book: bk([[0.4, 50]]), meta: { quantityIncrement: "5", quantityMinimum: "5" } }], 12);
  assert.equal(big.legs[0].qty, 10);
  const tiny = sizeTicket([{ symbol: "A", label: "a", book: bk([[0.4, 50]]), meta: { quantityIncrement: "1", quantityMinimum: "5" } }], 3);
  assert.equal(tiny.legs[0].qty, 0);
  assert.equal(tiny.fillable, false);
  const ok = sizeTicket([{ symbol: "A", label: "a", book: bk([[0.4, 5], [0.41, 100]]) }], 10);
  assert.equal(ok.legs[0].top, 0.41);
  assert.equal(ok.max_spend, 4.2);
});

test("limitsWithin keeps worst-case IOC spend within the buyer's max", () => {
  assert.deepEqual(limitsWithin([{ qty: 10, limit: 0.42, top: 0.4 }], 5), { prices: [0.42] });
  assert.deepEqual(limitsWithin([{ qty: 10, limit: 0.42, top: 0.4 }], 4.1), { prices: [0.4] });
  assert.ok("error" in limitsWithin([{ qty: 10, limit: 0.42, top: 0.41 }], 4));
  assert.ok("error" in limitsWithin([{ qty: 10, limit: null, top: null }], 4));
});

test("humanOrderError / parseBatch turn Gemini rejections into readable text", () => {
  assert.match(humanOrderError(Object.assign(new Error("Gemini /v1/x 400"), { body: '{"result":"error","reason":"InsufficientFunds","message":"Insufficient funds"}' })), /Not enough USD/);
  assert.match(humanOrderError({ error: "InvalidQuantity", message: "bad qty" }), /quantity/);
  assert.match(humanOrderError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), /didn't answer/);
  assert.equal(humanOrderError("something odd"), "something odd");
  const reqs = [{ symbol: "A", quantity: 10, price: 0.4 }, { symbol: "B", quantity: 10, price: 0.3 }];
  const f = parseBatch({ results: [{ order: { orderId: 7, status: "filled", filledQuantity: "10", avgExecutionPrice: "0.39" } }, { error: "InsufficientFunds", message: "no money" }] }, reqs);
  assert.equal(f[0].filled, 10); assert.equal(f[0].avgPx, 0.39); assert.equal(f[0].orderId, "7");
  assert.equal(f[1].filled, 0); assert.match(f[1].status, /^rejected: Not enough USD/);
  assert.equal(parseBatch([{ orderId: 9, status: "filled", filledQuantity: "10" }], reqs.slice(0, 1))[0].orderId, "9");
  assert.equal(parseBatch(null, reqs).length, 2);
});

const NOW = Date.parse("2026-11-19T04:00:00Z");
type Ev = GEvent & { venueHint?: "trade" };
const evt = (ticker: string, category: string, expiry: string, labels: [string, number | null, number | null][]): Ev => ({
  id: ticker, title: `${ticker} title`, ticker, category, type: "categorical", status: "active", expiryDate: expiry,
  contracts: labels.map(([label, bid, ask], i) => ({ id: `${i}`, label, ticker, instrumentSymbol: `GEMI-${ticker}-C${i}`, status: "active", prices: { bestBid: bid == null ? null : String(bid), bestAsk: ask == null ? null : String(ask) } })),
});

test("filterCatalog: trade-venue copy with a book wins; crypto prefers it; junk dropped", () => {
  const dataBtc = evt("BTC2611202200", "Crypto", "2026-11-20T22:00:00Z", [["$63,000 or above", 0.5, 0.55]]);
  const tradeBtc = evt("BTC2611192200", "Crypto", "2026-11-19T22:00:00Z", [["$62,500 or above", 0.47, 0.5]]);
  const tradeEmpty = evt("BTC2611202200", "Crypto", "2026-11-20T22:00:00Z", [["$62,000 or above", null, null]]);
  const fiveMin = evt("BTC05M2611190500", "Crypto", "2026-11-19T05:00:00Z", [["up", 0.4, 0.5]]);
  const gone = evt("NGAS2611190410", "Commodities", "2026-11-19T04:10:00Z", [["$4 or above", 0.4, 0.5]]);
  const politics = evt("PRES28", "Politics", "2026-12-01T00:00:00Z", [["x", 0.4, 0.5]]);
  const out = filterCatalog([dataBtc, fiveMin, gone, politics], [tradeBtc, tradeEmpty], NOW) as Ev[];
  assert.deepEqual(out.map((e) => e.ticker), ["BTC2611192200", "BTC2611202200"]);
  assert.equal(out[0].venueHint, "trade");
  assert.equal(out[1].contracts[0].label, "$63,000 or above"); // the empty trade copy did not replace the data copy
});

test("validateLlmRows: unknown tickers/symbols dropped, enums and impact normalized", () => {
  const e = evt("WXHIGH-AUS-2611200459", "Weather", "2026-11-20T04:59:59Z", [["69°F or below", 0.1, 0.12], ["70°F to 71°F", 0.2, 0.25]]);
  const by = new Map<string, GEvent>([[e.ticker, e]]);
  const rows = validateLlmRows([
    { event_ticker: "NOPE", symbols: ["x"] },
    { event_ticker: e.ticker, symbols: ["bogus"] },
    { event_ticker: e.ticker, symbols: [e.contracts[0].instrumentSymbol, "bogus"], channel: "weird", action: "promo", impact_usd: 1e9, why: "w", basis_note: "b" },
  ], by);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].symbols, [e.contracts[0].instrumentSymbol]);
  assert.equal(rows[0].channel, "revenue");
  assert.equal(rows[0].impact_usd, 100_000);
  assert.deepEqual(validateLlmRows("nope", by), []);
});

test("pickSymbols / stripNumbers: exclusive = Σ mids, all-bins strip rejected; ladder = one threshold near 50%", () => {
  const wx = evt("WXHIGH-AUS-1", "Weather", "2026-11-20T04:59:59Z", [["a", 0.1, 0.12], ["b", 0.3, 0.34], ["c", 0.5, 0.56]]);
  const s = wx.contracts.map((c) => c.instrumentSymbol);
  assert.equal(pickSymbols(wx, s), null);
  assert.deepEqual(pickSymbols(wx, s.slice(0, 2)), s.slice(0, 2));
  const lad = evt("BTC2611192200", "Crypto", "2026-11-19T22:00:00Z", [["$62,000 or above", 0.59, 0.64], ["$62,500 or above", 0.47, 0.5], ["$63,000 or above", 0.36, 0.4]]);
  assert.deepEqual(pickSymbols(lad, lad.contracts.map((c) => c.instrumentSymbol)), [lad.contracts[1].instrumentSymbol]);
  assert.deepEqual(stripNumbers([{ mid: 0.11, ask: 0.12, depth: 40 }, { mid: 0.32, ask: 0.34, depth: 90.5 }]), { p_bad: 0.43, cost: 0.46, depth: 40 });
  assert.deepEqual(stripNumbers([{ mid: 0.7, ask: 0.72, depth: 5 }, { mid: 0.6, ask: null, depth: 0 }]), { p_bad: 1, cost: null, depth: 0 });
  assert.equal(stripNumbers([{ mid: 0.7, ask: 0.72, depth: 5 }, { mid: null, ask: null, depth: 0 }]).p_bad, null);
});

test("rankRows: dedupe by id, expected hit first, priced rows before unpriced", () => {
  const r = (id: string, p: number | null, usd: number, cost: number | null = 0.5) => ({ id, p_bad: p, impact_usd: usd, cost_per_usd: cost });
  assert.deepEqual(rankRows([r("a", 0.1, 100), r("b", 0.5, 100), r("a", 0.9, 100), r("c", null, 100, null), r("d", 0, 100)]).map((x) => x.id), ["b", "a", "d", "c"]);
});

test("catalogLines is compact; SCHEMA uses only keywords Google responseJsonSchema accepts", () => {
  const lad = evt("BTC2611192200", "Crypto", "2026-11-19T22:00:00.000Z", Array.from({ length: 12 }, (_, i) => [`$${60000 + i * 250} or above`, 0.9 - i * 0.07, 0.95 - i * 0.07] as [string, number, number]));
  const line = catalogLines([lad]);
  assert.equal((line.match(/GEMI-/g) ?? []).length, 5);
  assert.match(line, /2026-11-19 22:00Z/);
  const ok = new Set(["type", "properties", "required", "items", "enum", "description"]);
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) {
      assert.ok(ok.has(k), `unsupported keyword ${k}`);
      if (k === "properties") Object.values(v as object).forEach(walk); else if (k === "items") walk(v);
    }
  };
  walk(SCHEMA);
});

test("llm helpers: thinking off for 2.5 Flash, retry only on 429/5xx, within() bounds time", async () => {
  process.env.GOOGLE_THINKING = "";
  assert.deepEqual(googleThinking("gemini-2.5-flash"), { thinkingBudget: 0 });
  assert.equal(googleThinking("gemini-2.5-pro"), undefined);
  assert.equal(retryableStatus(503), true); assert.equal(retryableStatus(429), true); assert.equal(retryableStatus(400), false);
  const t0 = Date.now();
  assert.equal(await within(new Promise<string>(() => {}), 30, "late"), "late");
  assert.ok(Date.now() - t0 < 500);
  assert.equal(await within(Promise.reject(new Error("x")), 1000, "fb"), "fb");
  assert.equal(await within(Promise.resolve("ok"), 1000, "fb"), "ok");
});
