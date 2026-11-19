import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { scanExposures } from "@/lib/hh/exposure";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const { text, fresh } = await body<{ text?: string; fresh?: boolean }>(req);
  if (!text?.trim()) return err("describe the business");
  try { return json(await scanExposures(text.slice(0, 400), { fresh: !!fresh })); }
  catch (e) { return err(String((e as Error).message ?? e), 502); }
}
