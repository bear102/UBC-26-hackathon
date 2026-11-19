import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { buyDesk } from "@/lib/hh/hedgeDesk";
import { withLock } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
// Real orders, sandbox venue only (checked inside buyDesk). Merchant login + a typed max amount are required.
// No request-level timeout here on purpose: once orders are sent we must wait for the result and store the ticket
// (every upstream call inside buyDesk is itself time-bounded: quote ≤ ~15 s, Gemini order ≤ 15 s, memo ≤ 30 s).
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const b = await body<{ event_ticker?: unknown; symbols?: unknown; payout_usd?: number; max_usd?: number; outcome?: unknown }>(req);
  if (typeof b.event_ticker !== "string" || !b.event_ticker || !Array.isArray(b.symbols) || !b.symbols.length || !b.symbols.every((s) => typeof s === "string"))
    return err("event_ticker and symbols required", 400);
  if (!(Number(b.max_usd) > 0)) return err("type the most you'll pay", 400);
  if (!(Number(b.payout_usd) >= 1)) return err("choose a payout of at least $1", 400);
  try {
    const t = await withLock("desk", () => buyDesk({ event_ticker: b.event_ticker as string, symbols: b.symbols as string[], payout_usd: Number(b.payout_usd), max_usd: Number(b.max_usd), outcome: b.outcome === "no" ? "no" : "yes" }));
    return json(t);
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return err(String((e as Error)?.message ?? e) || "buy failed", typeof status === "number" && status >= 400 && status < 600 ? status : 400);
  }
}
