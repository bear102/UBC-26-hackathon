// Industry playbook: matching, query resolution against a saved live-market snapshot (2026-11-19), direction sanity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INDUSTRIES, PLAYBOOK, REJECTED, labelDir, matchIndustries, playbookIdeas, resolveQuery, seriesOf, sideFor, MAX_ASK } from "../lib/ai/playbook/index";
import { ideasFromPlaybook } from "../lib/ai/ideas";
import { getPreset } from "../lib/ai/presets";
import type { BusinessProfile, MarketContract } from "../lib/types";

const MARKETS: MarketContract[] = [
  ...JSON.parse(readFileSync(new URL("./fixtures/playbook-markets.json", import.meta.url), "utf8")),
  // Hedgehog parametric contracts generated for Austin on 2026-11-19 + Kalshi US tornado count (proxy ideas)
  ...JSON.parse(readFileSync(new URL("./fixtures/parametric-playbook-markets.json", import.meta.url), "utf8")),
  // long-horizon ideas (season futures, year-end diesel, the year's mortgage-rate high, shutdown), from .data/eval/markets-v3.json
  ...JSON.parse(readFileSync(new URL("./fixtures/long-horizon-markets.json", import.meta.url), "utf8")),
];
const NOW = new Date("2026-11-19T09:00:00Z");
const biz = (description: string, over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: "t", name: "Test Co", description, city: "Austin, TX", avgDailyRevenueUsd: 2000, busyDays: ["Sat"], monthlyBudgetUsd: 200, ...over,
});
const byId = (id: string) => PLAYBOOK.find((e) => e.id === id)!;

