// G1 gate (SPEC §9 H0): real Gemini production fill via API.
// Buys 1 contract in each bin of the D20 test event with ONE IOC batch, then reads positions with key B.
// Usage: npx tsx scripts/h0-gate.ts            -> dry run (terms, balances, books, planned batch; no orders)
//        npx tsx scripts/h0-gate.ts --buy      -> places the real orders (spends ~$1.30 real money)
import "../lib/hh/env";
import fs from "node:fs";
import { eventByTicker, book } from "../lib/hh/gemini";
import { termsStatus, batchOrder, positions, orderHistory, balances, hasKeys, callLog, type OrderReq } from "../lib/hh/geminiPrivate";

const TICKER = process.env.GATE_TICKER || "WXHIGH-AUS-2611190459";
const QTY = Number(process.env.GATE_QTY || 1);
const MAX_SPEND = Number(process.env.GATE_MAX_SPEND || 2.0);
const BUY = process.argv.includes("--buy");
const out: Record<string, unknown> = { ticker: TICKER, startedAt: new Date().toISOString(), buy: BUY };
const log = (k: string, v: unknown) => { out[k] = v; console.log(`[${k}]`, JSON.stringify(v, null, 1).slice(0, 2000)); };
const save = () => { fs.mkdirSync(".data", { recursive: true }); out.calls = callLog.map((c) => ({ ...c })); fs.writeFileSync(".data/h0-gate.json", JSON.stringify(out, null, 2)); };

async function main() {
  if (!hasKeys("A") || !hasKeys("B")) throw new Error("GEMINI_API_KEY_A/SECRET_A and GEMINI_API_KEY_B/SECRET_B must be set in .env.local");
  try { log("termsA", await termsStatus("A")); } catch (e) { log("termsA_error", String(e)); }
  try { log("balancesA", await balances("A")); } catch (e) { log("balancesA_error", String(e)); }
  try { log("positionsB_before", await positions("B")); } catch (e) { log("positionsB_before_error", String(e)); }

  const ev = await eventByTicker(TICKER);
  log("event", { status: ev.status, expiry: ev.expiryDate, bins: ev.contracts.map((c) => c.instrumentSymbol) });
  const orders: OrderReq[] = [];
  let maxCost = 0;
  for (const c of ev.contracts) {
    const b = await book(c.instrumentSymbol, 0);
    const ask = b.asks.length ? Number(b.asks[0].price) : NaN;
    if (!Number.isFinite(ask)) throw new Error(`no ask for ${c.instrumentSymbol}`);
    const limit = Math.min(ask + 0.02, 0.99);
    orders.push({ symbol: c.instrumentSymbol, side: "buy", outcome: "yes", price: limit, quantity: QTY });
    maxCost += limit * QTY;
  }
  log("plannedBatch", { orders, maxCost: +maxCost.toFixed(2) });
  if (maxCost > MAX_SPEND) throw new Error(`max cost ${maxCost} > GATE_MAX_SPEND ${MAX_SPEND}`);
  if (!BUY) { console.log("DRY RUN: pass --buy to place the orders"); return; }

  const t0 = Date.now();
  const res = await batchOrder(orders, "A");
  const tFill = Date.now();
  log("batchResult", res);
  log("batchMs", tFill - t0);
  const ids = (res.results || []).map((r) => r.order?.orderId).filter(Boolean).map(String);
  log("orderIds", ids);

  // Latency: poll positions with key B until every bin shows quantity (max 20 s).
  const want = new Set(orders.map((o) => o.symbol));
  let seenAt = 0;
  for (let i = 0; i < 40; i++) {
    const ps = await positions("B");
    const have = ps.filter((p) => want.has(p.symbol) && Number(p.totalQuantity) > 0).length;
    if (have === want.size) { seenAt = Date.now(); log("positionsB_after", ps.filter((p) => want.has(p.symbol))); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  log("fillToPositionMs", seenAt ? seenAt - tFill : "not seen within 20s");
  try { log("orderHistoryB", (await orderHistory({ limit: 50 }, "B")).filter((o) => ids.includes(String(o.orderId)))); } catch (e) { log("orderHistory_error", String(e)); }
}

main().catch((e) => { log("error", String(e)); process.exitCode = 1; }).finally(() => { out.finishedAt = new Date().toISOString(); save(); });
