import { type NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") || "";
  const ok = !process.env.HH_ADMIN_TOKEN || t === process.env.HH_ADMIN_TOKEN;
  const res = NextResponse.redirect(new URL(ok ? "/merchant" : "/merchant?denied=1", req.nextUrl.origin.replace(/^http:\/\/0\.0\.0\.0/, "http://localhost")));
  if (ok && t) res.cookies.set("hh_admin", t, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 86400 });
  return res;
}
