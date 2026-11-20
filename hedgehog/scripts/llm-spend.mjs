// Usage: node scripts/llm-spend.mjs [tag] [sinceISO] -> total Claude spend logged in .data/llm-usage.jsonl
import { readFileSync, existsSync } from "node:fs";
const [tag, since] = process.argv.slice(2);
const rows = existsSync(".data/llm-usage.jsonl") ? readFileSync(".data/llm-usage.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const sel = rows.filter((r) => (!tag || r.tag === tag) && (!since || r.t >= since));
const usd = sel.reduce((s, r) => s + (r.usd || 0), 0);
console.log(JSON.stringify({ calls: sel.length, usd: Math.round(usd * 100) / 100, inTok: sel.reduce((s, r) => s + (r.in || 0), 0), outTok: sel.reduce((s, r) => s + (r.out || 0), 0) }));
