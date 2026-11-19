// QuickNode Streams delivery authentication (HMAC with the stream's security token).
import { createHmac, timingSafeEqual } from "node:crypto";

/** QuickNode Streams signature: hex HMAC-SHA256(securityToken, nonce + timestamp + rawBody); timestamp within 5 min. */
export function quicknodeSignatureOk(token: string | undefined, nonce: string | null, ts: string | null, sig: string | null, raw: Buffer): boolean {
  if (!token || !nonce || !ts || !sig) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const want = createHmac("sha256", Buffer.from(token)).update(Buffer.concat([Buffer.from(nonce + ts), raw])).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(sig.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
