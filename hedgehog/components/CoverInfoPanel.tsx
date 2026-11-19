"use client";
import { useEffect, useState } from "react";
import { getCoverInfo } from "@/lib/client/api";
import type { CoverInfo } from "@/lib/fixtures";
import { explorerAddr, usd } from "@/lib/client/format";
import { IconExternal } from "./Icons";

export function CoverInfoPanel() {
  const [info, setInfo] = useState<CoverInfo | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { getCoverInfo().then(setInfo).catch(() => setErr(true)); }, []);
  if (err) return <div className="empty">Program info unavailable.</div>;
  if (!info) return <div className="empty">Loading onchain addresses…</div>;
  const rows: [string, string][] = [
    ["Program (hedgehog_policy)", info.programId], ["Underwriter PDA", info.underwriterPda], ["USDC vault", info.vault], ["Test USDC mint", info.mint],
  ];
  return (
    <div className="card">
      <div className="doc-head">
        <span className="caps-title">Hedgehog Cover — live on devnet</span>
        <span className="badge badge-devnet">Devnet</span>
      </div>
      <div className="terms" style={{ marginBottom: 16 }}>
        <div className="term pay"><span className="lab">Vault balance</span><span className="amt" style={{ fontSize: 36 }}>{usd(info.vaultBalance)}</span></div>
        <div className="term cost"><span className="lab">Open exposure</span><span className="amt" style={{ fontSize: 36 }}>{usd(info.exposure)}</span></div>
      </div>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd><a className="mono small" href={explorerAddr(v)} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{v} <IconExternal size={11} /></a></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
