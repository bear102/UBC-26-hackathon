// GET -> the 3 Austin demo presets (BusinessProfile & { tagline }), without fallback risks.
import { NextResponse } from "next/server";
import { publicPresets } from "@/lib/ai/presets";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(publicPresets());
}
