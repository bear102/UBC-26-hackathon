import "../lib/hh/env";
import { promoCatalog, templateCards, quoteCard } from "../lib/hh/catalog";
const cat = await promoCatalog();
console.log(cat.length, cat.map((e) => `${e.kind} ${e.ticker} ${e.startTime ?? ""}`).slice(0, 30).join("\n"));
const cards = await templateCards(cat);
for (const c of cards) { const q = await quoteCard(c); console.log(q.sentence, q.strip, q.quote.costPerReceipt, q.quote.maxReceipts, q.scale, new Date(q.salesClose*1000).toISOString()); }
