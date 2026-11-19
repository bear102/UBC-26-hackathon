// POST { profile: BusinessProfile, coveragePct?: 25|50|100 } -> Quote & { id } (also stored in .data/quotes.json)
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { advise } from "@/lib/ai/advisor";
import { store } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const profileSchema = z.object({
  id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(3).max(2000),
  city: z.string().trim().max(80).default("Austin, TX"),
  zip: z.string().trim().max(10).optional(),
  avgDailyRevenueUsd: z.coerce.number().positive().max(10_000_000),
  busyDays: z.array(z.string().trim().max(12)).max(7).default([]),
  monthlyBudgetUsd: z.coerce.number().min(0).max(1_000_000),
  presetId: z.string().trim().max(80).optional(),
});
const bodySchema = z.object({
  profile: profileSchema,
  coveragePct: z.coerce.number().min(1).max(100).optional(),
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "biz";

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "body must be JSON" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const { profile: p, coveragePct } = parsed.data;
  const profile = { ...p, id: p.id || p.presetId || `${slug(p.name)}-${Math.random().toString(36).slice(2, 7)}` };
  try {
    const quote = await advise(profile, { coveragePct });
    const id = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const row = store.upsert("quotes", { ...quote, id });
    return NextResponse.json(row);
  } catch (e) {
    console.error("[api/advise]", (e as Error).message);
    return NextResponse.json({ error: "advisor failed", detail: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
