import { type NextRequest } from "next/server";
import { json, err, isAdmin } from "@/lib/hh/http";
import { promiseView } from "@/lib/hh/views";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const v = await promiseView(id, { admin: isAdmin(req) && !!process.env.HH_ADMIN_TOKEN });
  return v ? json(v) : err("not found", 404);
}
