// Live probe of the market layer: counts per peril/venue + sample Austin candidates.
// Run: npx tsx scripts/probe-markets.ts   (read-only public APIs, no keys)
import "../lib/env";
import { findCandidates, hitRate, kalshiSource, listMarkets, contractMeta, getContract } from "../lib/markets";
import { sizeQuote } from "../lib/markets/quote";
import type { BusinessProfile, MarketContract, Risk } from "../lib/types";

const fmt = (c: MarketContract) => {
  const m = contractMeta(c.id);
  const p = (x: number | null) => (x === null ? "  - " : x.toFixed(2));
  return `${c.venue.padEnd(6)} ${c.id.slice(0, 48).padEnd(48)} | ${c.eventTitle.slice(0, 46).padEnd(46)} | ${c.label.slice(0, 18).padEnd(18)} ` +
    `Y ${p(c.yesBid)}/${p(c.yesAsk)} N ${p(c.noBid)}/${p(c.noAsk)} d=${c.depthYes ?? "?"}/${c.depthNo ?? "?"} ${m?.bounds?.text ?? ""} ${m?.eventDate ?? ""}`;
};

const profile: BusinessProfile = {
  id: "rainey-patio-bar", name: "Rainey St patio bar", description: "Patio bar on Rainey St, Austin. Busy on Spurs and Texans game nights.",
  city: "Austin, TX", avgDailyRevenueUsd: 4000, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 300,
};
const risks: Risk[] = [
  { id: "r1", peril: "heat", title: "Hot day empties the patio", trigger: "Austin high >= 78F", location: "Austin", window: "next 2 days", lossUsd: 800, lossReasoning: "", confidence: 0.6 },
  { id: "r2", peril: "rain", title: "Rainy weekend", trigger: "Any rain in Austin", location: "Austin", window: "this weekend", lossUsd: 1200, lossReasoning: "", confidence: 0.6 },
  { id: "r3", peril: "gas", title: "Gas spike raises delivery costs", trigger: "US avg gas above $3.60", window: "next 14 days", lossUsd: 300, lossReasoning: "", confidence: 0.5 },
  { id: "r4", peril: "game", title: "Spurs lose, crowd leaves early", trigger: "Spurs lose", window: "next 7 days", lossUsd: 500, lossReasoning: "", confidence: 0.5 },
  { id: "r5", peril: "game", title: "Texans lose on game night", trigger: "Texans lose", window: "next 14 days", lossUsd: 600, lossReasoning: "", confidence: 0.5 },
  { id: "r6", peril: "fed", title: "Fed hikes, loan costs up", trigger: "Fed hikes at next meeting", window: "next 90 days", lossUsd: 400, lossReasoning: "", confidence: 0.3 },
  { id: "r7", peril: "oil", title: "Oil spike", trigger: "WTI above $85", window: "next 7 days", lossUsd: 300, lossReasoning: "", confidence: 0.3 },
];

async function main() {
  const t0 = Date.now();
  const all = await listMarkets();
  console.log(`listMarkets: ${all.length} open contracts in ${Date.now() - t0}ms; kalshi source:`, kalshiSource());
  const counts = new Map<string, number>();
  for (const c of all) counts.set(`${c.peril}/${c.venue}`, (counts.get(`${c.peril}/${c.venue}`) ?? 0) + 1);
  console.log([...counts].sort().map(([k, v]) => `${k}=${v}`).join("  "));
  const austin = all.filter((c) => (c.location ?? "").toLowerCase() === "austin");
  console.log(`Austin-located contracts: ${austin.length} (${[...new Set(austin.map((c) => `${c.venue}:${c.peril}`))].join(", ")})`);

  for (const r of risks) {
    const cs = await findCandidates(r, profile, 6);
    console.log(`\n== ${r.id} ${r.peril} "${r.title}" (${r.trigger}; ${r.window}) -> ${cs.length} candidates`);
    for (const c of cs) console.log("  " + fmt(c));
  }

  console.log("\n== hitRate");
  console.log("heat Austin 30d >=85F:", JSON.stringify(await hitRate("heat", "Austin", 30, { threshold: 85 }), (k, v) => (k === "samples" ? `${v.length} samples` : v)));
  console.log("rain Austin 30d:", JSON.stringify(await hitRate("rain", "Austin", 30), (k, v) => (k === "samples" ? v.map((s: { date: string; yes: boolean }) => `${s.date.slice(5)}${s.yes ? "R" : "."}`).join(" ") : v)));

  const first = all.find((c) => c.venue === "gemini" && c.location === "Austin");
  if (first) { const f = await getContract(first.id); console.log("\ngetContract", first.id, "->", f ? `${f.status} yesAsk=${f.yesAsk}` : null); }
  const k = all.find((c) => c.venue === "kalshi" && c.peril === "gas");
  if (k) { const f = await getContract(k.id); console.log("getContract", k.id, "->", f ? `${f.status} yesAsk=${f.yesAsk} ${f.eventTitle}` : null); }

  // sizing demo with live books
  const r1 = await findCandidates(risks[0], profile, 3), r2 = await findCandidates(risks[1], profile, 3);
  const legs = [r1[0], r2[0]].filter(Boolean).map((c, i) => ({ riskId: risks[i].id, contractId: c.id, side: "yes" as const, rationale: "", basisRisk: "" }));
  const q = await sizeQuote({ legs, risks, contracts: new Map([...r1, ...r2].map((c) => [c.id, c])), coveragePct: 50, budgetUsd: 300 });
  console.log("\n== sizeQuote 50% / $300");
  for (const l of q.lines) console.log(`  ${l.contract.id} ${l.side} x${l.contracts} @${l.pricePerContract} = $${l.premiumUsd} -> pays $${l.payoutUsd} ${l.action}${l.maxCoverable !== undefined ? ` (max ${l.maxCoverable})` : ""}`);
  console.log("  uncovered:", q.uncovered, "total premium", q.totalPremiumUsd, "payout", q.totalPayoutUsd);
}
main().catch((e) => { console.error(e); process.exit(1); });
