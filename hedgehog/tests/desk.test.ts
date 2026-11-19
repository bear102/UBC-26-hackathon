// "Sold on Solana, hedged on Gemini" + Polymarket read-only source (offline: recorded fixtures, temp .data dir).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeGeminiEvents } from "../lib/markets/normalize";
import { actionFor, sizeQuote } from "../lib/markets/quote";
import { geminiUsable, preferGemini, slotKey, TEAMS, KALSHI_DUP_PENALTY } from "../lib/markets";
import { crossCheckLine, normalizePolymarkets, polyBounds, POLY_SOURCES, type PMarket } from "../lib/markets/polymarket";
import { backOnGemini, hedgeText, listHedges, planBacking } from "../lib/venue/geminiHedge";
import type { GEvent } from "../lib/markets/geminiPm";
import type { HedgeLeg, MarketContract, Risk } from "../lib/types";

const fx = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8"));
// store writes to <cwd>/.data: run this file in a throwaway dir
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-desk-"));
process.chdir(tmp);

const mk = (id: string, venue: MarketContract["venue"], yesAsk: number | null, noAsk: number | null, extra: Partial<MarketContract> = {}): MarketContract => ({
  id, venue, eventTitle: "Highest temperature in Austin on November 20, 2026?", label: id, symbol: id.split(":")[1], eventTicker: "e",
  peril: "heat", location: "Austin", expiry: "2099-11-21T05:00:00Z",
  yesAsk, yesBid: yesAsk === null ? null : yesAsk - 0.02, noAsk, noBid: noAsk === null ? null : noAsk - 0.02,
  tradable: venue !== "polymarket", status: "open", resolution: null, ...extra,
});

// ---------- action mapping ----------

test("actionFor: all 3 venues are coverable (best price wins), non-tradable Gemini keeps the deep link", () => {
  assert.equal(actionFor(mk("gemini:G", "gemini", 0.1, 0.9)), "buy-onchain");
  assert.equal(actionFor(mk("kalshi:K", "kalshi", 0.1, 0.9)), "buy-onchain");
  assert.equal(actionFor(mk("gemini:G", "gemini", 0.1, 0.9, { tradable: false })), "open-on-gemini");
  assert.equal(actionFor(mk("polymarket:P", "polymarket", 0.1, 0.9)), "buy-onchain");
  assert.equal(actionFor(mk("polymarket:P", "polymarket", 0.1, 0.9, { status: "closed" })), "read-only");
});

test("normalizeGeminiEvents: Gemini contracts are tradable (devnet tokens) and keep their Gemini deep link", () => {
  const cs = normalizeGeminiEvents([fx("gemini-event-nba-nop-sas.json") as GEvent]);
  assert.ok(cs.length === 2 && cs.every((c) => c.tradable && c.url?.startsWith("https://www.gemini.com/predictions/")));
});

// ---------- ranking ----------

test("preferGemini: a usable Gemini contract pushes Kalshi down in the same peril/day/city slot only", () => {
  const g = mk("gemini:GEMI-WXHIGH-AUS-X", "gemini", 0.2, 0.82);
  const k = mk("kalshi:KXHIGHAUS-X", "kalshi", 0.18, 0.84);
  const kOther = mk("kalshi:KXHIGHAUS-Y", "kalshi", 0.18, 0.84, { expiry: "2099-11-25T05:00:00Z" }); // another day
  assert.equal(slotKey(g), slotKey(k));
  assert.notEqual(slotKey(g), slotKey(kOther));
  const scored = preferGemini([{ c: g, s: 5 }, { c: k, s: 5.5 }, { c: kOther, s: 5.5 }]);
  assert.equal(scored[1].s, 5.5 - KALSHI_DUP_PENALTY);
  assert.equal(scored[2].s, 5.5);
});

test("preferGemini: Kalshi stays on top when Gemini is missing an ask, too dear (>0.85) or thin", () => {
  const k = () => ({ c: mk("kalshi:K", "kalshi", 0.2, 0.8), s: 5 });
  for (const g of [
    mk("gemini:G1", "gemini", null, null),
    mk("gemini:G2", "gemini", 0.9, 0.95),
    mk("gemini:G3", "gemini", 0.2, null, { depthYes: 2 }),
  ]) {
    assert.equal(geminiUsable(g), false, g.id);
    const out = preferGemini([{ c: g, s: 5 }, k()]);
    assert.equal(out[1].s, 5, g.id);
  }
});

// ---------- sizing with a read-only line ----------

