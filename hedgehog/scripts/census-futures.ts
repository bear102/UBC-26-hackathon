// Futures census over a frozen snapshot: futures per Texas team (NO ask <= 0.85) + long-dated macro series.
//   npx tsx scripts/census-futures.ts [markets-v3.json]
import fs from "node:fs";
const snap = JSON.parse(fs.readFileSync(`.data/eval/${process.argv[2] ?? "markets-v3.json"}`, "utf8"));
const meta = snap.meta as Record<string, any>;
const teams: [string, string[], string[]][] = [
  ["Spurs", ["san antonio", "san antonio spurs"], ["NBA"]], ["Rockets", ["houston", "houston rockets"], ["NBA"]],
  ["Mavs", ["dallas", "dallas mavericks"], ["NBA"]], ["Texans", ["houston", "houston texans"], ["NFL"]],
  ["Cowboys", ["dallas", "dallas cowboys"], ["NFL"]], ["Stars", ["dallas", "dallas stars"], ["NHL"]],
  ["Longhorns", ["texas", "texas longhorns"], ["NCAAF", "NCAAM"]],
];
const fut = snap.contracts.filter((c: any) => meta[c.id]?.futureKind);
console.log(`futures contracts: ${fut.length} (gemini ${fut.filter((c: any) => c.venue === "gemini").length}, kalshi ${fut.filter((c: any) => c.venue === "kalshi").length}); latest eventEnd ${fut.map((c: any) => meta[c.id].eventEnd).sort().at(-1)}`);
let ok = 0;
for (const [name, names, leagues] of teams) {
  const mine = fut.filter((c: any) => leagues.includes(meta[c.id].league) && (meta[c.id].teams ?? []).some((t: string) => names.includes(t.toLowerCase())));
  const hedge = mine.filter((c: any) => c.noAsk !== null && c.noAsk <= 0.85);
  if (hedge.length) ok++;
  const ex = hedge.sort((a: any, b: any) => a.noAsk - b.noAsk).slice(0, 4).map((c: any) => `${c.venue[0]}:${meta[c.id].futureKind}${meta[c.id].bounds ? " " + meta[c.id].bounds.text : ""} NO@${c.noAsk}→${meta[c.id].eventEnd}`).join("; ");
  console.log(`${name.padEnd(10)} futures ${String(mine.length).padStart(3)} | NO<=0.85: ${String(hedge.length).padStart(3)} | ${ex}`);
}
console.log(`teams covered: ${ok}/7`);
const macro = ["KXDIESELMON", "KXDIESELYE", "KXAAAGASMAX", "KXAAAGASMAXTX", "KXNATGASMON", "KXMORTGAGERATE", "KXGOVTSHUTDOWN", "KXRECSSNBER"];
for (const s of macro) {
  const cs = snap.contracts.filter((c: any) => c.venue === "kalshi" && c.symbol.startsWith(s + "-"));
  const priced = cs.filter((c: any) => c.yesAsk !== null || c.noAsk !== null);
  console.log(`${s.padEnd(15)} ${String(cs.length).padStart(3)} open, ${priced.length} priced | ${cs[0] ? `${cs[0].peril} ${meta[cs[0].id]?.eventDate}..${meta[cs[0].id]?.eventEnd ?? ""} "${cs[0].eventTitle}"` : ""}`);
}
const late = fut.filter((c: any) => (meta[c.id].eventEnd ?? "") >= "2028");
console.log(`futures with eventEnd >= 2028: ${late.length}`);
