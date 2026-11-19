import { json, err } from "@/lib/hh/http";
import { load } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = load().promises[(await ctx.params).id];
  return p ? json({ terms: p.terms, termsHash: p.termsHash, how: "sha256 of JSON.stringify with keys sorted at every level, no whitespace" }) : err("not found", 404);
}
