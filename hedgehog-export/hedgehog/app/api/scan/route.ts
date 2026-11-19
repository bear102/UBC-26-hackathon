import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { scan } from "@/lib/hh/scan";
import { quoteCard } from "@/lib/hh/catalog";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const { text, refund } = await body<{ text?: string; refund?: number }>(req);
  if (!text?.trim()) return err("describe the business");
  try {
    const r = await scan(text);
    const quoted = await Promise.all(r.cards.map((c) => quoteCard(c, refund || 1).catch(() => null)));
    return json({ ...r, cards: quoted.filter(Boolean) });
  } catch (e) { return err(String(e), 502); }
}
