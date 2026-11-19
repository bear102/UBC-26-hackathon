// Venue expansion (2026-11-19): Kalshi winter/power/water/diesel series, Polymarket disaster events (read-only),
// Gemini Economics (Fed) + natural gas / metals perils, region-aware candidate matching. Fixtures are trimmed real responses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityFromTitle, kalshiDmyDates, normalizeKalshiEvent, seriesSpec, SERIES } from "../lib/markets/dflow";
import { normalizePolyEvents } from "../lib/markets/polymarket";
import { contractMeta, normalizeGeminiEvents, parseBounds, perilFromText } from "../lib/markets/normalize";
import { locMatches, normLoc, rankCandidates, slotKey } from "../lib/markets/index";
import { sameContract } from "../lib/markets/quote";
import { buildExplorer, groupOf } from "../lib/markets/explorer";
import { ALL_PERILS, type BusinessProfile, type MarketContract, type Risk } from "../lib/types";
import { PERIL_CODES } from "../lib/solana/policyClient";

const K = JSON.parse(readFileSync("tests/fixtures/kalshi-events-winter.json", "utf8"));
const P = JSON.parse(readFileSync("tests/fixtures/polymarket-disaster-events.json", "utf8"));
const G = JSON.parse(readFileSync("tests/fixtures/gemini-events-economics.json", "utf8"));
const kal = (s: string) => normalizeKalshiEvent(K[s], seriesSpec(s)!);
const NOW = new Date("2026-11-19T15:00:00Z");

test("parseBounds: snow inches, MW, ft, days, '+' and 'X or Y' buckets", () => {
  assert.deepEqual(parseBounds("Above 2 inches"), { lo: 2, loInclusive: false, hiInclusive: false, unit: "in", text: ">2in" });
  const mw = parseBounds("Above 91,500 MW")!;
  assert.equal(mw.lo, 91500); assert.equal(mw.unit, "MW"); assert.equal(mw.text, ">91,500 MW");
  assert.equal(parseBounds("Above 1033 Ft")!.unit, "ft");
  assert.equal(parseBounds("Above $20/MWh")!.lo, 20);
  assert.deepEqual([parseBounds("Atlanta · 0–4 days")!.lo, parseBounds("Atlanta · 0–4 days")!.hi, parseBounds("Atlanta · 0–4 days")!.unit], [0, 4, "days"]);
  assert.deepEqual([parseBounds("3.00 ft or more")!.lo, parseBounds("3.00 ft or more")!.hi], [3, undefined]);
  assert.deepEqual([parseBounds("Below -3.00 ft")!.hi, parseBounds("-3.00 to -1.01 ft")!.lo], [-3, -3]);
  assert.deepEqual([parseBounds("4,189.3 or 4,189.4 ft")!.lo, parseBounds("4,189.3 or 4,189.4 ft")!.hi], [4189.3, 4189.4]);
  assert.equal(parseBounds("1250+")!.lo, 1250);
  assert.equal(parseBounds("Below 1,250.00")!.hi, 1250);
  // old forms unchanged
  assert.equal(parseBounds("78°F or above")!.lo, 78);
  assert.equal(parseBounds("69°F or below")!.hi, 69);
  assert.equal(parseBounds("Before 2027"), null);
});

test("ticker dates and title cities", () => {
  assert.deepEqual(kalshiDmyDates("KXSNOWDAYS-01DEC26-01APR27"), ["2026-12-01", "2027-04-01"]);
  assert.deepEqual(kalshiDmyDates("KXHDDCVG-KCVG-01OCT26-31DEC26"), ["2026-10-01", "2026-12-31"]);
  assert.deepEqual(kalshiDmyDates("KXPARKCSNOW-24DEC26"), ["2026-12-24"]);
  assert.equal(cityFromTitle("Highest temperature in Atlanta on Nov 19, 2026?"), "Atlanta");
  assert.equal(cityFromTitle("Rain in NYC in Nov 2026?"), "NYC");
  assert.equal(cityFromTitle("Snow in Washington DC in Dec 2026?"), "Washington DC");
  assert.equal(cityFromTitle("How much will it rain in Napa in November 2026 through March 2027?"), "Napa");
});

