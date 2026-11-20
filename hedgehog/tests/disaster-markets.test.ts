// Real disaster / weather markets (Polymarket + Kalshi) and the "real markets only" default (no Hedgehog parametric).
// Fixtures are saved real responses from 2026-11-19: Gamma /events (slimmed to the fields we read) and Kalshi /events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyPolyEvent, disasterBounds, dynamicDisasterSlugs, normalizePolyEvents, placeFromGroup, titleWindow } from "../lib/markets/polymarket";
import { normalizeKalshiEvent, seriesSpec } from "../lib/markets/dflow";
import { contractMeta } from "../lib/markets/normalize";
import { findCandidates, rankCandidates } from "../lib/markets/index";
import { buildExplorer } from "../lib/markets/explorer";
import { noMarketReason, parametricEnabled, proxyFits, sameState, stateOf } from "../lib/markets/proxies";
import { PLAYBOOK, REJECTED } from "../lib/ai/playbook/index";
import type { BusinessProfile, MarketContract, Risk } from "../lib/types";

const NOW = new Date("2026-11-19T21:00:00Z");
const PE = JSON.parse(readFileSync("tests/fixtures/polymarket-disaster-live-2026-11-19.json", "utf8"));
const KH = JSON.parse(readFileSync("tests/fixtures/kalshi-events-hurricane.json", "utf8"));
const TORN: MarketContract[] = JSON.parse(readFileSync("tests/fixtures/parametric-playbook-markets.json", "utf8")).filter((c: MarketContract) => c.venue !== "hedgehog");
const POLY = normalizePolyEvents(PE, undefined, NOW);
const KAL = Object.entries(KH).flatMap(([s, e]) => normalizeKalshiEvent(e as never, seriesSpec(s)!));
const UNIVERSE = [...POLY, ...KAL, ...TORN];

const biz = (city: string): BusinessProfile => ({ id: "t", name: "T", description: "small business", city, avgDailyRevenueUsd: 2000, busyDays: ["Sat"], monthlyBudgetUsd: 200 });
const risk = (peril: Risk["peril"], title: string, trigger: string, window = "next 30 days"): Risk => ({ id: "r1", peril, title, trigger, window, lossUsd: 3000, lossReasoning: "", confidence: 0.6 });

test("parametric is OFF by default (HEDGEHOG_PARAMETRIC unset)", () => {
  assert.equal(process.env.HEDGEHOG_PARAMETRIC, undefined);
  assert.equal(parametricEnabled(), false);
});

test("Polymarket disaster bucket labels -> bounds", () => {
  const b = (s: string) => { const x = disasterBounds(s)!; return [x.lo, x.hi, x.unit]; };
  assert.deepEqual(b('<3"'), [undefined, 3, "in"]);
  assert.deepEqual(b('3-4.5"'), [3, 4.5, "in"]);
  assert.deepEqual(b('>7.75"'), [7.75, undefined, "in"]);
  assert.deepEqual(b("Under 10"), [undefined, 10, undefined]);
  assert.deepEqual(b("10 - 24"), [10, 24, undefined]);
  assert.deepEqual(b("60 or more"), [60, undefined, undefined]);
  assert.deepEqual(b("19.00 ft or more"), [19, undefined, "ft"]);
  assert.deepEqual(b("18.30 to 18.49 ft"), [18.3, 18.49, "ft"]);
  assert.equal(disasterBounds("Chicago, IL by November 30"), null);
});

