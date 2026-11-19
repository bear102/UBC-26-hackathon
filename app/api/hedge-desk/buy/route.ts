import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { buyDesk } from "@/lib/hh/hedgeDesk";
import { withLock } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
// Real orders, sandbox venue only (checked inside buyDesk). Merchant login + a typed max amount are required.
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const b = await body<{ event_ticker?: string; symbols?: string[]; payout_usd?: number; max_usd?: number }>(req);
  if (!b.event_ticker || !Array.isArray(b.symbols) || !b.symbols.length) return err("event_ticker and symbols required");
  try {
    const t = await withLock("desk", () => buyDesk({ event_ticker: b.event_ticker!, symbols: b.symbols!, payout_usd: Number(b.payout_usd), max_usd: Number(b.max_usd) }));
    return json(t);
  } catch (e) { return err(String((e as Error).message ?? e), 400); }
}
