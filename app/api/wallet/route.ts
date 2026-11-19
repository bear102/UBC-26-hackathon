import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { json, err } from "@/lib/hh/http";
import { load } from "@/lib/hh/store";
import { tokenBalance } from "@/lib/hh/chain";
import * as P from "@/lib/hh/program";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const holder = req.nextUrl.searchParams.get("holder") || "";
  let pk: PublicKey; try { pk = new PublicKey(holder); } catch { return err("bad holder"); }
  const s = load();
  const receipts = s.receipts.filter((r) => r.holder === holder).map((r) => {
    const p = s.promises[r.promiseId];
    return { promiseId: r.promiseId, index: r.index, sentence: p?.card.sentence, merchantName: p?.merchantName, status: p?.status, refunded: !!r.refunded, refundSig: r.refundSig, code: r.code, refundUsd: (p?.refundUnits ?? 0) / 1e6 };
  });
  return json({ holder, balance: await tokenBalance(P.usdcAta(pk)), receipts });
}
