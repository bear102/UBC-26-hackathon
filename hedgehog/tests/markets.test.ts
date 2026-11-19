// Market layer unit tests (offline: recorded fixtures, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseBounds, normalizeGeminiEvents, contractMeta, inBounds, tempPeril } from "../lib/markets/normalize";
import { normalizeKalshiEvent, kalshiTickerDate, seriesSpec, type KEvent, type KMarket } from "../lib/markets/dflow";
import { geminiLevels } from "../lib/markets/book";
import { sizeQuote, walk, MAX_INSURANCE_ASK } from "../lib/markets/quote";
import { parseWindow, teamsIn, triggerNumber } from "../lib/markets";
import type { GEvent } from "../lib/markets/geminiPm";
import type { HedgeLeg, MarketContract, Risk } from "../lib/types";

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8"));

// ---------- label parsing ----------

test("parseBounds: Gemini temperature bins", () => {
  assert.deepEqual(pick(parseBounds("95°F to 96°F")), { lo: 95, hi: 96, unit: "°F", text: "95°F–96°F" });
  assert.deepEqual(pick(parseBounds("78°F or above")), { lo: 78, hi: undefined, unit: "°F", text: "≥78°F" });
  assert.deepEqual(pick(parseBounds("69°F or below")), { lo: undefined, hi: 69, unit: "°F", text: "≤69°F" });
  assert.deepEqual(pick(parseBounds("17°C")), { lo: 17, hi: 17, unit: "°C", text: "17°C" });
  assert.deepEqual(pick(parseBounds("22°C or above")), { lo: 22, hi: undefined, unit: "°C", text: "≥22°C" });
});

test("parseBounds: prices, Kalshi phrasing, non-numeric", () => {
  assert.deepEqual(pick(parseBounds("$61,500 or above")), { lo: 61500, hi: undefined, unit: "$", text: "≥$61500" });
  assert.deepEqual(pick(parseBounds("76° to 77°")), { lo: 76, hi: 77, unit: "°F", text: "76°F–77°F" });
  const a = parseBounds("Above 3.65")!;
  assert.equal(a.lo, 3.65); assert.equal(a.loInclusive, false); assert.equal(a.text, ">3.65");
  assert.equal(parseBounds("Above $88.99")!.lo, 88.99);
  assert.equal(parseBounds("Below $77.00")!.hi, 77);
  assert.equal(parseBounds("Above 5 inches")!.text, ">5in");
  assert.equal(parseBounds("Above -0.3%")!.lo, -0.3);
  assert.equal(parseBounds("$85.00 to $85.99")!.hi, 85.99);
  assert.equal(parseBounds("San Antonio"), null);
  assert.equal(parseBounds("Up"), null);
});

test("inBounds + tempPeril", () => {
  const b = parseBounds("78°F or above")!;
  assert.ok(inBounds(78, b)); assert.ok(!inBounds(77, b));
  assert.ok(!inBounds(3.65, parseBounds("Above 3.65")!));
  assert.equal(tempPeril(parseBounds("69°F or below")), "cold");
  assert.equal(tempPeril(parseBounds("74°F to 75°F")), "heat");
  assert.equal(tempPeril(parseBounds("78°F or above")), "heat");
});

function pick(b: ReturnType<typeof parseBounds>) {
  return b && { lo: b.lo, hi: b.hi, unit: b.unit, text: b.text };
}

// ---------- Gemini normalization ----------

test("normalizeGeminiEvents: recorded Austin daily-high event", () => {
  const ev = fx("gemini-event-austin-high.json") as GEvent;
  const cs = normalizeGeminiEvents([ev]);
  assert.equal(cs.length, ev.contracts.length);
  for (const c of cs) {
    assert.equal(c.venue, "gemini");
    assert.ok(c.id.startsWith("gemini:GEMI-WXHIGH-AUS-"));
    assert.equal(c.location, "Austin");
    assert.equal(c.tradable, true); // sold on Solana (devnet tokens), backed on Gemini
    assert.equal(c.status, "open");
    assert.equal(c.url, "https://www.gemini.com/predictions/WXHIGH-AUS-2611200459");
    assert.ok(c.yesAsk === null || (c.yesAsk > 0 && c.yesAsk < 1));
    const m = contractMeta(c.id)!;
    assert.equal(m.eventDate, "2026-11-19");
    assert.match(m.station ?? "", /Austin-Bergstrom/);
  }
  const low = cs.find((c) => c.label === "69°F or below")!;
  assert.equal(low.peril, "cold");
  const top = cs.find((c) => c.label === "78°F or above")!;
  assert.equal(top.peril, "heat");
  assert.equal(contractMeta(top.id)!.bounds!.text, "≥78°F");
  const mid = cs.find((c) => c.label === "74°F to 75°F")!;
  const raw = ev.contracts.find((c) => c.label === "74°F to 75°F")!;
  assert.equal(mid.yesAsk, Number(raw.prices!.buy!.yes));
  assert.equal(mid.noAsk, Number(raw.prices!.buy!.no));
  assert.equal(mid.yesBid, Number(raw.prices!.sell!.yes));
});

