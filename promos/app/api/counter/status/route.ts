import { type NextRequest } from "next/server";
import { json, err } from "@/lib/hh/http";
import { sessionOk, codeStatus } from "@/lib/hh/receipts";
import { load } from "@/lib/hh/store";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "";
  const c = load().codes[code];
  if (!c) return err("unknown", 404);
  if (!sessionOk(req.cookies.get(`hh_counter_${c.promiseId}`)?.value, c.promiseId)) return err("counter session required", 401);
  return json(codeStatus(code));
}
