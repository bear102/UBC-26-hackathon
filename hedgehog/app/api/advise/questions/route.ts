// POST { profile: BusinessProfile } -> { questions: ClarifyQuestion[], model } (0-3 quick questions; [] when none are needed).
// One fast-tier LLM call (cached per profile for an hour); keyword fallback on any failure, so this never 5xxs on LLM trouble.
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { clarifyQuestions } from "@/lib/ai/clarify";
import { clarifyProfileSchema } from "@/lib/ai/clarifySchemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({ profile: clarifyProfileSchema });

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "body must be JSON" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const p = parsed.data.profile;
  const out = await clarifyQuestions({ ...p, id: p.id || p.presetId || "biz" });
  return NextResponse.json(out);
}
