import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePolyWeather, weatherSlugs } from "../lib/markets/polymarket";

test("weatherSlugs covers today..+4 days, never past", () => {
  const s = weatherSlugs(new Date("2026-11-19T15:00:00Z"));
  const dates = [...new Set(s.map((x) => x.date))].sort();
  assert.deepEqual(dates, ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
  assert.ok(s.some((x) => x.slug === "highest-temperature-in-austin-on-november-21-2026"));
  assert.ok(s.some((x) => x.slug === "lowest-temperature-in-austin-on-november-21-2026" && x.low));
});

test("normalizePolyWeather maps bins, skips past days and closed markets", () => {
  const mk = (slug: string, title: string, closed = false) => ({ slug: `m-${slug}-${title}`, question: `q ${title}`, groupItemTitle: title, outcomes: '["Yes","No"]', outcomePrices: '["0.2","0.8"]', bestAsk: 0.21, bestBid: 0.19, closed, acceptingOrders: true });
  const ev = (slug: string, markets: any[]) => ({ slug, title: slug, markets });
  const info = new Map([
    ["highest-temperature-in-austin-on-november-21-2026", { city: "Austin", date: "2026-11-21", low: false }],
    ["lowest-temperature-in-austin-on-november-21-2026", { city: "Austin", date: "2026-11-21", low: true }],
    ["highest-temperature-in-austin-on-november-18-2026", { city: "Austin", date: "2026-11-18", low: false }],
  ]);
  const out = normalizePolyWeather([
    ev("highest-temperature-in-austin-on-november-21-2026", [mk("h", "84°F or higher"), mk("h", "80-81°F"), mk("h", "65°F or below"), mk("h", "70-71°F", true)]),
    ev("lowest-temperature-in-austin-on-november-21-2026", [mk("l", "47°F or below")]),
    ev("highest-temperature-in-austin-on-november-18-2026", [mk("p", "80-81°F")]),
  ] as any, info, "2026-11-19");
  assert.equal(out.length, 4); // past day + closed bin dropped
  assert.deepEqual(out.map((c) => c.peril), ["heat", "heat", "cold", "cold"]);
  assert.ok(out.every((c) => c.location === "Austin" && c.venue === "polymarket" && !c.tradable && c.status === "open"));
  assert.equal(out[0].yesAsk, 0.21);
});