test("playbook data: ids unique, industries exist, every validated idea has evidence + live example", () => {
  const ids = [...PLAYBOOK.map((e) => e.id), ...REJECTED.map((r) => r.id)];
  assert.equal(new Set(ids).size, ids.length);
  const inds = new Set(INDUSTRIES.map((i) => i.id));
  for (const e of PLAYBOOK) {
    assert.ok(inds.has(e.industry), `${e.id}: unknown industry ${e.industry}`);
    assert.ok(e.evidence.length >= 1 && e.evidence.every((x) => /^https?:\/\//.test(x.source)), `${e.id}: evidence`);
    assert.ok(e.validated.liveExample && (e.validated.ask ?? 1) <= MAX_ASK, `${e.id}: validated`);
    assert.ok(e.basisRisk.length > 10 && e.causalStory.length > 10);
  }
  assert.ok(REJECTED.every((r) => r.reason.length > 20));
  // a laundromat still matches its industry, but its only idea (natural gas) is on the watchlist: no seed
  assert.ok(REJECTED.some((r) => r.id === "laundromat-gas" && r.status === "not-live-now" && r.marketQuery));
  assert.ok(PLAYBOOK.length >= 25 && INDUSTRIES.length >= 15);
});

test("matchIndustries: free-text descriptions map to the right industries", () => {
  const top = (d: string) => matchIndustries(biz(d)).map((m) => m.industry.id);
  assert.equal(top("I own a small jewelry store doing custom gold engagement rings")[0], "jeweler");
  assert.ok(top("Electrical contractor, we bid fixed-price wiring jobs").includes("construction"));
  assert.ok(top("We run a coin-op laundromat with 30 gas dryers").includes("laundromat"));
  assert.ok(top("Mortgage broker in Round Rock, mostly refinances").includes("real-estate"));
  assert.ok(top("Tunnel car wash off I-35").includes("car-wash"));
  assert.ok(top("We accept bitcoin and Solana Pay at our vape shop").includes("crypto-merchant"));
  assert.deepEqual(top("zzz qqq"), []);
  const bar = matchIndustries(getPreset("rainey-patio-bar")!).map((m) => m.industry.id);
  assert.ok(bar.includes("bar-restaurant") && bar.includes("sports-bar-merch"));
  const cat = matchIndustries(getPreset("austin-catering-delivery")!).map((m) => m.industry.id);
  assert.ok(cat.includes("delivery") && cat.includes("borrower"));
});

test("seriesOf / labelDir helpers", () => {
  const brent = MARKETS.find((c) => c.symbol.startsWith("GEMI-BRENT"))!;
  assert.equal(seriesOf(brent), "BRENT");
  const wk = MARKETS.find((c) => c.eventTicker.startsWith("KXRAINWKND"))!;
  assert.equal(seriesOf(wk), "KXRAINWKND");
  assert.deepEqual(labelDir("$93 or above"), { dir: "up", v: 93 });
  assert.deepEqual(labelDir("69°F or below"), { dir: "down", v: 69 });
  assert.equal(labelDir("Above 3.6400").dir, "up");
  assert.equal(labelDir("74°F to 75°F").dir, "range");
});

test("resolveQuery against the fixture: right series, right city, priced protective side", () => {
  const rain = resolveQuery(byId("bar-rain-night").marketQuery, biz("patio bar"), MARKETS, NOW);
  assert.ok(rain.length >= 1);
  for (const r of rain) { assert.equal(r.contract.peril, "rain"); assert.equal(r.contract.location, "Austin"); assert.equal(r.side, "yes"); }
  assert.ok(rain.some((r) => r.contract.id === "kalshi:KXRAINWKND-26NOV21-AUS"));
  const dallas = resolveQuery(byId("bar-rain-night").marketQuery, biz("patio bar", { city: "Dallas, TX" }), MARKETS, NOW);
  assert.ok(dallas.length && dallas.every((r) => r.contract.location === "Dallas"));
  for (const e of PLAYBOOK) {
    const regional = e.marketQuery.cities?.length && !e.marketQuery.cities.includes("austin") ? { city: e.marketQuery.cities[0] } : {};
    const res = resolveQuery(e.marketQuery, biz("Spurs and Texans fans", regional), MARKETS, NOW);
    assert.ok(res.length > 0, `${e.id}: no live candidate in fixture`);
    for (const r of res) assert.ok(r.ask >= 0.02 && r.ask <= MAX_ASK, `${e.id}: ask ${r.ask}`);
  }
});

test("direction sanity: the chosen side pays when the business is hurt", () => {
  const prof = biz("Spurs and Texans fans");
  // costs up -> YES on 'or above'
  for (const id of ["electrician-copper", "jeweler-gold", "delivery-diesel-brent", "jeweler-silver", "delivery-gas"]) {
    for (const r of resolveQuery(byId(id).marketQuery, prof, MARKETS, NOW)) {
      assert.equal(labelDir(r.contract.label).dir, "up", `${id} ${r.contract.label}`);
      assert.equal(r.side, "yes", `${id}`);
    }
  }
  // crypto drawdown -> NO on 'or above'
  for (const r of resolveQuery(byId("crypto-btc-drawdown").marketQuery, prof, MARKETS, NOW)) {
    assert.match(r.contract.eventTitle, /^BTC price on /);
    assert.equal(labelDir(r.contract.label).dir, "up"); assert.equal(r.side, "no");
  }
  // cold front -> YES on 'or below'
  for (const r of resolveQuery(byId("bar-cold-front").marketQuery, prof, MARKETS, NOW)) { assert.equal(labelDir(r.contract.label).dir, "down"); assert.equal(r.side, "yes"); }
  // Fed hike -> YES on Hike labels only (never 'maintains' / 'cut')
  for (const r of resolveQuery(byId("borrower-fed-hike").marketQuery, prof, MARKETS, NOW)) { assert.match(r.contract.label, /^Hike/); assert.equal(r.side, "yes"); }
  // team loses -> YES on the opponent, never on our team
  const games = resolveQuery(byId("sports-team-loses").marketQuery, prof, MARKETS, NOW);
  assert.ok(games.length);
  for (const r of games) { assert.ok(!/^(Houston|San Antonio)$/.test(r.contract.label), r.contract.label); assert.equal(r.side, "yes"); }
  // and no team named -> nothing
  assert.equal(resolveQuery(byId("sports-team-loses").marketQuery, biz("a bar"), MARKETS, NOW).length, 0);
  // sideFor rejects range bins
  const bin = MARKETS.find((c) => /to/.test(c.label) && c.peril === "heat")!;
  assert.equal(sideFor(byId("bar-cold-front").marketQuery, bin), null);
});

test("playbookIdeas: seeds for presets and free text, real candidate ids, compatible with ideasFromPlaybook", () => {
  const ids = new Set(MARKETS.map((c) => c.id));
  const cases: [BusinessProfile, string[]][] = [
    [{ ...getPreset("austin-catering-delivery")!, id: "c" }, ["delivery-diesel-brent", "borrower-fed-hike"]],
    [biz("Custom jewelry studio, we quote gold and silver rings two weeks before casting"), ["jeweler-gold"]],
    [biz("Self-serve car wash and detailing"), ["carwash-rain"]],
    [biz("Mortgage broker, mostly refinances; we also have an SBA loan"), ["mortgage-rate-hike"]],
  ];
  for (const [p, want] of cases) {
    const seeds = playbookIdeas(p, MARKETS, { now: NOW });
    assert.ok(seeds.length >= 1 && seeds.length <= 4, `${p.description}: ${seeds.length}`);
    for (const w of want) assert.ok(seeds.some((s) => s.idea.id === w), `${p.description}: missing ${w} (got ${seeds.map((s) => s.idea.id)})`);
    for (const s of seeds) {
      assert.ok(s.candidates.length >= 1 && s.candidates.every((c) => ids.has(c.id) && s.sides[c.id]));
      if (/below/.test(s.idea.trigger)) assert.equal(s.entry.marketQuery.hurtWhen, "below");
    }
    const { ideas } = ideasFromPlaybook(seeds, p);
    assert.equal(ideas.length, seeds.length);
    for (const i of ideas) assert.ok(i.fixed?.length && i.risk.kind === "proxy");
  }
  assert.deepEqual(playbookIdeas(biz("zzz"), MARKETS, { now: NOW }), []);
});
