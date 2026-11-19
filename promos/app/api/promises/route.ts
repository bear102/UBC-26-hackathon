import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { createPromise } from "@/lib/hh/engine";
import { load, type Card } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export async function GET() {
  const s = load();
  return json({ promises: Object.values(s.promises).sort((a, b) => b.createdAt - a.createdAt).map(({ eventSnapshot, terms, ...p }) => p), agent: s.agent, budget: s.budget });
}
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const b = await body<{ card: Card; cap?: number; refundUsd?: number; topupThreshold?: number; tranche?: number; salesCloseTs?: number; merchantName?: string; testLabel?: string; adopt?: Record<string, number> }>(req);
  if (!b.card?.event_ticker || !b.card.strip?.length) return err("card required");
  try {
    const rec = await createPromise({ card: b.card, cap: Math.max(1, Math.min(500, Math.floor(b.cap ?? 20))), refundUsd: b.refundUsd ?? 1, topupThreshold: b.topupThreshold ?? 3, tranche: b.tranche, salesCloseTs: b.salesCloseTs, merchantName: b.merchantName, testLabel: b.testLabel, adopt: b.adopt });
    return json({ id: rec.id, pda: rec.pda });
  } catch (e) { return err(String((e as Error).message ?? e), 400); }
}
