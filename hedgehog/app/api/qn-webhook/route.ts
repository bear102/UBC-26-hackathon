// QuickNode Streams / Webhooks destination (Solana). Accepts batched payloads (JSON or gzip), optional shared secret
// (QuickNode HMAC signature with QN_SECURITY_TOKEN, or QN_WEBHOOK_SECRET via x-qn-secret / x-webhook-secret / Bearer / ?secret=), records one FeedEvent per
// relevant tx, idempotent by signature (id = "qn:<sig>"). Always answers 200 quickly for well-formed requests.
import { NextResponse } from "next/server";
import { gunzipSync } from "node:zlib";
import { store } from "@/lib/store";
import { parseQnPayload } from "@/lib/venue/qnParse";
import { currentWatch } from "@/lib/venue/watch";
import { quicknodeSignatureOk } from "@/lib/venue/qnAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sharedSecretOk(req: Request): boolean {
  const secret = process.env.QN_WEBHOOK_SECRET;
  if (!secret) return false;
  const h = req.headers;
  const bearer = h.get("authorization")?.replace(/^Bearer\s+/i, "");
  const got = (h.get("x-qn-secret") || h.get("x-webhook-secret") || h.get("x-qn-api-key") || bearer || new URL(req.url).searchParams.get("secret") || "").trim();
  return got === secret;
}

export async function POST(req: Request) {
  const raw = Buffer.from(await req.arrayBuffer());
  const h = req.headers;
  const signed = quicknodeSignatureOk(process.env.QN_SECURITY_TOKEN, h.get("x-qn-nonce"), h.get("x-qn-timestamp"), h.get("x-qn-signature"), raw);
  const open = !process.env.QN_WEBHOOK_SECRET && !process.env.QN_SECURITY_TOKEN;
  if (!signed && !sharedSecretOk(req) && !open) {
    // Debug aid: header NAMES + value lengths only (never values), so a misconfigured stream can be diagnosed.
    const seen = [...h.entries()].filter(([k]) => /qn|secret|auth|signature|nonce|timestamp/i.test(k)).map(([k, v]) => `${k}(${v.length})`);
    console.warn("[qn-webhook] 401; auth-ish headers:", seen.join(", ") || "none");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let payload: unknown;
  try {
    const buf = raw.length > 1 && raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
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
  return NextResponse.json({ ok: true, endpoint: "quicknode-streams", secret: !!process.env.QN_WEBHOOK_SECRET, signature: !!process.env.QN_SECURITY_TOKEN });
}
