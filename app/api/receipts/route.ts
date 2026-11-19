import { type NextRequest } from "next/server";
import { json, err, body } from "@/lib/hh/http";
import { issue } from "@/lib/hh/receipts";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const { code, holder } = await body<{ code?: string; holder?: string }>(req);
  if (!code || !holder) return err("code and holder required");
  const r = await issue(code, holder);
  return json(r, r.ok ? 200 : r.error === "UnknownCode" ? 404 : 200);
}