test("sizeQuote: read-only (closed) lines are sized for context but never spend the budget", async () => {
  const k = mk("kalshi:K", "kalshi", 0.2, 0.8);
  const p = mk("kalshi:K2", "kalshi", 0.1, 0.9, { peril: "fed", tradable: false }); // open but not coverable -> context only
  const risks: Risk[] = [{ id: "r1", peril: "heat", title: "h", trigger: "x", lossUsd: 100, lossReasoning: "", confidence: 0.5 }, { id: "r2", peril: "fed", title: "f", trigger: "x", lossUsd: 100, lossReasoning: "", confidence: 0.5 }];
  const legs: HedgeLeg[] = [{ riskId: "r1", contractId: k.id, side: "yes", rationale: "", basisRisk: "" }, { riskId: "r2", contractId: p.id, side: "yes", rationale: "", basisRisk: "" }];
  const q = await sizeQuote({ legs, risks, contracts: new Map([[k.id, k], [p.id, p]]), coveragePct: 100, budgetUsd: 20, fetchBooks: false });
  assert.equal(q.lines.length, 2);
  assert.equal(q.totalPremiumUsd, 20);           // only the Kalshi line
  assert.equal(q.totalPayoutUsd, 100);
  assert.equal(q.lines.find((l) => l.contractId === p.id)!.action, "read-only");
});

// ---------- backing order ----------

test("planBacking: same symbol/outcome, qty = contracts sold, limit = ask + 2c rounded up, capped at 0.99", () => {
  const g = mk("gemini:GEMI-WXHIGH-AUS-26NOV20-HI78", "gemini", 0.13, 0.885);
  assert.deepEqual(planBacking(g, "yes", 5), { symbol: "GEMI-WXHIGH-AUS-26NOV20-HI78", outcome: "yes", quantity: 5, limitPrice: 0.15, refAsk: 0.13, notionalUsd: 0.75 });
  const no = planBacking(g, "no", 12.7);
  assert.equal(no.quantity, 12);
  assert.equal(no.limitPrice, 0.91);              // 0.885 + 0.02 = 0.905 -> 0.91
  assert.equal(no.notionalUsd, 10.92);
  assert.equal(planBacking(mk("gemini:X", "gemini", 0.98, 0.03), "yes", 1).limitPrice, 0.99);
  assert.equal(planBacking(mk("kalshi:K", "kalshi", 0.1, 0.9), "yes", 1).limitPrice, 0.12); // any venue can be planned (best price)
  assert.throws(() => planBacking(mk("gemini:G", "gemini", null, 0.9), "yes", 1), /no YES ask/);
  assert.throws(() => planBacking(mk("gemini:G", "gemini", 0.1, 0.9, { status: "settled" }), "yes", 1), /settled/);
  assert.equal(hedgeText({ mode: "dry-run", status: "dry-run", quantity: 5, outcome: "yes", symbol: "GEMI-X", limitPrice: 0.13 }), "Desk hedge on Gemini (dry-run): BUY 5 YES GEMI-X @ $0.13");
});

test("backOnGemini: dry-run by default, recorded once per sale, feed line; records non-Gemini as dry-run plans", async () => {
  delete process.env.HEDGE_LIVE;
  const g = mk("gemini:GEMI-A", "gemini", 0.13, 0.88);
  let placed = 0;
  const place = async () => { placed++; return { orderId: 1, filledQuantity: "5" }; };
  const h = await backOnGemini({ kind: "position", refId: "pos_1", contract: g, outcome: "yes", quantity: 5, owner: "OWNER", soldForUsd: 0.65 }, { place });
  assert.ok(h);
  assert.equal(h.mode, "dry-run");
  assert.equal(h.status, "dry-run");
  assert.equal(h.notionalUsd, 0.75);
  assert.equal(h.marginUsd, -0.1);
  assert.equal(placed, 0);
  const again = await backOnGemini({ kind: "position", refId: "pos_1", contract: g, outcome: "yes", quantity: 99 }, { place });
  assert.equal(again!.quantity, 5);               // idempotent
  const kh = await backOnGemini({ kind: "position", refId: "pos_2", contract: mk("kalshi:K", "kalshi", 0.1, 0.9), outcome: "yes", quantity: 5 });
  assert.equal(kh?.venue, "kalshi");
  assert.equal(kh?.mode, "dry-run"); // non-Gemini backing is recorded, never placed
  assert.equal(listHedges("OWNER").length, 1);
  const feed = JSON.parse(fs.readFileSync(path.join(tmp, ".data", "feed.json"), "utf8"));
  assert.ok(feed.some((e: { text: string }) => e.text === "Desk hedge on Gemini (dry-run): BUY 5 YES GEMI-A @ $0.15"));
  // unpriceable backing is recorded as an error, not silently skipped
  const bad = await backOnGemini({ kind: "policy", refId: "pda_x", contract: mk("gemini:GEMI-B", "gemini", null, null), outcome: "yes", quantity: 3 });
  assert.equal(bad!.status, "error");
});

