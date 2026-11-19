// Smoke test for the suite backend (LLM if a key is set, else keyword fallback; quotes only, never buys).
// Usage: HEDGE_MODE=live GEMINI_TRADE_BASE=https://api.sandbox.gemini.com HH_ALLOW_CRYPTO=1 npx tsx scripts/suite-smoke.ts
import { scanExposures, suiteCatalog, prewarmSuite } from "../lib/hh/exposure";
import { quoteDesk } from "../lib/hh/hedgeDesk";

const t0 = Date.now();
const cat = await suiteCatalog();
console.log(`catalog cold: ${cat.length} events in ${Date.now() - t0} ms:`, Object.entries(cat.reduce<Record<string, number>>((a, e) => ((a[e.category] = (a[e.category] ?? 0) + 1), a), {})));
const t1 = Date.now();
await prewarmSuite();
console.log(`catalog warm: ${Date.now() - t1} ms`);
const crypto = cat.filter((e) => e.category === "Crypto").map((e) => `${e.ticker}${(e as { venueHint?: string }).venueHint === "trade" ? "(trade)" : ""}`);
console.log(`crypto in catalog: ${crypto.join(", ") || "none"}`);
for (const text of ["coffee cart near UT, iced and hot drinks, we take crypto", "taqueria on East 6th, gas griddles, 2 food trucks", "sports bar on Guadalupe, $6 drafts, patio, game nights, variable-rate SBA loan"]) {
  const m = await scanExposures(text, { fresh: true });
  console.log(`\n== ${text}\n   source ${m.source} (${m.note}) ${m.ms} ms`);
  for (const r of m.rows) console.log(`   ${r.action.padEnd(5)} ${r.event_ticker.padEnd(26)} ${r.labels.join("|").slice(0, 40).padEnd(40)} p=${r.p_bad} cost=${r.cost_per_usd} depth=${r.depth} $${r.impact_usd} ${r.venue.mode}@${r.venue.host} ${r.flags.join(",")} ${r.action_forced ?? r.venue.why ?? ""}`);
  for (const h of m.rows.filter((r) => r.action !== "plan" && r.cost_per_usd != null).slice(0, 2)) {
    const tq = Date.now();
    const q = await quoteDesk({ event_ticker: h.event_ticker, symbols: h.symbols, payout_usd: 20 });
    console.log(`   desk quote ${h.event_ticker} (${Date.now() - tq} ms): premium ${q.premium} fair ${q.fair} max_spend ${q.max_spend} p ${q.p_bad} fillable ${q.fillable} tradeable ${q.tradeable} ${q.venue.mode}@${q.venue.host} ${q.reason ?? ""}`);
    console.log(`     legs: ${q.legs.map((l) => `${l.symbol.split("-").pop()} qty ${l.qty} ask ${l.ask} limit ${l.limit} top ${l.top} depth ${l.depth}`).join("; ")}\n     "${q.plain}"`);
  }
}
console.log(`\ntotal ${Date.now() - t0} ms`);
process.exit(0);
