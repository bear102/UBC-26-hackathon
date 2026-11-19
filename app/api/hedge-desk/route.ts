import { type NextRequest } from "next/server";
import { json, requireAdmin } from "@/lib/hh/http";
import { deskTickets, deskMax } from "@/lib/hh/hedgeDesk";
import { env } from "@/lib/hh/env";
import { isSandbox, hostOf, liveCapable } from "@/lib/hh/venue";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny;
  return json({ tickets: deskTickets(), buyEnabled: liveCapable() && isSandbox(env.geminiTrade()), tradeHost: hostOf(env.geminiTrade()), dataHost: hostOf(env.geminiPublic()), maxUsd: deskMax() });
}
