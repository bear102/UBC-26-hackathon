// Re-runs the industry playbook's live validity checks against the live market universe.
// Run: npx tsx scripts/validate-playbook.ts [City, ST]   (read-only public APIs, no keys, no orders)
// Checks per idea: (a) a live contract exists, (e) protective-side ask <= $0.85 and >= $0.02, depth >= 5 contracts
// at ask+2¢ (Gemini/Kalshi book). Also re-checks REJECTED "not-live-now" ideas in case they became live.
import "../lib/env";
import { listMarkets, getBook } from "../lib/markets";
import { depthAt } from "../lib/markets/book";
import { PLAYBOOK, REJECTED, resolveQuery, MAX_ASK, type MarketQuery } from "../lib/ai/playbook";
import type { MarketContract } from "../lib/types";

const city = process.argv[2] ?? "Austin, TX";
const profile = { name: "validator", city, description: "Spurs Texans Rockets Mavericks Cowboys Longhorns fans" };
const MIN_DEPTH = 5;

async function depthFor(c: MarketContract, side: "yes" | "no", ask: number): Promise<number | null> {
  const b = await getBook(c);
  if (b) return Math.round(depthAt(side === "yes" ? b.yes : b.no, ask + 0.02));
  const d = side === "yes" ? c.depthYes : c.depthNo;
  return d ?? null;
}

async function check(q: MarketQuery, markets: MarketContract[]) {
  // regional ideas (ERCOT, Lake Mead, snow cities, ski towns) are validated as a business in their first city
  const p = q.cities?.length && !q.cities.includes(city.split(",")[0].trim().toLowerCase()) ? { ...profile, city: q.cities[0] } : profile;
  const res = resolveQuery(q, p, markets, new Date(), 6);
  if (!res.length) return { pass: false, why: "no live contract with protective side priced 2-85¢", best: undefined as undefined | { id: string; side: string; ask: number; depth: number | null } };
  // first candidate (best-ranked) with enough depth
  for (const r of res) {
    const depth = await depthFor(r.contract, r.side, r.ask);
    if (depth === null || depth >= MIN_DEPTH) return { pass: r.ask <= MAX_ASK, why: depth === null ? "depth unknown" : "", best: { id: r.contract.id, side: r.side, ask: r.ask, depth } };
  }
  const r = res[0];
  return { pass: false, why: `depth < ${MIN_DEPTH} on top candidates`, best: { id: r.contract.id, side: r.side, ask: r.ask, depth: await depthFor(r.contract, r.side, r.ask) } };
}

async function main() {
  const t0 = Date.now();
  const markets = await listMarkets();
  console.log(`live universe: ${markets.length} open contracts (Gemini + Kalshi) in ${Date.now() - t0}ms; city=${city}\n`);
  const rows: string[][] = [];
  let pass = 0;
  for (const e of PLAYBOOK) {
    const r = await check(e.marketQuery, markets);
    if (r.pass) pass++;
    rows.push([r.pass ? "PASS" : "FAIL", e.id, e.correlation, r.best ? `${r.best.id} ${r.best.side.toUpperCase()}@${r.best.ask.toFixed(2)}` : "-", r.best?.depth == null ? "?" : String(r.best.depth), r.why]);
  }
  const w = [4, 26, 6, 58, 6];
  const line = (x: string[]) => x.map((s, i) => (w[i] ? s.slice(0, w[i]).padEnd(w[i]) : s)).join(" | ");
  console.log(line(["", "idea", "corr", "best live contract (protective side @ ask)", "depth", "note"]));
  console.log("-".repeat(130));
  for (const r of rows) console.log(line(r));
  console.log(`\nvalidated ideas passing now: ${pass}/${PLAYBOOK.length}`);

  const watch = REJECTED.filter((x) => x.status === "not-live-now" && x.marketQuery);
  if (watch.length) {
    console.log(`\nwatchlist (rejected: not live now):`);
    for (const x of watch) {
      const r = await check(x.marketQuery!, markets);
      console.log(`  ${r.pass ? "NOW LIVE" : "still no"} | ${x.id.padEnd(26)} | ${r.best ? `${r.best.id} ${r.best.side}@${r.best.ask}` : x.retryWhen ?? ""}`);
    }
  }
  console.log(`\nrejected (invalid / future source): ${REJECTED.filter((x) => x.status !== "not-live-now").length}`);
  process.exit(pass === PLAYBOOK.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
