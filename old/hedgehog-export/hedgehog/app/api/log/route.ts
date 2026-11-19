import { type NextRequest } from "next/server";
import { json, requireAdmin } from "@/lib/hh/http";
import { load } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  return json({ log: load().log.slice(-200).reverse() });
}
