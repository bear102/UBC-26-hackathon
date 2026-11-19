import { type NextRequest } from "next/server";
import { json, err, body } from "@/lib/hh/http";
import { sessionOk, newCode } from "@/lib/hh/receipts";
import { env } from "@/lib/hh/env";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const { promiseId } = await body<{ promiseId: string }>(req);
  const token = req.cookies.get(`hh_counter_${promiseId}`)?.value;
  if (!sessionOk(token, promiseId)) return err("counter session required: open the counter from the merchant console", 401);
  const c = newCode(token!, promiseId);
  return json({ ...c, url: `${env.publicUrl()}/r/${c.code}` });
}
