// QuickNode Streams / Webhooks destination (Solana). Accepts batched payloads (JSON or gzip), optional shared secret
// (QN_WEBHOOK_SECRET via x-qn-secret / x-webhook-secret / Authorization: Bearer / ?secret=), records one FeedEvent per
// relevant tx, idempotent by signature (id = "qn:<sig>"). Always answers 200 quickly for well-formed requests.
import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { store } from "@/lib/store";
import { parseQnPayload } from "@/lib/venue/qnParse";
import { currentWatch } from "@/lib/venue/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.QN_WEBHOOK_SECRET;
  if (!secret) return true;
  const h = req.headers;
  const bearer = h.get("authorization")?.replace(/^Bearer\s+/i, "");
  const got = h.get("x-qn-secret") || h.get("x-webhook-secret") || h.get("x-qn-api-key") || bearer || new URL(req.url).searchParams.get("secret");
  return got === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let payload: unknown;
  try {
    let buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
    payload = buf.length ? JSON.parse(buf.toString("utf8")) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "bad payload" }, { status: 400 });
  }
  let recorded = 0;
  try {
    const hits = parseQnPayload(payload, currentWatch());
    for (const h of hits) {
      store.feed({ id: `qn:${h.signature}`, source: "quicknode", kind: h.kind, text: h.text, txSig: h.signature, positionId: h.positionId });
      recorded++;
    }
  } catch (e) {
    console.error("[qn-webhook]", (e as Error).message); // never make QuickNode retry-storm on our bugs
  }
  return NextResponse.json({ ok: true, recorded });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "quicknode-streams", secret: !!process.env.QN_WEBHOOK_SECRET });
}
