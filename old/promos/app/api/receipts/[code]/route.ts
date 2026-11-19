import { type NextRequest } from "next/server";
import { json, err } from "@/lib/hh/http";
import { load } from "@/lib/hh/store";
import { promiseView } from "@/lib/hh/views";
import { tokenBalance } from "@/lib/hh/chain";
import * as P from "@/lib/hh/program";
import { PublicKey } from "@solana/web3.js";
export const dynamic = "force-dynamic";
// Receipt page data. Public: the code only grants a view of its own promise.
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const c = load().codes[code];
  if (!c) return err("unknown code", 404);
  const v = await promiseView(c.promiseId);
  if (!v) return err("unknown promise", 404);
  const holder = req.nextUrl.searchParams.get("holder");
  const mine = holder && c.holder === holder ? v.receipts.find((r) => r.index === c.receiptIndex) ?? null : null;
  let balance: number | null = null;
  if (holder) { try { balance = await tokenBalance(P.usdcAta(new PublicKey(holder))); } catch { balance = null; } }
  const { orders, attestations, ...rest } = v;
  return json({
    code: { state: c.usedAt ? "used" : c.reserved ? "reserved" : Date.now() - c.createdAt > 90_000 ? "expired" : "live", mine: c.holder === holder, receiptIndex: c.holder === holder ? c.receiptIndex : undefined },
    promise: { ...rest, orderCount: orders.length, ordersFilled: orders.reduce((a, o) => a + o.filled, 0), attestations: attestations.map((a) => ({ phase: a.phase, capacity: a.capacity, sig: a.sig, ts: a.ts, error: a.error })) },
    receipt: mine, balance,
  });
}
