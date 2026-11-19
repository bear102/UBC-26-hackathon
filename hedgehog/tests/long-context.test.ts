// Long-term & creative hedges loop, iteration 3: the LLM prompts see season futures and period markets
// (lib/ai/longContext.ts + buildCatalog / marketUniverse / candidateLines hooks). Offline, no LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BusinessProfile, MarketContract } from "../lib/types";
import { setMeta } from "../lib/markets/normalize";
import { buildCatalog } from "../lib/ai/ideas";
import { candidateLines, marketUniverse, teamWords } from "../lib/ai/advisor";
import { isLongContract, nextFomc, seasonCalendar, teamFutures } from "../lib/ai/longContext";

const now = new Date("2026-11-19T15:00:00Z");
const LONG: MarketContract[] = JSON.parse(readFileSync(new URL("./fixtures/long-horizon-markets.json", import.meta.url), "utf8"));
const META: Record<string, Parameters<typeof setMeta>[1]> = {
  "gemini:GEMI-NBAF-2627CONF-WEST-SAS": { eventDate: "2026-10-20", eventEnd: "2027-05-31", futureKind: "conference", league: "NBA", teams: ["San Antonio"] },
  "kalshi:KXNBAWEST-27-SAS": { eventDate: "2026-10-20", eventEnd: "2027-05-31", futureKind: "conference", league: "NBA", teams: ["San Antonio"] },
  "kalshi:KXNBAPLAYOFF-27-SAS": { eventDate: "2026-10-20", eventEnd: "2027-04-17", futureKind: "playoffs", league: "NBA", teams: ["San Antonio"] },
  "kalshi:KXNBAWCFQUAL-27-SAS": { eventDate: "2026-10-20", eventEnd: "2027-05-17", futureKind: "round", league: "NBA", teams: ["San Antonio"] },
  "gemini:GEMI-NFLHOUWINS26-8PLUS": { eventDate: "2026-09-09", eventEnd: "2027-01-10", futureKind: "wins", league: "NFL", teams: ["Houston"] },
  "kalshi:KXDIESELYE-26DEC31-T6.00": { eventDate: "2026-12-31" },
  "kalshi:KXDIESELYE-26DEC31-T6.20": { eventDate: "2026-12-31" },
  "kalshi:KXMORTGAGERATE-26DEC-T7.6": { eventDate: "2026-01-01", eventEnd: "2026-12-31" },
  "kalshi:KXGOVTSHUTDOWN-26DEC12": { eventDate: "2026-12-12" },
};
for (const [id, m] of Object.entries(META)) setMeta(id, m);
const day: MarketContract = { id: "kalshi:KXNBAGAME-26NOV21LACSAS-SAS", venue: "kalshi", eventTitle: "Los Angeles C vs San Antonio", label: "San Antonio", peril: "game", location: "San Antonio", expiry: "2026-11-22T04:00:00Z", yesAsk: 0.88, noAsk: 0.13, tradable: true, status: "open" } as MarketContract;
setMeta(day.id, { eventDate: "2026-11-21", league: "NBA", teams: ["San Antonio"] });
const ALL = [...LONG, day];
const bar: BusinessProfile = { id: "spurs-bar", name: "Spurs Bar", description: "Sports bar by the Frost Bank Center. A deep Spurs playoff run means weeks of packed nights.", city: "San Antonio, TX", avgDailyRevenueUsd: 5000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 400 };

test("hz3: catalog has one Spurs season-futures line with every stage, settle months in 2027 (never the 2029 placeholder)", () => {
  const cat = buildCatalog(ALL, bar, teamWords(bar.description), now.getTime());
  const spurs = cat.filter((c) => /Spurs \(NBA\) season futures/.test(c.line));
  assert.equal(spurs.length, 1, cat.map((c) => c.line).join("\n"));
  const line = spurs[0].line;
  assert.match(line, /make playoffs 0\.97/);
  assert.match(line, /reach West finals 0\.60/);
  assert.match(line, /win West 0\.3[57]/);
  assert.match(line, /settle Apr-May 2027/);
  assert.ok(!/2029/.test(cat.map((c) => c.line).join("\n")), "no placeholder 2029 close date anywhere");
  assert.ok(spurs[0].long && spurs[0].ids.length === 4, "all four Spurs futures are the line's candidates");
  // other teams' futures are counted, not listed; the single game stays a game line
  assert.ok(!cat.some((c) => /Houston Total Wins/.test(c.line)));
  assert.ok(cat.some((c) => c.series === "Los Angeles C vs San Antonio"));
  // long macro lines say when they settle
  assert.match(cat.find((c) => /Diesel price at year-end/.test(c.series))!.line, /settles Dec 2026/);
});

