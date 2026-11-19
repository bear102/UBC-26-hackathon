// Hedgehog parametric cover: pricing math, ids, seasonal estimator, settlement oracles on saved real responses,
// offline contract generation for Austin (cache seeded from fixtures), dev override, routing and cover-buy checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// isolate the parametric disk cache + overrides file BEFORE anything reads them
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hh-param-"));
process.env.HH_DATA_DIR = TMP;

const { priceFromProb, probFromEpisodes, parametricId, parseParametricId, milesBetween, MAX_PRICE, MIN_PRICE } = await import("../lib/markets/parametric/common");
const { seasonalStats } = await import("../lib/markets/parametric/history");
const src = await import("../lib/markets/parametric/sources");
const { floodHit, aqiHit, hailHit, overrideFor } = await import("../lib/markets/parametric/settle");
const { listParametric, getParametric, parametricMeta } = await import("../lib/markets/parametric/index");
const { routeToBest, isCoverable, actionFor } = await import("../lib/markets/quote");
const { rankCandidates } = await import("../lib/markets/index");
const { priceBuy } = await import("../lib/venue/pricing");
const { PERIL_CODES } = await import("../lib/solana/policyClient");
const { ALL_PERILS } = await import("../lib/types");
import type { BusinessProfile, HedgeLeg, MarketContract, Risk } from "../lib/types";

const fx = (f: string) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const fxj = (f: string) => JSON.parse(fx(f));

// ---------- pricing ----------

test("price = clamp(p × 1.25 + 1¢, 2¢, 85¢); NO = 1 − p + load", () => {
  assert.deepEqual(priceFromProb(0.1), { yesAsk: 0.14, noAsk: 0.94 });   // 0.125 + 0.01 = 0.135 -> 14¢; NO 0.9 + 0.025 + 0.01 -> 94¢ (cents up)
  assert.equal(priceFromProb(0).yesAsk, MIN_PRICE);
  assert.equal(priceFromProb(0.0067).yesAsk, 0.02);
  assert.equal(priceFromProb(0.4).yesAsk, 0.51);
  assert.equal(priceFromProb(0.9).yesAsk, MAX_PRICE);
  assert.ok(priceFromProb(0.05).noAsk > 0.85, "NO side is not insurance for a rare event");
  for (const p of [0.01, 0.05, 0.2, 0.5]) assert.ok(priceFromProb(p).yesAsk >= p * 1.25, "always loaded above the expected payout");
});

test("episode-rate probability: smoothed, never zero, grows with window length", () => {
  const a = probFromEpisodes(0, 600, 7), b = probFromEpisodes(0, 600, 30), c = probFromEpisodes(6, 600, 30);
  assert.ok(a.p > 0 && a.p < b.p && b.p < c.p);
  assert.ok(Math.abs(c.q - 6.5 / 601) < 1e-12);
  assert.ok(Math.abs(c.p - (1 - Math.pow(1 - 6.5 / 601, 30))) < 1e-12);
});

// ---------- ids ----------

test("ids round-trip and fit the 64-byte marketRef", () => {
  const specs = [
    { kind: "flood" as const, place: "08159000", start: "2026-11-19", end: "2026-12-18" },
    { kind: "aqi" as const, place: "austin-tx", start: "2026-11-19", end: "2026-11-25" },
    { kind: "hail" as const, place: "austin-tx", radiusMi: 25, start: "2026-11-19", end: "2026-12-18" },
    { kind: "wildfire" as const, place: "salt-lake-city-ut", radiusMi: 30, start: "2026-11-19", end: "2026-12-18" },
  ];
  for (const s of specs) {
    const id = parametricId(s);
    assert.ok(Buffer.byteLength(id) <= 64, id);
    assert.deepEqual(parseParametricId(id), s);
  }
  assert.equal(parametricId(specs[2]), "hedgehog:hail:austin-tx:25:20261119-20261218");
  for (const bad of ["hedgehog:flood:abc:20261119-20261218", "hedgehog:hail:austin-tx:20261119-20261218", "hedgehog:aqi:austin-tx:20261219-20261118", "gemini:x", "hedgehog:tornado:x:20261119-20261120"])
    assert.equal(parseParametricId(bad), null, bad);
});

// ---------- seasonal estimator ----------