test("normalizeGeminiEvents: settled event carries resolution", () => {
  const cs = normalizeGeminiEvents([fx("gemini-event-austin-high-settled.json")]);
  assert.ok(cs.every((c) => c.status === "settled"));
  const yes = cs.filter((c) => c.resolution === "yes");
  assert.equal(yes.length, 1);
  assert.equal(yes[0].label, "66°F to 67°F");
});

test("normalizeGeminiEvents: sports moneyline + commodity", () => {
  const nba = normalizeGeminiEvents([fx("gemini-event-nba-nop-sas.json")]);
  assert.equal(nba.length, 2);
  const sas = nba.find((c) => c.label === "San Antonio")!;
  assert.equal(sas.peril, "game");
  const m = contractMeta(sas.id)!;
  assert.equal(m.league, "NBA");
  assert.ok(m.teams!.includes("San Antonio Spurs"));
  assert.ok(m.opponents!.includes("New Orleans"));
  const wti = normalizeGeminiEvents([fx("gemini-event-wti.json")]);
  assert.ok(wti.length > 0 && wti.every((c) => c.peril === "oil" && c.location === undefined));
  // props are dropped unless asked for
  const prop = { ...fx("gemini-event-nba-nop-sas.json"), ticker: "NBA-2611220100-NOP-SAS-1QS" };
  assert.equal(normalizeGeminiEvents([prop]).length, 0);
});

test("geminiLevels: YES asks from asks, NO asks = 1 - bids", () => {
  const b = geminiLevels(fx("gemini-book-austin-74to75.json"));
  assert.ok(b.yes.length > 0 && b.no.length > 0);
  for (let i = 1; i < b.yes.length; i++) assert.ok(b.yes[i].price >= b.yes[i - 1].price);
  const raw = fx("gemini-book-austin-74to75.json");
  assert.equal(b.no[0].price, Math.round((1 - Number(raw.bids[0].price)) * 10000) / 10000);
});

// ---------- Kalshi normalization ----------

test("normalizeKalshiEvent: weekend rain, multi-city location from subtitle", () => {
  const r = fx("kalshi-event-rainwknd.json") as { event: KEvent; markets: KMarket[] };
  const cs = normalizeKalshiEvent({ ...r.event, markets: r.event.markets?.length ? r.event.markets : r.markets }, seriesSpec("KXRAINWKND"));
  const aus = cs.find((c) => c.location === "Austin")!;
  assert.ok(aus, "Austin weekend rain market present");
  assert.equal(aus.id, "kalshi:KXRAINWKND-26NOV21-AUS");
  assert.equal(aus.peril, "rain");
  assert.equal(aus.tradable, true);
  assert.equal(aus.url, "https://kalshi.com/markets/kxrainwknd");
  const m = contractMeta(aus.id)!;
  assert.equal(m.eventDate, "2026-11-21");
  assert.equal(m.eventEnd, "2026-11-22");
  assert.equal(m.source, "kalshi-public");
});

test("normalizeKalshiEvent: NFL game teams", () => {
  const r = fx("kalshi-event-nfl-ind-hou.json") as { event: KEvent; markets: KMarket[] };
  const cs = normalizeKalshiEvent({ ...r.event, markets: r.event.markets?.length ? r.event.markets : r.markets }, seriesSpec("KXNFLGAME"));
  const hou = cs.find((c) => c.label === "Houston")!;
  assert.equal(hou.peril, "game");
  assert.deepEqual(contractMeta(hou.id)!.opponents, ["Indianapolis"]);
  assert.equal(contractMeta(hou.id)!.league, "NFL");
});