test("Kalshi winter/power/water series normalize with peril, place, window and bounds", () => {
  const snow = kal("KXCHISNOWM");
  assert.ok(snow.length === 3 && snow.every((c) => c.peril === "snow" && c.location === "Chicago" && c.venue === "kalshi" && c.tradable));
  assert.deepEqual([contractMeta(snow[0].id)!.eventDate, contractMeta(snow[0].id)!.eventEnd], ["2026-12-01", "2026-12-31"]);
  assert.equal(snow[0].yesAsk, 0.76);

  const days = kal("KXSNOWDAYS");
  assert.deepEqual(days.map((c) => c.location), ["Atlanta", "Austin", "Baltimore"]);
  assert.deepEqual([contractMeta(days[1].id)!.eventDate, contractMeta(days[1].id)!.eventEnd], ["2026-12-01", "2027-04-01"]);
  assert.equal(contractMeta(days[1].id)!.bounds!.hi, 2);

  const hdd = kal("KXHDDCVG");
  assert.ok(hdd.every((c) => c.peril === "cold" && c.location === "Cincinnati")); // fixedPeril: 'Below N' HDD stays cold
  assert.equal(contractMeta(hdd[0].id)!.eventDate, "2026-10-01");

  const peak = kal("KXTXERCOTPEAK");
  assert.ok(peak.every((c) => c.peril === "power" && c.location === "Texas"));
  assert.equal(contractMeta(peak[0].id)!.eventEnd, "2027-01-01"); // closes 2027-01-01 00:29 Central

  const park = kal("KXPARKCSNOW");
  assert.deepEqual([contractMeta(park[0].id)!.eventDate, contractMeta(park[0].id)!.eventEnd], ["2026-10-21", "2026-12-24"]); // open .. "by Dec 24"
  assert.ok(kal("KXMEAD").every((c) => c.peril === "water" && c.location === "Lake Mead" && contractMeta(c.id)!.bounds!.unit === "ft"));
  assert.ok(kal("KXDIESELW").every((c) => c.peril === "gas" && c.location === undefined));
  assert.ok(kal("KXHIGHTATL").every((c) => c.location === "Atlanta" && (c.peril === "heat" || c.peril === "cold")));
  const napa = kal("KXRAINNAPAM");
  assert.deepEqual([contractMeta(napa[0].id)!.eventDate, contractMeta(napa[0].id)!.eventEnd], ["2026-11-01", "2027-03-31"]);
});

test("SERIES: no duplicates; every new peril has at least one Kalshi series", () => {
  const ids = SERIES.map((s) => s.series);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of ["snow", "power", "water", "quake", "storm"] as const) assert.ok(SERIES.some((s) => s.peril === p), p);
});

test("Polymarket disaster events: read-only, bucket bounds, place per event", () => {
  const out = normalizePolyEvents(P, undefined, NOW);
  assert.ok(out.length >= 20);
  assert.ok(out.every((c) => c.venue === "polymarket" && !c.tradable && c.status === "open"));
  const mead = out.filter((c) => c.location === "Lake Mead");
  assert.equal(mead.length, 4);
  assert.ok(mead.every((c) => c.peril === "water"));
  assert.deepEqual([contractMeta(mead[1].id)!.bounds!.lo, contractMeta(mead[1].id)!.bounds!.hi], [1033, 1038]);
  assert.ok(out.some((c) => c.location === "St. Louis" && contractMeta(c.id)!.bounds?.hi === -3));
  const la = out.find((c) => c.peril === "quake")!;
  assert.equal(la.location, "Los Angeles"); assert.equal(la.label, "M6.5+ in LA");
  const torn = out.filter((c) => c.peril === "storm");
  assert.ok(torn.length === 8 && torn.every((c) => c.location === "US"));
  assert.ok(out.some((c) => c.peril === "snow" && c.location === "New York City" && /more snow than average/i.test(c.label)));
});