test("seasonalStats: band days, episodes (runs count once), exact-window year hits", () => {
  const ev = new Set(["2020-11-20", "2020-11-21", "2020-11-22", "2023-12-01"]); // one 3-day event + one in the band but outside the window
  const s = seasonalStats({ isEvent: (d) => ev.has(d), observed: () => true, start: "2026-11-19", end: "2026-11-25", firstYear: 2016, lastYear: 2025, today: "2026-11-19" });
  assert.equal(s.windowDays, 7);
  assert.equal(s.eventDays, 4);
  assert.equal(s.episodes, 2);
  assert.equal(s.years, 10);
  assert.equal(s.yearsHit, 1);
  assert.equal(s.observedDays, 10 * 37);
  assert.ok(s.p > 0.02 && s.p < 0.08, String(s.p));
});

// ---------- settlement oracles on saved real responses ----------

test("flood oracle: USGS daily max + instantaneous values vs NWS flood stage (Onion Creek, Oct 30 2015)", () => {
  const g = src.parseNwpsGauge(fxj("parametric-nwps-ATIT2.json"))!;
  assert.equal(g.usgsId, "08159000");
  assert.equal(g.floodStage, 17);
  assert.equal(g.lid, "ATIT2");
  const dv = src.parseUsgsDv(fxj("parametric-usgs-dv-08159000.json"));
  assert.equal(dv["2015-10-30"], 39.33);
  assert.deepEqual(floodHit(dv, g.floodStage, "2015-10-25", "2015-10-29"), { hit: false, on: undefined, peak: 8.73 });
  assert.equal(floodHit(dv, g.floodStage, "2015-10-25", "2015-11-05").on, "2015-10-30");
  const iv = src.parseUsgsIv(fxj("parametric-usgs-iv-08159000.json"));
  assert.equal(iv["2015-10-30"], 39.33);
  assert.equal(floodHit(iv, g.floodStage, "2015-10-30", "2015-10-31").hit, true);
});

test("AQI oracle: Open-Meteo hourly US AQI -> daily max (Los Angeles fires, Jan 2025)", () => {
  const d = src.parseOpenMeteoAqi(fxj("parametric-openmeteo-aqi-la-2025-01.json"));
  const days = Object.keys(d).sort();
  assert.equal(days[0], "2025-01-07");
  assert.equal(Math.max(...Object.values(d)), 227);
  const r = aqiHit(d, "2025-01-07", "2025-01-12");
  assert.equal(r.hit, true);
  assert.ok(r.on && d[r.on] > 150);
  assert.equal(aqiHit(d, "2025-01-07", "2025-01-12", 300).hit, false);
});

test("hail oracle: SPC daily reports (Nov 1 2025) within radius, >= 1 inch", () => {
  const reps = src.parseSpcDailyCsv(fx("parametric-spc-251101-hail.csv"));
  assert.ok(reps.length >= 5);
  assert.deepEqual(reps[0], [29.58, -97.94, 1]);                 // 1.00" at Seguin, TX
  const seguin = hailHit(reps, 29.5688, -97.9647, 25);
  assert.equal(seguin.hit, true);
  assert.equal(hailHit(reps, 30.2672, -97.7431, 25).hit, false); // Austin is ~50 mi away
  assert.equal(hailHit(reps, 29.5688, -97.9647, 25, 3).hit, false);
  const year = src.parseSpcYearCsv(fx("parametric-spc-2024-hail-head.csv"));
  assert.ok(year.length > 50 && year.every((r) => r[3] >= 1 && /^2024-\d\d-\d\d$/.test(r[0])));
  assert.deepEqual(year[0], ["2024-01-08", 30.125, -93.216, 2]);
});

test("wildfire oracle: NIFC incidents >= 100 acres within 30 mi of Austin", () => {
  const fires = src.parseNifc(fxj("parametric-nifc-austin-30mi-100ac.json"));
  assert.ok(fires.length >= 9);
  assert.ok(fires.every((f) => f.acres >= 100 && /^\d{4}-\d\d-\d\d$/.test(f.date)));
  assert.ok(fires.some((f) => f.name === "Onion Creek" && f.date.startsWith("2025-03")));
  assert.ok(Math.abs(milesBetween(30.2672, -97.7431, 29.4241, -98.4936) - 74) < 3); // Austin -> San Antonio
});

// ---------- offline generation for Austin (cache seeded from fixtures) ----------

function seed(key: string, v: unknown) {
  const dir = path.join(TMP, "parametric-cache");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ t: Date.now(), v }));
}
const NOW = new Date("2026-11-19T18:00:00Z");

