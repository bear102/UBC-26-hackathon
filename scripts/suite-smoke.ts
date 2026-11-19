// Smoke test for the suite backend (no LLM key → keyword fallback; quotes only, never buys).
// Usage: HEDGE_MODE=live GEMINI_TRADE_BASE=https://api.sandbox.gemini.com HH_ALLOW_CRYPTO=1 npx tsx scripts/suite-smoke.ts
import { scanExposures, suiteCatalog } from "../lib/hh/exposure";
import { quoteDesk } from "../lib/hh/hedgeDesk";

const t0 = Date.now();
const cat = await suiteCatalog();
console.log(`catalog ${cat.length} events in ${Date.now() - t0} ms:`, Object.entries(cat.reduce<Record<string, number>>((a, e) => ((a[e.category] = (a[e.category] ?? 0) + 1), a), {})));
for (const text of ["coffee cart near UT, iced and hot drinks, we take crypto", "taqueria on East 6th, gas griddles, 2 food trucks", "sports bar on Guadalupe, $6 drafts, patio, game nights, variable-rate SBA loan"]) {
  const m = await scanExposures(text, { fresh: true });
  console.log(`\n== ${text}\n   source ${m.source} (${m.note}) ${m.ms} ms`);
  for (const r of m.rows) console.log(`   ${r.action.padEnd(5)} ${r.event_ticker.padEnd(26)} ${r.labels.join("|").slice(0, 40).padEnd(40)} p=${r.p_bad} cost=${r.cost_per_usd} depth=${r.depth} ${r.venue.mode}@${r.venue.host} ${r.flags.join(",")} ${r.action_forced ?? ""}`);
  const h = m.rows.find((r) => r.action !== "plan" && r.cost_per_usd != null);
  if (h) {
    const q = await quoteDesk({ event_ticker: h.event_ticker, symbols: h.symbols, payout_usd: 20 });
    console.log(`   desk quote: premium ${q.premium} fair ${q.fair} p ${q.p_bad} fillable ${q.fillable} tradeable ${q.tradeable} ${q.reason ?? ""}\n   "${q.plain}"`);
  }
}
