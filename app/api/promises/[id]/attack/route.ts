import { type NextRequest } from "next/server";
import { PublicKey, Keypair } from "@solana/web3.js";
import { json, err, body, requireAdmin } from "@/lib/hh/http";
import { load, mutate, log, randomCode, sha256 } from "@/lib/hh/store";
import { key, send, readPromise, explorer } from "@/lib/hh/chain";
import * as P from "@/lib/hh/program";
import { canonicalResolution } from "@/lib/hh/canon";
export const dynamic = "force-dynamic";
// Prebuilt attacks (§6.2). Failing txs are sent with skipPreflight so they land onchain with logs.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = requireAdmin(req); if (deny) return deny;
  const { id } = await ctx.params;
  const rec = load().promises[id];
  if (!rec) return err("not found", 404);
  const { n } = await body<{ n: number }>(req);
  const pda = new PublicKey(rec.pda);
  const merchant = key("merchant");
  let r;
  let label = "";
  if (n === 1 || n === 4) {
    label = n === 1 ? "Sell one more receipt than the hedge covers" : "Issue a receipt after sales close";
    const p = await readPromise(pda);
    if (!p) return err("promise missing");
    const holder = Keypair.generate().publicKey;
    r = await send([await P.ixIssueReceipt(merchant.publicKey, pda, p.sold, holder, sha256(randomCode()))], [merchant], { skipPreflight: true });
  } else if (n === 2) {
    label = "Merchant pulls the vault before settlement";
    r = await send([await P.ixRelease(merchant.publicKey, pda)], [merchant], { skipPreflight: true });
  } else if (n === 3) {
    label = "Merchant posts the outcome itself (NO)";
    void canonicalResolution;
    r = await send([await P.ixAttestOutcome(merchant.publicKey, pda, merchant.publicKey, "", new Uint8Array(32), Math.floor(Date.now() / 1000))], [merchant], { skipPreflight: true });
  } else return err("unknown attack");
  const out = { n, label, ok: r.ok, error: r.ok ? null : r.name ?? r.message, code: r.ok ? null : r.code ?? null, sig: r.sig ?? null, explorer: r.sig ? explorer(r.sig) : null };
  mutate((s) => { s.log.push({ ts: Date.now(), level: r.ok ? "warn" : "info", scope: "attack", msg: `${label}: ${r.ok ? "SUCCEEDED (!)" : `blocked by ${out.error}`}`, data: out }); });
  log("info", "attack", `${label} → ${out.error ?? "ok"} ${out.sig ?? ""}`);
  return json(out);
}
