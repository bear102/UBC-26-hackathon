// GET /api/tax/record?owner=<pubkey>&year=<yyyy>&format=json|csv&tz=<IANA>&fresh=1
// Every Hedgehog Cover premium / payout / refund for one wallet, read from Solana devnet (lib/tax/record.ts).
// Owner-scoped: a wallet sees its own policies, test ones included (lib/visibility only applies to unscoped lists).
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { taxRecord } from "@/lib/tax/record";
import { toCsv } from "@/lib/tax/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const owner = q.get("owner") ?? "";
  try { if (!owner || !PublicKey.isOnCurve(new PublicKey(owner).toBytes())) throw new Error(); }
  catch { return NextResponse.json({ error: "owner must be a wallet address", code: "bad_request" }, { status: 400 }); }
  const y = q.get("year");
  const year = y ? Number(y) : null;
  if (y && !(Number.isInteger(year) && year! >= 2020 && year! <= 2100)) return NextResponse.json({ error: "bad year", code: "bad_request" }, { status: 400 });
  const format = q.get("format") === "csv" ? "csv" : "json";
  let tz = q.get("tz") || "America/Chicago";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "America/Chicago"; }

  try {
    const rec = await taxRecord(owner, { year, tz, fresh: q.get("fresh") === "1" });
    if (format === "csv") {
      const name = `hedgehog-cover-${owner.slice(0, 6)}-${year ?? "all"}.csv`;
      return new NextResponse(toCsv(rec.rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}"`,
          "x-provenance": rec.provenance,
        },
      });
    }
    return NextResponse.json(rec);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), code: "rpc_error" }, { status: 502 });
  }
}
