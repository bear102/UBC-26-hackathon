import { json, err } from "@/lib/hh/http";
import { load } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const s = load(); const p = s.promises[id];
  if (!p) return err("not found", 404);
  const orders = s.orders.filter((o) => o.promiseId === id).map(({ raw, ...o }) => o);
  return json({
    note: "Gemini order ids are private to the merchant's Gemini account; Gemini can confirm them. PAPER-* ids are simulated fills against the live public book (no Gemini keys yet).",
    promise: p.pda, eventTicker: p.card.event_ticker, strip: p.card.strip, premiumUsd: p.premium, allocation: p.alloc, orders,
    ordersHash: "sha256 of the sorted filled orderIds joined with ','",
  });
}
