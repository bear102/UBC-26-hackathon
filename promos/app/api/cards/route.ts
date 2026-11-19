import { type NextRequest } from "next/server";
import { json, err } from "@/lib/hh/http";
import { templateCards, quoteCard } from "@/lib/hh/catalog";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const refund = Number(req.nextUrl.searchParams.get("refund") || 1);
    const cards = await templateCards();
    return json({ cards: await Promise.all(cards.map((c) => quoteCard(c, refund))), source: "template" });
  } catch (e) { return err(String(e), 502); }
}