test("backOnGemini: live only with HEDGE_LIVE=1 AND both trade keys (order fn injected; no network)", async () => {
  const g = mk("gemini:GEMI-L", "gemini", 0.2, 0.8);
  const calls: unknown[] = [];
  const place = async (p: unknown) => { calls.push(p); return { orderId: "77", filledQuantity: "3", status: "filled" }; };
  process.env.HEDGE_LIVE = "1";
  delete process.env.GEMINI_TRADE_KEY; delete process.env.GEMINI_TRADE_SECRET;
  const noKeys = await backOnGemini({ kind: "position", refId: "pos_l1", contract: g, outcome: "yes", quantity: 3 }, { place });
  assert.equal(noKeys!.mode, "dry-run");
  process.env.GEMINI_TRADE_KEY = "test-key"; process.env.GEMINI_TRADE_SECRET = "test-secret";
  try {
    const live = await backOnGemini({ kind: "position", refId: "pos_l2", contract: g, outcome: "yes", quantity: 3 }, { place });
    assert.equal(live!.mode, "live");
    assert.equal(live!.status, "filled");
    assert.equal(live!.orderId, "77");
    assert.equal(calls.length, 1);
  } finally {
    delete process.env.HEDGE_LIVE; delete process.env.GEMINI_TRADE_KEY; delete process.env.GEMINI_TRADE_SECRET;
  }
});

// ---------- Polymarket ----------

const poly = () => {
  const rows = fx("polymarket-markets.json") as PMarket[];
  const src = (k: string) => POLY_SOURCES.find((s) => s.key === k)!;
  return [
    ...normalizePolymarkets(rows.filter((r) => r.slug.startsWith("nba-")), src("nba")),
    ...normalizePolymarkets(rows.filter((r) => !r.slug.startsWith("nba-") && !/fed/.test(r.slug)), src("inflation")),
    ...normalizePolymarkets(rows.filter((r) => /fed/.test(r.slug)), src("fed")),
  ];
};

test("normalizePolymarkets: recorded Gamma rows -> read-only MarketContracts", () => {
  const cs = poly();
  const game = cs.find((c) => c.id === "polymarket:nba-nop-sas-2026-11-21")!;
  assert.equal(game.venue, "polymarket");
  assert.equal(game.tradable, false);
  assert.equal(game.peril, "game");
  assert.equal(game.label, "Pelicans");              // YES = outcomes[0] wins
  assert.ok(game.yesAsk! > 0 && game.yesAsk! < 1);
  assert.equal(game.url, "https://polymarket.com/event/nba-nop-sas-2026-11-21");
  const gas = cs.find((c) => c.peril === "gas" && /4pt00/.test(c.id))!;
  assert.equal(gas.location, "US");
  assert.equal(gas.label, "↑ $4.00");
  assert.ok(!cs.some((c) => /china/.test(c.id)));    // non-US CPI dropped
  assert.ok(cs.some((c) => c.peril === "fed"));
  assert.deepEqual(polyBounds("↑ $4.45"), { lo: 4.45, loInclusive: true, hiInclusive: false, unit: "$", text: "≥$4.45" });
  assert.equal(polyBounds("↓ 3.0%")!.hi, 3);
  assert.equal(polyBounds("December 31"), undefined);
  assert.deepEqual(normalizePolymarkets([{ id: "x" } as PMarket, null as unknown as PMarket]), []); // junk-tolerant
});