test("kalshiTickerDate", () => {
  assert.deepEqual(kalshiTickerDate("KXHIGHAUS-26NOV19"), { date: "2026-11-19", month: "2026-11" });
  assert.deepEqual(kalshiTickerDate("KXRAINAUSM-26NOV"), { month: "2026-11" });
});

// ---------- helpers ----------

test("parseWindow / teamsIn / triggerNumber", () => {
  const now = new Date("2026-11-19T18:00:00Z"); // Thursday in Austin
  assert.deepEqual(parseWindow("this weekend", now), { start: "2026-11-21", end: "2026-11-22" });
  assert.deepEqual(parseWindow("next 7 days", now), { start: "2026-11-19", end: "2026-11-26" });
  assert.deepEqual(parseWindow("2026-11-21", now), { start: "2026-11-21", end: "2026-11-21" });
  assert.deepEqual(parseWindow("tomorrow", now), { start: "2026-11-20", end: "2026-11-20" });
  assert.deepEqual(parseWindow("Saturday", now), { start: "2026-11-21", end: "2026-11-21" });
  assert.equal(teamsIn("Spurs lose on game night")[0].names[0], "San Antonio");
  assert.equal(teamsIn("Texans lose")[0].league[0], "NFL");
  assert.equal(triggerNumber("Austin high >= 98F"), 98);
  assert.equal(triggerNumber("gas above $3.50"), 3.5);
});

// ---------- sizing ----------

const mk = (id: string, venue: MarketContract["venue"], yesAsk: number | null, noAsk: number | null, extra: Partial<MarketContract> = {}): MarketContract => ({
  id, venue, eventTitle: "t", label: id, symbol: id, eventTicker: "e", peril: "heat", expiry: "2099-01-01T00:00:00Z",
  yesAsk, yesBid: yesAsk === null ? null : yesAsk - 0.01, noAsk, noBid: noAsk === null ? null : noAsk - 0.01,
  tradable: venue === "kalshi", status: "open", resolution: null, ...extra,
});
const risk = (id: string, lossUsd: number): Risk => ({ id, peril: "heat", title: id, trigger: "x", lossUsd, lossReasoning: "", confidence: 0.5 });
const leg = (riskId: string, contractId: string, side: "yes" | "no" = "yes"): HedgeLeg => ({ riskId, contractId, side, rationale: "", basisRisk: "" });

test("walk: average fill across levels", () => {
  const w = walk([{ price: 0.2, size: 10 }, { price: 0.3, size: 10 }], 15);
  assert.equal(w.filled, 15);
  assert.ok(Math.abs(w.cost - (10 * 0.2 + 5 * 0.3)) < 1e-9);
  assert.equal(walk([{ price: 0.9, size: 10 }], 5).filled, 0); // above the 0.85 cap
});

test("sizeQuote: contracts = ceil(coverage x loss), action per venue, impliedProb = ask", async () => {
  const k = mk("kalshi:A", "kalshi", 0.2, 0.81);
  const g = mk("gemini:B", "gemini", 0.3, 0.71);
  const q = await sizeQuote({
    legs: [leg("r1", k.id), leg("r2", g.id)], risks: [risk("r1", 1001), risk("r2", 300)],
    contracts: new Map([[k.id, k], [g.id, g]]), coveragePct: 50, budgetUsd: 10_000, fetchBooks: false,
  });
  assert.equal(q.lines.length, 2);
  const [a, b] = q.lines;
  assert.equal(a.contracts, 501); // ceil(0.5 * 1001)
  assert.equal(a.payoutUsd, 501);
  assert.equal(a.premiumUsd, 100.2);
  assert.equal(a.action, "buy-onchain");
  assert.equal(a.impliedProb, 0.2);
  assert.equal(b.contracts, 150);
  assert.equal(b.action, "open-on-gemini");
  assert.equal(q.totalPremiumUsd, 145.2);
  assert.equal(q.totalPayoutUsd, 651);
  assert.deepEqual(q.uncovered, []);
});