test("classifyPolyEvent: US disaster events in, worldwide-only events out", () => {
  const c = (title: string) => classifyPolyEvent({ slug: "x", title });
  assert.deepEqual([c("US Tornadoes in November 2026")?.peril, c("US Tornadoes in November 2026")?.location], ["storm", "US"]);
  assert.equal(c("Will a hurricane make landfall in Texas by November 30, 2026?")?.location, "Texas");
  assert.ok(c("Where will a hurricane make landfall in the US during the 2026 hurricane season?")?.cityFromGroup);
  assert.equal(c("How many hurricanes will form during the Atlantic Hurricane Season in 2026?"), null);
  assert.equal(c("How many 7.0 or above earthquakes in 2026?"), null);
  assert.equal(c("Magnitude 6.5+ earthquake in LA before 2027?")?.location, "Los Angeles");
  assert.equal(c("Highest St. Johns River level at Cocoa by November 30?")?.peril, "flood");
  assert.equal(c("Highest sea level in San Diego this winter?")?.location, "San Diego");
  assert.deepEqual([c("Precipitation in NYC in November?")?.peril, c("Precipitation in NYC in November?")?.location], ["rain", "NYC"]);
  assert.equal(c("Precipitation in Hong Kong in November?"), null);
  assert.equal(c("How many large volcano eruptions (VEI ≥4) in 2026?"), null);
  assert.equal(c("Highest temperature in Paris on November 19?"), null);
  assert.equal(placeFromGroup("Chicago, IL by November 30"), "Chicago");
  assert.equal(placeFromGroup("New York, NY"), "New York");
  assert.equal(placeFromGroup("North Carolina"), "North Carolina");
  assert.equal(placeFromGroup("United States"), "US");
  assert.equal(placeFromGroup("Indonesia"), null);
});

test("titleWindow + dynamic slugs", () => {
  assert.deepEqual(titleWindow("Where will it rain on November 20?", "2026-11-19T00:00:00Z", "2026-11-19"), { start: "2026-11-20", end: "2026-11-20" });
  assert.deepEqual(titleWindow("Precipitation in NYC in November?", "2026-10-30T00:00:00Z", "2026-11-19"), { start: "2026-11-01", end: "2026-11-30" });
  assert.deepEqual(titleWindow("Highest St. Johns River level at Cocoa by November 30?", "2026-11-19T00:00:00Z", "2026-11-19"), { end: "2026-11-30" });
  const s = dynamicDisasterSlugs(NOW);
  assert.ok(s.includes("where-will-it-rain-on-november-20-2026") && s.includes("precipitation-in-nyc-in-november") && s.includes("precipitation-in-seattle-in-december"));
});

test("Polymarket disaster fixture: US perils, places, windows; non-US / empty books skipped", () => {
  assert.ok(POLY.length >= 50, `got ${POLY.length}`);
  assert.ok(POLY.every((c) => c.venue === "polymarket" && c.status === "open" && (c.yesAsk !== null || c.yesBid !== null)));
  const by = (slug: string) => POLY.filter((c) => c.eventTicker.startsWith(slug));
  // hurricane landfall by state
  const land = by("where-will-a-hurricane-make-landfall");
  assert.ok(land.length >= 15 && land.every((c) => c.peril === "storm"));
  assert.ok(land.some((c) => c.location === "Texas") && land.some((c) => c.location === "North Carolina"));
  // quake ladder by country: non-US rows dropped; the US row has an empty book (99c ask / 1c bid) so it is skipped too
  assert.ok(by("where-will-a-6pt0").every((c) => c.location === "US"));
  // worldwide-only events are not indexed
  assert.equal(by("how-many-7pt0").length + by("how-many-hurricanes-will-form").length + by("how-many-large-volcano").length, 0);
  // monthly rain: bins with inch bounds, month window (not the Feb 2027 resolution date)
  const nyc = by("precipitation-in-nyc-in-november");
  assert.ok(nyc.length >= 5 && nyc.every((c) => c.peril === "rain" && c.location === "NYC" && contractMeta(c.id)!.eventEnd === "2026-11-30"));
  assert.ok(nyc.some((c) => contractMeta(c.id)!.bounds?.lo === 5.75 && contractMeta(c.id)!.bounds?.hi === undefined));
  // daily rain: city per row, the rain day as the window
  const rain = by("where-will-it-rain-on-november-20");
  assert.ok(rain.some((c) => c.location === "Seattle") && rain.every((c) => contractMeta(c.id)!.eventDate === "2026-11-20"));
  // flood: river gauge + sea level
  assert.ok(by("highest-st-johns").every((c) => c.peril === "flood" && c.location === "Cocoa, FL"));
  assert.ok(by("highest-sea-level").every((c) => c.peril === "flood" && c.location === "San Diego"));
  // a two-outcome market that is not Yes/No: YES = "Drier"
  const dry = by("california-winter")[0];
  assert.equal(dry.peril, "rain"); assert.equal(dry.location, "California"); assert.match(dry.label, /^Drier/);
  // first snow by city
  assert.ok(by("first-snow-2026").some((c) => c.peril === "snow" && c.location === "Dallas"));
  assert.ok(by("will-the-us-break-its-record").every((c) => c.peril === "storm" && c.location === "US"));
});