test("Austin: flood (Onion Creek gauge), AQI, hail, wildfire contracts with prices and cited history", async () => {
  // flood: 20 years of daily max stage around Nov with one 2015-style flood; gauge from the NWPS fixture
  const hist: Record<string, number> = {};
  for (let y = 2006; y <= 2025; y++) for (let d = new Date(`${y}-10-15T12:00:00Z`); d <= new Date(`${y + 1}-01-15T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) hist[d.toISOString().slice(0, 10)] = 5;
  Object.assign(hist, src.parseUsgsDv(fxj("parametric-usgs-dv-08159000.json")));
  hist["2015-11-25"] = 18; // a second rise inside the late-Nov window
  seed("nwps-gauge-08159000", src.parseNwpsGauge(fxj("parametric-nwps-ATIT2.json")));
  seed("usgs-dv-08159000", hist);
  // AQI: clean history since Aug 2022
  const aqi: Record<string, number> = {};
  for (let d = new Date("2022-08-01T12:00:00Z"); d < NOW; d.setUTCDate(d.getUTCDate() + 1)) aqi[d.toISOString().slice(0, 10)] = 60;
  aqi["2023-11-28"] = 162;
  seed("aqi-hist-30.27_-97.74", aqi);
  // hail: SPC archive years, one 1.75" report near Austin on Nov 22 2019
  for (let y = 2012; y <= 2025; y++) seed(`spc-hail-${y}`, y === 2019 ? [["2019-11-22", 30.3, -97.7, 1.75], ["2019-11-22", 35, -97, 2]] : []);
  // wildfire: real NIFC fixture
  seed("nifc-30.27_-97.74-30-100", src.parseNifc(fxj("parametric-nifc-austin-30mi-100ac.json")));

  const win = { start: "2026-11-19", end: "2026-12-18" };
  const cs = await listParametric(["flood", "smoke", "hail", "wildfire"], "Austin, TX", win, NOW);
  const by = Object.fromEntries(cs.map((c) => [c.peril, c]));
  assert.deepEqual(Object.keys(by).sort(), ["flood", "hail", "smoke", "wildfire"]);
  assert.equal(by.flood.id, "hedgehog:flood:08159000:20261119-20261218");
  assert.equal(by.smoke.id, "hedgehog:aqi:austin-tx:20261119-20261218");
  assert.equal(by.hail.id, "hedgehog:hail:austin-tx:25:20261119-20261218");
  assert.equal(by.wildfire.id, "hedgehog:wildfire:austin-tx:30:20261119-20261218");
  for (const c of cs) {
    assert.equal(c.venue, "hedgehog");
    assert.equal(c.status, "open");
    assert.ok(c.tradable && isCoverable(c) && actionFor(c) === "buy-onchain");
    assert.ok(c.yesAsk! >= 0.02 && c.yesAsk! <= 0.85, `${c.id} ${c.yesAsk}`);
    assert.equal(c.expiry, "2026-12-19T05:59:59.000Z");
    assert.equal(c.location, "Austin");
    const m = parametricMeta(c.id)!;
    assert.equal(m.method, "live");
    assert.ok(m.hitRate.length > 30 && /^https:\/\//.test(m.sourceUrl), m.hitRate);
    assert.equal(c.yesAsk, priceFromProb(m.prob).yesAsk);
  }
  assert.match(by.flood.eventTitle, /Onion Creek at US 183 above flood stage, Nov 19–Dec 18/);
  const fm = parametricMeta(by.flood.id)!;
  assert.match(fm.hitRate, /reached flood stage \(17 ft\) on 1 of/);
  assert.match(fm.hitRate, /In these exact dates: 1 of the last 20 years/);
  assert.equal(by.flood.url, "https://water.noaa.gov/gauges/ATIT2");
  assert.match(parametricMeta(by.hail.id)!.hitRate, /1 separate event/);
  // a flood in the seasonal band prices above a clean wildfire history for the same dates
  assert.ok(by.flood.yesAsk! >= by.wildfire.yesAsk!);
});

test("base-rate fallback when a source is unreachable is marked 'base-rate' and still priced", async () => {
  // Denver: nothing seeded for it and fetch is stubbed to fail, so the conservative table prices it
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  try {
    const cs = await listParametric(["wildfire"], "Denver, CO", { start: "2026-11-19", end: "2026-11-25" }, NOW);
    assert.equal(cs.length, 1);
    const m = parametricMeta(cs[0].id)!;
    assert.equal(m.method, "base-rate");
    assert.match(m.hitRate, /^Base rate/);
    assert.ok(cs[0].yesAsk! >= 0.02);
  } finally { globalThis.fetch = real; }
});

// ---------- dev override / settlement status ----------

test("dev override forces a resolution (env PARAMETRIC_FORCE and prefix*)", async () => {
  const id = "hedgehog:hail:austin-tx:25:20261119-20261218";
  process.env.PARAMETRIC_FORCE = "hedgehog:hail:austin-tx:*=yes";
  try {
    assert.equal(overrideFor(id), "yes");
    const c = (await getParametric(id, NOW))!;
    assert.equal(c.status, "settled");
    assert.equal(c.resolution, "yes");
    assert.match(c.label, /forced YES/);
  } finally { delete process.env.PARAMETRIC_FORCE; }
  assert.equal(overrideFor(id), null);
  const open = (await getParametric("hedgehog:hail:austin-tx:25:20261201-20261218", NOW))!; // future window: no oracle call
  assert.equal(open.status, "open");
});

// ---------- routing / candidates ----------

const real = (over: Partial<MarketContract>): MarketContract => ({
  id: "kalshi:KXRAINAUSM-26NOV-6", venue: "kalshi", eventTitle: "Rain in Austin in Nov 2026?", label: "Above 6 inches", symbol: "KXRAINAUSM-26NOV-6", eventTicker: "KXRAINAUSM-26NOV",
  peril: "rain", location: "Austin", expiry: "2026-12-01T04:59:59Z", yesAsk: 0.11, yesBid: 0.08, noAsk: 0.95, noBid: 0.89, tradable: true, status: "open", ...over,
});

test("routing never moves a leg to (or prefers) a hedgehog contract", async () => {
  const hh = (await listParametric(["flood"], "Austin, TX", { start: "2026-11-19", end: "2026-12-18" }, NOW))[0];
  const k = real({});
  const contracts = new Map([[k.id, k], [hh.id, { ...hh, yesAsk: 0.01 }]]); // even when "cheaper"
  const legs: HedgeLeg[] = [{ riskId: "r1", contractId: k.id, side: "yes", rationale: "", basisRisk: "" }, { riskId: "r2", contractId: hh.id, side: "yes", rationale: "", basisRisk: "" }];
  const out = routeToBest(legs, contracts);
  assert.equal(out[0].contractId, k.id);
  assert.equal(out[1].contractId, hh.id);
  // the market ranking never surfaces hedgehog contracts (they're appended by findCandidates only for perils with no market)
  const risk: Risk = { id: "r1", peril: "flood", title: "Creek floods", trigger: "Onion Creek above flood stage", location: "Austin", window: "next 30 days", lossUsd: 2000, lossReasoning: "x", confidence: 0.5 };
  const prof: BusinessProfile = { id: "b", name: "Creekside", description: "riverside restaurant", city: "Austin, TX", avgDailyRevenueUsd: 3000, busyDays: [], monthlyBudgetUsd: 200 };
  assert.equal(rankCandidates(risk, prof, [k, hh], 10, NOW).some((c) => c.venue === "hedgehog"), false);
});

// ---------- cover buy ----------

test("cover buy accepts a hedgehog contract: coverable, priced, new peril codes on-chain", async () => {
  const c = (await listParametric(["smoke"], "Austin, TX", { start: "2026-11-19", end: "2026-12-18" }, NOW))[0];
  assert.ok(isCoverable(c));
  const p = priceBuy({ ...c, expiry: "2099-01-01T00:00:00Z" }, "yes", 100, 6, 0);
  assert.equal(p.ask, c.yesAsk);
  assert.equal(p.costUsd, Math.round(100 * c.yesAsk! * 100) / 100);
  assert.ok(Buffer.byteLength(c.id) <= 64);
  for (const peril of ["flood", "smoke", "hail", "wildfire"] as const) assert.ok((ALL_PERILS as readonly string[]).includes(peril));
  assert.deepEqual([PERIL_CODES.flood, PERIL_CODES.smoke, PERIL_CODES.hail, PERIL_CODES.wildfire], [17, 18, 19, 20]);
  assert.equal(new Set(Object.values(PERIL_CODES)).size, Object.keys(PERIL_CODES).length);
});
