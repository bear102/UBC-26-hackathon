import fs from "node:fs";
import { setMeta } from "../lib/markets/normalize";
import { buildCatalog } from "../lib/ai/ideas";
import { marketUniverse, teamWords } from "../lib/ai/advisor";
const snap = JSON.parse(fs.readFileSync(".data/eval/markets-v3.json", "utf8"));
for (const [id, m] of Object.entries(snap.meta)) setMeta(id, m as any);
const biz = JSON.parse(fs.readFileSync("tests/fixtures/eval-businesses.json", "utf8")).businesses;
const now = new Date(snap.t);
for (const id of process.argv.slice(2)) {
  const p = biz.find((b: any) => b.id === id);
  const cat = buildCatalog(snap.contracts, p, teamWords(p.description), now.getTime());
  const u = marketUniverse(snap.contracts, p);
  console.log(`=== ${id} catalog ${cat.length} lines ${cat.map((c) => c.line).join("\n").length} chars; universe ${u.length} chars`);
  console.log(cat.map((c) => c.line).join("\n"));
  console.log("--- universe\n" + u);
}