test("Kalshi hurricane landfall series: state / city places, storm peril", () => {
  assert.ok(KAL.length >= 3);
  const loc = new Set(KAL.map((c) => c.location));
  assert.ok(loc.has("Florida") && loc.has("Tampa") && loc.has("Hawaii"));
  assert.ok(KAL.every((c) => c.peril === "storm" && c.tradable && c.yesAsk !== null));
});

test("states: 'Austin, TX' is in Texas; a statewide market covers the state's cities only", () => {
  assert.equal(stateOf("Austin, TX"), "texas");
  assert.equal(stateOf("Florida"), "florida");
  assert.ok(sameState("Texas", "Houston, TX"));
  assert.ok(!sameState("Hawaii", "Houston, TX"));
  assert.ok(!sameState("Cocoa, FL", "Tampa, FL")); // a river gauge is not a state
});

test("hail -> real US tornado counts (one-sided strikes) with a basis-risk note, never hurricanes or Hedgehog", () => {
  const top = rankCandidates(risk("hail", "Hail dents the lot", "hail 1 inch or larger nearby"), biz("Austin, TX"), UNIVERSE, 10, NOW);
  assert.ok(top.length >= 2);
  for (const c of top) {
    assert.equal(c.peril, "storm"); assert.match(c.eventTitle, /tornado/i);
    assert.match(c.proxyNote ?? "", /No hail market/);
    assert.notEqual(c.venue, "hedgehog");
    const b = contractMeta(c.id)?.bounds;
    if (b) assert.ok((b.lo === undefined) !== (b.hi === undefined), `${c.id}: two-sided bin`);
  }
});