test("crossCheckLine: Gemini Spurs line vs Polymarket 'Pelicans vs. Spurs' (nickname -> city alias)", () => {
  const ps = poly();
  const gm = normalizeGeminiEvents([fx("gemini-event-nba-nop-sas.json") as GEvent]);
  const sas = gm.find((c) => c.label === "San Antonio")!;
  const nop = gm.find((c) => c.label === "New Orleans")!;
  const aliases = TEAMS.map(({ re, names }) => ({ re, names }));
  const pm = ps.find((c) => c.id === "polymarket:nba-nop-sas-2026-11-21")!;
  const pPelicans = (pm.yesAsk! + pm.yesBid!) / 2;
  // NO on San Antonio = Spurs lose = Pelicans win
  const a = crossCheckLine({ contract: sas, side: "no", impliedProb: sas.noAsk! }, ps, aliases)!;
  assert.equal(a.contractId, pm.id);
  assert.ok(Math.abs(a.prob - pPelicans) < 0.001);
  assert.equal(a.exact, true);
  assert.equal(a.diffPts, Math.round((sas.noAsk! - a.prob) * 100));
  // YES on New Orleans: matched through the opponent (Spurs), same probability
  const b = crossCheckLine({ contract: nop, side: "yes", impliedProb: nop.yesAsk! }, ps, aliases)!;
  assert.ok(Math.abs(b.prob - pPelicans) < 0.001);
  // nothing for Austin weather (Polymarket has no Austin market)
  assert.equal(crossCheckLine({ contract: mk("gemini:W", "gemini", 0.1, 0.9), side: "yes", impliedProb: 0.1 }, ps, aliases), null);
});

// ---------- venue routing ----------

test("routeToGemini: a Kalshi pick moves to the identical Gemini contract unless Kalshi is clearly cheaper", async () => {
  const { routeToGemini, sameContract } = await import("../lib/markets/quote");
  const gm = normalizeGeminiEvents([fx("gemini-event-nba-nop-sas.json") as GEvent]);
  const gNop = gm.find((c) => c.label === "New Orleans")!;           // YES ask 0.12
  // a Kalshi twin of the same game (same day, same teams), built from the Gemini one
  const { setMeta, contractMeta } = await import("../lib/markets/normalize");
  const twin = (id: string, yesAsk: number): MarketContract => {
    setMeta(id, { ...contractMeta(gNop.id)!, teams: ["New Orleans"], opponents: ["San Antonio"], source: "kalshi-public" });
    return { ...gNop, id, venue: "kalshi", symbol: id.slice(7), yesAsk, url: "https://kalshi.com" };
  };
  const kDear = twin("kalshi:KXNBAGAME-26NOV21NOPSAS-NOP", 0.13);
  assert.ok(sameContract(kDear, gNop));
  const leg = { riskId: "r1", contractId: kDear.id, side: "yes" as const, rationale: "Pays if the Spurs lose.", basisRisk: "" };
  const routed = routeToGemini([leg], new Map([[kDear.id, kDear], [gNop.id, gNop]]));
  assert.equal(routed[0].contractId, gNop.id);
  assert.match(routed[0].rationale, /Routed to the identical Gemini contract at 12¢ vs Kalshi 13¢/);
  const kCheap = twin("kalshi:KXNBAGAME-26NOV21NOPSAS-NOP2", 0.08);  // Kalshi clearly better -> stays
  assert.equal(routeToGemini([{ ...leg, contractId: kCheap.id }], new Map([[kCheap.id, kCheap], [gNop.id, gNop]]))[0].contractId, kCheap.id);
  // other team / other side of the book never matches
  const gSas = gm.find((c) => c.label === "San Antonio")!;
  assert.equal(sameContract(kDear, gSas), false);
});

test("routeToBest: re-points a leg to the cheapest identical contract across venues (ties → Gemini)", async () => {
  const { routeToBest } = await import("../lib/markets/quote");
  const { setMeta } = await import("../lib/markets/normalize");
  const mkG = (id: string, venue: "gemini" | "kalshi" | "polymarket", ask: number) => {
    const c = mk(id, venue, ask, 1 - ask + 0.02, { peril: "heat", location: "Austin" });
    setMeta(id, { eventDate: "2026-11-21", bounds: { lo: 80, loInclusive: true, hiInclusive: false, text: "≥80" } });
    return c;
  };
  const g = mkG("gemini:G80", "gemini", 0.30), k = mkG("kalshi:K80", "kalshi", 0.25), p = mkG("polymarket:P80", "polymarket", 0.22);
  const contracts = new Map([[g.id, g], [k.id, k], [p.id, p]]);
  const [leg] = routeToBest([{ riskId: "r1", contractId: g.id, side: "yes", rationale: "", basisRisk: "" }], contracts);
  assert.equal(leg.contractId, p.id);
  assert.match(leg.rationale, /Best price: polymarket 22¢/);
  const tie = mkG("polymarket:P80b", "polymarket", 0.30);
  const [kept] = routeToBest([{ riskId: "r1", contractId: g.id, side: "yes", rationale: "", basisRisk: "" }], new Map([[g.id, g], [tie.id, tie]]));
  assert.equal(kept.contractId, g.id); // tie goes to Gemini
});
