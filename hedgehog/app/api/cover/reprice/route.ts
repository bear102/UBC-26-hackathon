// POST { lines: [{ marketRef, side }] } -> { lines: [{ marketRef, side, ask | null, error? }] }
// Live ask per line, from the same contract lookup the buy routes use, so the plan can re-price itself after a
// "price moved" refusal without re-running the AI. Read-only: builds no transaction.
import { NextResponse } from "next/server";
import { z } from "zod";
import { defaultGetContract } from "@/lib/venue";
import { askFor } from "@/lib/venue/pricing";
import { fitsOnchain } from "@/lib/markets/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ lines: z.array(z.object({ marketRef: z.string().min(1).max(200), side: z.enum(["yes", "no"]).default("yes") })).min(1).max(20) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "body must be { lines: [{ marketRef, side }] }", code: "bad_request" }, { status: 400 });
  const lines = await Promise.all(parsed.data.lines.map(async ({ marketRef, side }) => {
    try {
      const c = await defaultGetContract(marketRef);
      if (!c) return { marketRef, side, ask: null, error: "market not found" };
      if (c.status !== "open") return { marketRef, side, ask: null, error: `market is ${c.status}` };
      if (!fitsOnchain(c.id)) return { marketRef, side, ask: null, error: "market is not coverable" };
      const ask = askFor(c, side);
      return { marketRef, side, ask: ask != null && ask > 0 && ask < 1 ? ask : null, ...(ask == null ? { error: "no ask" } : {}) };
    } catch (e) {
      return { marketRef, side, ask: null, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return NextResponse.json({ lines, at: new Date().toISOString() });
}
