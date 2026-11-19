import { type NextRequest } from "next/server";
import { json, err, requireAdmin } from "@/lib/hh/http";
import { deskTickets, deskMax } from "@/lib/hh/hedgeDesk";
import { env } from "@/lib/hh/env";
import { isSandbox, hostOf, liveCapable } from "@/lib/hh/venue";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
export async function GET(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  try {
    return json({ tickets: deskTickets(), buyEnabled: liveCapable() && isSandbox(env.geminiTrade()), tradeHost: hostOf(env.geminiTrade()), dataHost: hostOf(env.geminiPublic()), maxUsd: deskMax() });
  } catch (e) { return err(String((e as Error)?.message ?? e) || "desk unavailable", 500); }
}
