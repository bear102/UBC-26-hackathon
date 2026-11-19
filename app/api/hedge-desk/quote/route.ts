import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { quoteDesk } from "@/lib/hh/hedgeDesk";
import { within } from "@/lib/hh/llm";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const TIMEOUT = Symbol("timeout");
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const b = await body<{ event_ticker?: unknown; symbols?: unknown; payout_usd?: number; outcome?: unknown }>(req);
  if (typeof b.event_ticker !== "string" || !b.event_ticker || !Array.isArray(b.symbols) || !b.symbols.length || !b.symbols.every((s) => typeof s === "string"))
    return err("event_ticker and symbols required", 400);
  try {
    const q = await within<Awaited<ReturnType<typeof quoteDesk>> | typeof TIMEOUT>(
      quoteDesk({ event_ticker: b.event_ticker, symbols: b.symbols as string[], payout_usd: Number(b.payout_usd) || 100, outcome: b.outcome === "no" ? "no" : "yes" }), 20_000, TIMEOUT);
    if (q === TIMEOUT) return err("Gemini took too long to quote this cover; try again", 504);
    return json(q);
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return err(String((e as Error)?.message ?? e) || "quote failed", typeof status === "number" && status >= 400 && status < 600 ? status : 502);
  }
}
