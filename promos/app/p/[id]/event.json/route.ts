import { json, err } from "@/lib/hh/http";
import { load } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = load().promises[(await ctx.params).id];
  if (!p?.eventSnapshot) return err("no snapshot yet", 404);
  return json({ fetchedAt: p.eventSnapshotAt, event: p.eventSnapshot });
}