test("Gemini Economics: Fed markets index as 'fed' and match Kalshi by label + decision month", () => {
  const g = normalizeGeminiEvents(G);
  const fed = g.filter((c) => c.peril === "fed");
  assert.ok(fed.length >= 3);
  assert.ok(g.some((c) => /unemployment/i.test(c.eventTitle) && c.peril === "other"));
  const k: MarketContract = { ...fed[0], id: "kalshi:KXFEDDECISION-26DEC-H25", venue: "kalshi", symbol: "KXFEDDECISION-26DEC-H25", eventTicker: "KXFEDDECISION-26DEC", expiry: "2026-12-09T18:59:00Z" };
  assert.equal(slotKey(k).split("|")[1], slotKey(fed[0]).split("|")[1]); // same month even though the venues close days apart
  assert.ok(sameContract(k, fed[0]));
  assert.ok(!sameContract({ ...k, label: "Cut 25bps" }, fed[0]));
});

test("perils: text mapping, explorer groups, on-chain codes cover every peril", () => {
  assert.equal(perilFromText("Snow in Chicago in Dec 2026?"), "snow");
  assert.equal(perilFromText("ERCOT North Hub average real-time power price"), "power");
  assert.equal(perilFromText("Lake Mead end-of-month water elevation"), "water");
  assert.equal(perilFromText("Magnitude 6.5+ earthquake in LA"), "quake");
  assert.equal(perilFromText("How many tornadoes in the US"), "storm");
  assert.equal(perilFromText("Natural Gas price on November 19?"), "natgas");
  assert.equal(perilFromText("Copper price on November 19?"), "metals");
  assert.equal(perilFromText("Diesel prices this week"), "gas");
  assert.deepEqual([groupOf("snow"), groupOf("power"), groupOf("water"), groupOf("quake"), groupOf("natgas")], ["snow", "power", "disaster", "disaster", "commodities"]);
  const codes = ALL_PERILS.map((p) => PERIL_CODES[p]);
  assert.equal(new Set(codes).size, ALL_PERILS.length);
});

test("regions: ERCOT covers Austin, Lake Mead covers Las Vegas; snow ranks for Chicago only", () => {
  assert.ok(locMatches("Texas", "austin"));
  assert.ok(locMatches("Lake Mead", "las vegas"));
  assert.ok(!locMatches("Texas", "chicago"));
  assert.equal(normLoc("Dallas–Fort Worth"), "dallas");
  const profile = (city: string): BusinessProfile => ({ id: "x", name: "x", description: "restaurant", city, avgDailyRevenueUsd: 3000, busyDays: [], monthlyBudgetUsd: 300 });
  const power: Risk = { id: "r1", peril: "power", title: "Power price spike", trigger: "ERCOT above $35/MWh", window: "this month", lossUsd: 200, lossReasoning: "", confidence: 0.4 };
  const universe = [...kal("KXTXERCOTPEAK"), ...kal("KXCHISNOWM")];
  assert.ok(rankCandidates(power, profile("Austin, TX"), universe, 10, NOW).length > 0);
  assert.equal(rankCandidates(power, profile("Chicago, IL"), universe, 10, NOW).length, 0);
  const snow: Risk = { id: "r2", peril: "snow", title: "Snowy December", trigger: "Chicago snow above 6 inches in December", window: "December", lossUsd: 900, lossReasoning: "", confidence: 0.5 };
  assert.ok(rankCandidates(snow, profile("Chicago, IL"), universe, 10, NOW).every((c) => c.location === "Chicago"));
  assert.equal(rankCandidates(snow, profile("Austin, TX"), universe, 10, NOW).length, 0);
});

test("explorer: new groups get events with places", () => {
  const ms = [...kal("KXCHISNOWM"), ...kal("KXMEAD"), ...normalizePolyEvents(P, undefined, NOW)];
  const ex = buildExplorer(ms, NOW.getTime());
  assert.ok(ex.events.some((e) => e.group === "snow" && e.place === "Chicago"));
  assert.ok(ex.events.some((e) => e.group === "disaster" && e.place === "Lake Mead"));
  assert.ok(ex.places.includes("Chicago") && ex.places.includes("Lake Mead"));
});
