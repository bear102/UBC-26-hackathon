"use client";
import { useEffect, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { getJSON, getKeypair, usd, ex, short } from "@/lib/hh/client";

type W = { holder: string; balance: number | null; receipts: { promiseId: string; index: number; sentence?: string; merchantName?: string; status?: string; refunded: boolean; refundSig?: string; code: string; refundUsd: number }[] };

export default function Wallet() {
  const [kp, setKp] = useState<Keypair | null>(null);
  const [w, setW] = useState<W | null>(null);
  useEffect(() => { const k = getKeypair(); setKp(k); if (location.hash) history.replaceState(null, "", "/w"); getJSON<W>(`/api/wallet?holder=${k.publicKey.toBase58()}`).then(setW); }, []);
  return (
    <main className="narrow">
      <h1>My receipts</h1>
      {kp && <p className="small muted">Key {short(kp.publicKey.toBase58(), 6)} (stored in this browser)</p>}
      {w && <div className="card"><div className="muted small">Balance</div><div className="huge">{w.balance == null ? "$0.00" : usd(w.balance)}</div><div className="small muted">test USDC</div></div>}
      {w?.receipts.length === 0 && <p className="muted">No receipts on this device yet.</p>}
      {w?.receipts.map((r) => (
        <a key={`${r.promiseId}-${r.index}`} href={`/r/${r.code}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card row spread">
            <div><b>{r.sentence}</b><div className="small muted">{r.merchantName} · receipt #{r.index}</div></div>
            <span className={`pill ${r.refunded ? "good" : ""}`}>{r.refunded ? `${usd(r.refundUsd)} paid` : (r.status ?? "").replace(/_/g, " ")}</span>
          </div>
        </a>
      ))}
      {w?.receipts.some((r) => r.refundSig) && <p className="small">{w.receipts.filter((r) => r.refundSig).map((r) => <a key={r.refundSig} href={ex(r.refundSig!)} target="_blank" style={{ marginRight: 8 }}>payout tx</a>)}</p>}
    </main>
  );
}
