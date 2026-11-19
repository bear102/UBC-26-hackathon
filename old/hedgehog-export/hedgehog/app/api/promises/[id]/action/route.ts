import { type NextRequest } from "next/server";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { hedge, attest, relay, crank, release, closeReceipts } from "@/lib/hh/engine";
import { load, mutate, log } from "@/lib/hh/store";
import { openCounter } from "@/lib/hh/receipts";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireAdmin(req); if (deny) return deny;
  const { id } = await ctx.params;
  if (!load().promises[id]) return err("not found", 404);
  const { action } = await body<{ action: string }>(req);
  try {
    switch (action) {
      case "hedge": return json(await hedge(id, "revert"));
      case "attest-open": return json(await attest(id, 0));
      case "attest-cutoff": return json(await attest(id, 1));
      case "relay": return json({ result: await relay(id) });
      case "crank": return json({ sigs: await crank(id) });
      case "release": { const r = await release(id); return json(r); }
      case "close-receipts": return json({ sigs: await closeReceipts(id) });
      case "stop-agent": mutate((s) => { s.agent.halted = true; s.agent.haltReason = "stopped by operator"; }); log("warn", "agent", "halted by operator"); return json({ ok: true });
      case "resume-agent": mutate((s) => { s.agent.halted = false; s.agent.haltReason = undefined; }); return json({ ok: true });
      case "set-threshold": { const b2 = await body<{ value: number }>(req); mutate((s) => { s.promises[id].topupThreshold = Number(b2.value); }); return json({ ok: true }); }
      case "counter": {
        const token = openCounter(id);
        const res = json({ ok: true, url: `/counter/${id}` });
        res.cookies.set(`hh_counter_${id}`, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
        return res;
      }
      default: return err("unknown action");
    }
  } catch (e) { return err(String((e as Error).message ?? e), 500); }
}
