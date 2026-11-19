import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { quoteDesk } from "@/lib/hh/hedgeDesk";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const b = await body<{ event_ticker?: string; symbols?: string[]; payout_usd?: number }>(req);
  if (!b.event_ticker || !Array.isArray(b.symbols) || !b.symbols.length) return err("event_ticker and symbols required");
  try { return json(await quoteDesk({ event_ticker: b.event_ticker, symbols: b.symbols, payout_usd: Number(b.payout_usd) || 100 })); }
  catch (e) { return err(String((e as Error).message ?? e), 502); }
}