test("sizeQuote: walks the book, caps by depth (maxCoverable) and slippage", async () => {
  const c = mk("kalshi:D", "kalshi", 0.2, 0.8);
  const books = new Map([[c.id, { yes: [{ price: 0.2, size: 50 }, { price: 0.25, size: 30 }, { price: 0.5, size: 1000 }], no: [] }]]);
  const q = await sizeQuote({ legs: [leg("r1", c.id)], risks: [risk("r1", 200)], contracts: new Map([[c.id, c]]), coveragePct: 100, budgetUsd: 1000, books, fetchBooks: false });
  const l = q.lines[0];
  assert.equal(l.contracts, 80);               // 0.50 level is beyond ask + 0.10 slippage
  assert.equal(l.maxCoverable, 80);
  assert.equal(l.premiumUsd, 17.5);            // 50*0.2 + 30*0.25
  assert.equal(l.pricePerContract, 0.2188);
  // depth from the contract when no book
  const d = mk("kalshi:E", "kalshi", 0.1, 0.9, { depthYes: 40 });
  const q2 = await sizeQuote({ legs: [leg("r1", d.id)], risks: [risk("r1", 100)], contracts: new Map([[d.id, d]]), coveragePct: 100, budgetUsd: 1000, fetchBooks: false });
  assert.equal(q2.lines[0].contracts, 40);
  assert.equal(q2.lines[0].maxCoverable, 40);
});

test("sizeQuote: rejection rules", async () => {
  const exp = mk("kalshi:X", "kalshi", 0.9, 0.11);
  const noAsk = mk("gemini:Y", "gemini", null, 0.5);
  const closed = mk("kalshi:Z", "kalshi", 0.2, 0.8, { status: "settled" });
  const q = await sizeQuote({
    legs: [leg("r1", exp.id), leg("r1", noAsk.id), leg("r1", closed.id), leg("r1", "kalshi:missing"), leg("rX", exp.id)],
    risks: [risk("r1", 100)], contracts: new Map([[exp.id, exp], [noAsk.id, noAsk], [closed.id, closed]]),
    coveragePct: 100, budgetUsd: 1000, fetchBooks: false,
  });
  assert.equal(q.lines.length, 0);
  assert.equal(q.uncovered.length, 5);
  assert.match(q.uncovered[0].reason, /too expensive to be insurance/);
  assert.match(q.uncovered[1].reason, /no ask/);
  assert.match(q.uncovered[2].reason, /settled/);
  assert.match(q.uncovered[3].reason, /not found/);
  assert.match(q.uncovered[4].reason, /unknown risk/);
  // NO side of the same expensive market is fine (0.11 <= 0.85)
  const q2 = await sizeQuote({ legs: [leg("r1", exp.id, "no")], risks: [risk("r1", 100)], contracts: new Map([[exp.id, exp]]), coveragePct: 100, budgetUsd: 1000, fetchBooks: false });
  assert.equal(q2.lines[0].premiumUsd, 11);
  assert.ok(MAX_INSURANCE_ASK === 0.85);
});

test("sizeQuote: budget keeps best payout-per-premium, scales the marginal line, drops the rest", async () => {
  const cheap = mk("kalshi:C1", "kalshi", 0.1, 0.9);   // 10x
  const mid = mk("kalshi:C2", "kalshi", 0.25, 0.75);   // 4x
  const dear = mk("gemini:C3", "gemini", 0.5, 0.5);    // 2x
  const contracts = new Map([[cheap.id, cheap], [mid.id, mid], [dear.id, dear]]);
  const q = await sizeQuote({
    legs: [leg("r3", dear.id), leg("r2", mid.id), leg("r1", cheap.id)],
    risks: [risk("r1", 100), risk("r2", 100), risk("r3", 100)],
    contracts, coveragePct: 100, budgetUsd: 30, fetchBooks: false,
  });
  // cheap: 100 x 0.10 = $10 (kept); mid: 100 x 0.25 = $25 > $20 left -> scaled to 80; dear dropped
  assert.equal(q.totalPremiumUsd, 30);
  const byId = new Map(q.lines.map((l) => [l.contractId, l]));
  assert.equal(byId.get(cheap.id)!.contracts, 100);
  assert.equal(byId.get(mid.id)!.contracts, 80);
  assert.ok(!byId.has(dear.id));
  assert.equal(q.totalPayoutUsd, 180);
  assert.ok(q.uncovered.some((u) => u.riskId === "r2" && /scaled/.test(u.reason)));
  assert.ok(q.uncovered.some((u) => u.riskId === "r3" && /over budget/.test(u.reason)));
  // original leg order preserved for kept lines
  assert.deepEqual(q.lines.map((l) => l.riskId), ["r2", "r1"]);
});
