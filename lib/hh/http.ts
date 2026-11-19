// Route helpers: JSON responses, admin (merchant) auth via HH_ADMIN_TOKEN cookie/header.
import { NextResponse, type NextRequest } from "next/server";

export const json = (v: unknown, status = 200) => NextResponse.json(v, { status, headers: { "cache-control": "no-store" } });
export const err = (msg: string, status = 400, extra: Record<string, unknown> = {}) => json({ error: msg, ...extra }, status);

export function isAdmin(req: NextRequest): boolean {
  const want = process.env.HH_ADMIN_TOKEN;
  if (!want) return true; // local dev without a token
  const got = req.headers.get("x-hh-admin") || req.cookies.get("hh_admin")?.value;
  return got === want;
}
export function requireAdmin(req: NextRequest) {
  return isAdmin(req) ? null : err("Not logged in as the merchant: open /api/login?t=<HH_ADMIN_TOKEN> once in this browser", 401);
}
export async function body<T>(req: NextRequest): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