test("flood -> direct river gauge where one exists, else the city's monthly rain total (wet side)", () => {
  const cocoa = rankCandidates(risk("flood", "River floods the marina", "St. Johns River above 19 ft", "next 14 days"), biz("Cocoa, FL"), UNIVERSE, 10, NOW);
  assert.ok(cocoa.length && cocoa.every((c) => c.peril === "flood" && !c.proxyNote));
  const nyc = rankCandidates(risk("flood", "Basement floods", "a very wet month", "November"), biz("New York, NY"), UNIVERSE, 10, NOW);
  assert.ok(nyc.length >= 1 && nyc.every((c) => c.peril === "rain" && c.location === "NYC" && /No flood market/.test(c.proxyNote ?? "")));
  assert.ok(nyc.every((c) => !/^\d.*-.*"$/.test(c.label)), "range bins are not a wet/dry hedge");
});

test("wildfire -> a dry-season rain market (California 'Drier'), air quality -> nothing", () => {
  const napa = rankCandidates(risk("wildfire", "Wildfire smoke taints the grapes", "wildfire within 30 miles", "next 90 days"), biz("Napa, CA"), UNIVERSE, 10, NOW);
  assert.ok(napa.some((c) => /^Drier/.test(c.label) && /No wildfire/.test(c.proxyNote ?? "")));
  assert.ok(napa.every((c) => proxyFits("wildfire", c)));
  assert.deepEqual(rankCandidates(risk("smoke", "Smoke cancels the event", "AQI above 150"), biz("Austin, TX"), UNIVERSE, 10, NOW), []);
  assert.match(noMarketReason("smoke", " in Austin"), /air quality/);
  assert.match(noMarketReason("rain", " in Austin"), /No live market for rain in Austin/);
});

// in season (Oct 15): from Nov 16 to May 31 landfall markets are dropped as off-season (tests/matching-qa-c1.test.ts)
const IN_SEASON = new Date("2026-10-15T15:00:00Z");
test("hurricane risk: the business's state / city landfall markets, not other states", () => {
  const hou = rankCandidates(risk("storm", "Hurricane hits the coast", "hurricane landfall in Texas"), biz("Houston, TX"), UNIVERSE, 10, IN_SEASON);
  assert.ok(hou.some((c) => c.location === "Texas"));
  assert.ok(hou.every((c) => c.location === "Texas" || c.location === "US"), hou.map((c) => c.location).join(","));
  assert.match(hou[0].eventTitle, /hurricane/i);
  const tpa = rankCandidates(risk("storm", "Hurricane closes the shop", "hurricane landfall"), biz("Tampa, FL"), UNIVERSE, 10, IN_SEASON);
  assert.ok(tpa.some((c) => c.venue === "kalshi" && c.location === "Tampa") && tpa.some((c) => c.location === "Florida"));
  assert.ok(!tpa.some((c) => c.location === "Hawaii" || c.location === "Texas"));
});

test("findCandidates with the flag off: no hedgehog:* candidates (venue caches pre-seeded, no network)", async () => {
  const G = globalThis as { __hhSrcCache?: Map<string, unknown>; __hhPolyCache?: Map<string, unknown> };
  const t = Date.now() + 3_600_000; // fresh for the whole run
  G.__hhSrcCache!.set("kalshi:hail,storm", { t, v: TORN });
  G.__hhSrcCache!.set("kalshi:smoke", { t, v: [] });
  G.__hhSrcCache!.set("kalshi:flood,rain", { t, v: [] });
  G.__hhSrcCache!.set("gemini:Weather", { t, v: [] }); // flood -> rain family asks Gemini Weather
  (G.__hhPolyCache ??= new Map()).set("disaster", { t, v: POLY });
  const prof = biz("Austin, TX");
  const hail = await findCandidates(risk("hail", "Hail dents the lot", "hail 1 inch nearby"), prof);
  assert.ok(hail.length > 0 && hail.every((c) => c.venue !== "hedgehog" && !c.id.startsWith("hedgehog:")));
  assert.deepEqual(await findCandidates(risk("smoke", "Smoke", "AQI above 150"), prof), []);
  const flood = await findCandidates(risk("flood", "Creek floods", "heavy rain"), prof);
  assert.ok(flood.every((c) => c.venue !== "hedgehog"));
});

test("explorer: real flood markets sit with water/quakes/storms; hedgehog contracts only in their own group", () => {
  const hh: MarketContract = { ...POLY.find((c) => c.peril === "flood")!, id: "hedgehog:hail:austin-tx:25:20261119-20261218", venue: "hedgehog", peril: "hail", eventTicker: "hedgehog:hail", location: "Austin" };
  const ex = buildExplorer([...POLY, ...KAL, hh], NOW.getTime());
  assert.ok(ex.events.some((e) => e.group === "disaster" && e.peril === "flood" && e.place === "Cocoa"));
  assert.ok(ex.events.filter((e) => e.venues.some((v) => v.venue === "hedgehog")).every((e) => e.group === "parametric"));
  const real = buildExplorer([...POLY, ...KAL], NOW.getTime());
  assert.equal(real.counts.hedgehog, 0);
  assert.ok(!real.events.some((e) => e.group === "parametric"));
});

test("playbook with the flag off: no Hedgehog parametric queries; no-market risks on the watchlist", () => {
  assert.ok(PLAYBOOK.every((e) => !e.marketQuery.venues.includes("hedgehog")));
  for (const id of ["riverside-flood-wet-month", "nursery-hail-proxy", "vineyard-wildfire-dry-season", "hail-proxy-tornadoes"]) assert.ok(PLAYBOOK.some((e) => e.id === id), id);
  for (const id of ["outdoor-venue-smoke", "tour-operator-smoke", "event-wildfire", "car-wash-hail"]) assert.ok(REJECTED.some((r) => r.id === id && r.status === "not-live-now"), id);
});
