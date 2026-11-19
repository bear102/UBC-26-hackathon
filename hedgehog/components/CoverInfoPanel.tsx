"use client";
import { useEffect, useState } from "react";
import { getCoverInfo } from "@/lib/client/api";
import type { CoverInfo } from "@/lib/fixtures";
import { explorerAddr, usd } from "@/lib/client/format";

export function CoverInfoPanel() {
  const [info, setInfo] = useState<CoverInfo | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { getCoverInfo().then(setInfo).catch(() => setErr(true)); }, []);
  if (err) return <div className="empty">Program info unavailable.</div>;
  if (!info) return <div className="card muted">Loading onchain addresses…</div>;
  const rows: [string, string][] = [
    ["Program (hedgehog_policy)", info.programId], ["Underwriter PDA", info.underwriterPda], ["USDC vault", info.vault], ["Test USDC mint", info.mint],
  ];
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Hedgehog Cover — live on devnet</h3>
        <span className="badge badge-devnet">Devnet</span>
      </div>
      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div className="card-soft"><span className="xs muted">Vault balance</span><div className="num pay" style={{ fontSize: "1.4rem", fontWeight: 700 }}>{usd(info.vaultBalance)}</div></div>
        <div className="card-soft"><span className="xs muted">Open exposure</span><div className="num cost" style={{ fontSize: "1.4rem", fontWeight: 700 }}>{usd(info.exposure)}</div></div>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd><a className="mono small" href={explorerAddr(v)} target="_blank" rel="noreferrer">{v} ↗</a></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
