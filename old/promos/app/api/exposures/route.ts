import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { scanExposures } from "@/lib/hh/exposure";
import { within } from "@/lib/hh/llm";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TIMEOUT = Symbol("timeout");
export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  const { text, fresh } = await body<{ text?: unknown; fresh?: boolean }>(req);
  if (typeof text !== "string" || !text.trim()) return err("describe the business", 400);
  try {
    const r = await within<Awaited<ReturnType<typeof scanExposures>> | typeof TIMEOUT>(scanExposures(text.slice(0, 400), { fresh: !!fresh }), 45_000, TIMEOUT);
    if (r === TIMEOUT) return err("The scan took too long (Gemini or the AI is slow). Try again; the market list is cached now.", 504);
    return json(r);
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return err(String((e as Error)?.message ?? e) || "scan failed", typeof status === "number" && status >= 400 && status < 600 ? status : 502);
  }
}
