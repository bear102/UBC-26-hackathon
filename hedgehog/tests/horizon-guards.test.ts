import { test } from "node:test";
import assert from "node:assert/strict";
import { advise, type AdvisorDeps } from "../lib/ai/advisor";
import type { BusinessProfile, MarketContract, QuoteLine } from "../lib/types";

const NOW = () => new Date("2026-11-19T12:00:00Z");
const mk = (id: string, over: Partial<MarketContract>): MarketContract => ({ id, venue: "gemini", eventTitle: "", label: "", symbol: id, eventTicker: id, peril: "natgas", location: "US", expiry: "2026-11-20T22:00:00Z", yesAsk: 0.2, yesBid: 0.18, noAsk: 0.82, noBid: 0.8, tradable: true, status: "open", ...over });
const NG_DAY = mk("gemini:NG-1120", { eventTitle: "Natural Gas price on November 20?", label: "$3.65 or above", expiry: "2026-11-20T22:00:00Z" });
const NG_WEEK = mk("kalshi:NG-W", { venue: "kalshi", eventTitle: "Natural gas price this week (Nov 27)?", label: "Above $3.60", expiry: "2026-11-27T22:00:00Z" });
const RAIN_NOV = mk("kalshi:RAIN-NOV", { venue: "kalshi", peril: "rain", location: "Austin", eventTitle: "Rain in Austin in Nov 2026?", label: "Above 4 inches", expiry: "2026-12-01T06:00:00Z" });

const profile: BusinessProfile = { id: "cart", name: "Downtown hot dog cart", description: "Hot dog cart downtown Austin; we cook on propane and buy it monthly; rain kills sales", city: "Austin, TX", avgDailyRevenueUsd: 800, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 200 };
const risks = { risks: [
  { peril: "natgas", title: "Propane Cost Spike", trigger: "Natural gas spikes", location: "US", window: "next 30 days", lossUsd: 50, lossReasoning: "Adds ~10% to monthly fuel costs for cooking", confidence: 0.7 },
  { peril: "heat", title: "Hot Saturday", trigger: "Austin high above 90°F Sat Nov 21", location: "Austin", window: "Sat Nov 21", lossUsd: 200, lossReasoning: "Sat ~$1,000; heat -20% => $200", confidence: 0.5 },
  { peril: "rain", title: "Rainy December reduces sales", trigger: "Rain in Austin above 4 inches in December", location: "Austin", window: "December 2026", lossUsd: 900, lossReasoning: "3 lost busy days x $300", confidence: 0.6 },
] };
const llm = (async (opts: any) => {
  const sys: string = opts.system;
  const which = sys.includes("creative hedging strategist") ? "brainstorm" : sys.includes("risk analyst") ? "risk" : sys.includes("pick prediction-market") ? "match" : "summary";
  const data = which === "risk" ? risks
    : which === "brainstorm" ? { ideas: [], naturalHedges: [] }
    : which === "match" ? { matches: [...opts.prompt.matchAll(/^RISK (r\d+)/gm)].map((m: RegExpMatchArray) => {
        const block = opts.prompt.split(`RISK ${m[1]}`)[1].split("\nRISK ")[0];
        const id = ["gemini:NG-1120", "kalshi:NG-W", "kalshi:RAIN-NOV"].find((x) => block.includes(x));
        return id ? { riskId: m[1], picks: [{ contractId: id, side: "yes", tier: "recommended", rationale: "x", basisRisk: "x" }] } : { riskId: m[1], picks: [], noMatchReason: "none" };
      }) }
    : { summary: "ok" };
  return { data: opts.schema.parse(data), model: `fake/${which}` };
}) as any;
const find: AdvisorDeps["findCandidates"] = async (r) => (r.peril === "rain" ? [RAIN_NOV] : r.peril === "natgas" ? [NG_DAY, NG_WEEK] : []);
const size: AdvisorDeps["sizeQuote"] = async ({ legs, contracts, risks: rs, coveragePct }) => {
  const lines: QuoteLine[] = legs.map((l) => { const c = contracts.get(l.contractId)!; const r = rs.find((x) => x.id === l.riskId)!; const n = Math.ceil((coveragePct / 100) * r.lossUsd); return { ...l, contract: c, coveragePct, contracts: n, pricePerContract: 0.2, premiumUsd: n * 0.2, payoutUsd: n, impliedProb: 0.2, action: "buy-onchain" }; });
  return { lines, uncovered: [], totalPremiumUsd: lines.reduce((s, l) => s + l.premiumUsd, 0), totalPayoutUsd: lines.reduce((s, l) => s + l.payoutUsd, 0) };
};

test("monthly cost risk never uses a one-day price contract; named month never uses another month", async () => {
  const q = await advise(profile, { coveragePct: 50, deps: { llm, findCandidates: find, sizeQuote: size, listMarkets: async () => [NG_DAY, NG_WEEK, RAIN_NOV], now: NOW } });
  const ng = q.risks.find((r) => r.peril === "natgas");
  const rain = q.risks.find((r) => r.peril === "rain");
  assert.ok(ng && rain, "both risks kept");
  const ngLines = q.lines.filter((l) => l.riskId === ng!.id).map((l) => l.contractId);
  assert.ok(!ngLines.includes("gemini:NG-1120"), "one-day natural gas price not used for a monthly cost");
  assert.ok(!q.lines.some((l) => l.contractId === "kalshi:RAIN-NOV"), "November rain not used for a December risk");
  assert.match(q.uncovered.find((u) => u.riskId === rain!.id)?.reason ?? "", /No December market/);
});