test("hz3: risk-map universe has a SEASON FUTURES & PERIOD MARKETS section; game nights do not crowd it out", () => {
  const u = marketUniverse(ALL, bar, 6, now.getTime());
  const [short, long] = u.split("SEASON FUTURES & PERIOD MARKETS");
  assert.ok(long, u);
  assert.match(long, /Spurs \(NBA\) season futures/);
  assert.ok(!/Western Conference Champion/.test(short), "futures are not repeated as game events");
  assert.match(short, /^game: \d+ live events/m); // the per-peril section is still there
});

test("hz3: matcher candidates show the settle day for futures, not the venue's 2029 expiry", () => {
  const lines = candidateLines([LONG.find((c) => c.id === "kalshi:KXNBAWEST-27-SAS")!, day]);
  assert.match(lines, /KXNBAWEST-27-SAS .*settles 2027-05-31 \(season future: conference\)/);
  assert.ok(!/2029/.test(lines));
  assert.match(lines, /KXNBAGAME.*expires Nov 21/);
});

test("hz3: long-contract detection, team futures and the season calendar", () => {
  assert.equal(isLongContract(LONG.find((c) => c.id === "kalshi:KXDIESELYE-26DEC31-T6.00")!, now.getTime()), true); // one day, 6 weeks out
  assert.equal(isLongContract(day, now.getTime()), false);
  assert.equal(teamFutures(ALL, { description: "a bar" }, now.getTime()).length, 0); // no team named -> no team lines
  assert.deepEqual(nextFomc([], now.getTime()), ["2026-12-09", "2027-01-27", "2027-03-17"]);
  const cal = seasonCalendar(ALL, bar, now.getTime());
  assert.match(cal, /NBA regular season ends Apr 11, 2027/);
  assert.match(cal, /title Jun 20, 2027/);
  assert.match(cal, /next FOMC decisions Dec 9, 2026, Jan 27, 2027, Mar 17, 2027/);
});

test("hz3: an 'other' risk ranks contracts whose title names it (shutdown never hedged with the NASDAQ); no-meta far expiry needs a dateless title", async () => {
  const { rankCandidates } = await import("../lib/markets/index");
  const nasdaq = { id: "gemini:GEMI-NASDAQ2026-GE33", venue: "gemini", eventTitle: "NASDAQ-100 close price end of 2026?", label: "33,000.01 or above", peril: "other", expiry: "2026-12-31T21:00:00Z", yesAsk: 0.04, noAsk: 0.97, tradable: true, status: "open" } as MarketContract;
  setMeta(nasdaq.id, { eventDate: "2026-12-31" });
  const broker: BusinessProfile = { id: "b", name: "Broker", description: "Mortgage broker; FHA/VA loans stall when the government shuts down.", city: "Austin, TX", avgDailyRevenueUsd: 3500, busyDays: ["Mon"], monthlyBudgetUsd: 500 };
  const risk = { id: "r3", peril: "other" as const, title: "Government shutdown disrupts loan processing", trigger: "Government shutdown on Dec 12, 2026", location: "US", window: "December", lossUsd: 10500, lossReasoning: "x", confidence: 0.5 };
  const ids = rankCandidates(risk, broker, [nasdaq, ...LONG], 12, now).map((c) => c.id);
  assert.deepEqual(ids, ["kalshi:KXGOVTSHUTDOWN-26DEC12"]);
  // a hand-built contract with no meta: "on Nov 22" / a matchup is a single day even with a far placeholder expiry
  const far = "2099-01-01T00:00:00Z";
  assert.equal(isLongContract({ ...day, id: "x:1", expiry: far } as MarketContract, now.getTime()), false);
  assert.equal(isLongContract({ ...day, id: "x:2", eventTitle: "Highest temperature in Austin on Nov 22?", expiry: far } as MarketContract, now.getTime()), false);
  assert.equal(isLongContract({ ...day, id: "x:3", eventTitle: "Recession in 2027?", expiry: far } as MarketContract, now.getTime()), true);
});
