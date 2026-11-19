import { type NextRequest } from "next/server";
import { json, err, body } from "@/lib/hh/http";
import { cosign } from "@/lib/hh/cosign";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const { tx } = await body<{ tx?: string }>(req);
  if (!tx) return err("tx required");
  const r = await cosign(tx);
  return json(r, r.ok ? 200 : 400);
}
