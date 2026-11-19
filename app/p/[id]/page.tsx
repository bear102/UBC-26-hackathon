"use client";
import { use, useEffect, useState } from "react";
import { getJSON, verify, usd, short, ex, type VerifyTick } from "@/lib/hh/client";
import type { PromiseView } from "@/lib/hh/views";

const PHASE = ["OPEN", "CUTOFF", "PRESETTLE"];

export default function PublicPromise({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [v, setV] = useState<PromiseView | null>(null);
  const [ticks, setTicks] = useState<{ ticks: VerifyTick[]; source: string } | null>(null);
  useEffect(() => { const f = () => getJSON<PromiseView>(`/api/promises/${id}`).then(setV).catch(() => {}); f(); const t = setInterval(f, 8000); return () => clearInterval(t); }, [id]);
  if (!v) return <main><span className="spin" /></main>;
  const oc = v.onchain;
  return (
    <main>
      <div className="row spread"><h1>{v.card.sentence}</h1><div className="row"><span className="pill">{v.status.replace(/_/g, " ")}</span>{v.mode === "paper" ? <span className="pill warn">PAPER HEDGE</span> : <span className="pill good">LIVE · {v.venue.host}</span>}</div></div>
      <p className="muted">{v.card.event_title} · {v.merchantName} · Gemini event <span className="mono">{v.card.event_ticker}</span> · hedged {v.mode === "paper" ? `PAPER against ${v.venue.host}` : `live on ${v.venue.host}`} · settles on {v.venue.resolveHost}</p>
      <div className="grid">
        <div className="card"><h3>Vault</h3><div className="huge">{usd(v.vaultBalance)}</div><p className="small"><a href={v.links.vault} target="_blank">vault</a> · <a href={v.links.promise} target="_blank">promise account</a> · <a href={v.links.program} target="_blank">program</a></p>
          {oc && <p className="small">sold {oc.sold} · hedged {oc.hedgedCapacity} · cap {oc.cap} · refunded {oc.refunded} · refund {usd(v.refundUnits / 1e6)} each</p>}</div>
        <div className="card"><h3>Hedge on Gemini</h3><p className="small">{v.orders.length} orders · {v.orders.reduce((a, o) => a + o.filled, 0)} contracts · premium {usd(v.premium)}</p>
          <p className="small"><a href={`/p/${id}/hedge.json`} target="_blank">hedge.json</a> (order ids, fills; Gemini can confirm them) · <a href={`/p/${id}/terms.json`} target="_blank">terms.json</a> (sha256 <span className="mono">{short(v.termsHash, 6)}</span>)</p>
          {oc && <p className="small">minimum hedge held after sales close: <b>{oc.heldBpsMin / 100}%</b></p>}</div>
      </div>
      <div className="card"><h3>Attestation timeline</h3>
        {v.attestations.filter((a) => !a.error).map((a, i) => <div key={i} className="small">{PHASE[a.phase]} · capacity {a.capacity} · {new Date(a.observedAt * 1000).toLocaleString()} · {a.sig && <a href={ex(a.sig)} target="_blank">tx</a>}</div>)}
        {v.outcome && <div className="small">OUTCOME · {v.outcome.yes ? `YES (${v.outcome.winning})` : "NO"} · hash <span className="mono">{short(v.outcome.hash, 6)}</span> {v.outcome.sig && <a href={ex(v.outcome.sig)} target="_blank">tx</a>}</div>}
      </div>
      {v.outcome && <div className="card"><button className="secondary" onClick={async () => setTicks(await verify({ id, resolveBase: v.venue.resolve, card: v.card, onchain: oc ? { status: oc.status, outcomeHash: oc.outcomeHash, winningSymbol: oc.winningSymbol, strip: oc.strip, refunded: oc.refunded } : null }))}>Verify with Gemini</button>
        {ticks && ticks.ticks.map((t, i) => <div className="tick" key={i}><span className={t.ok ? "ok" : t.ok === false ? "err" : "muted"}>{t.ok ? "✓" : t.ok === false ? "✗" : "…"}</span>{t.label}</div>)}{ticks && <p className="small muted">{ticks.source}</p>}</div>}
      <div className="card"><h3>Receipts</h3><table><thead><tr><th>#</th><th>holder</th><th>refund</th></tr></thead><tbody>{v.receipts.map((r) => <tr key={r.index}><td>{r.index}</td><td className="mono">{short(r.holder, 6)}</td><td>{r.refunded ? (r.refundSig ? <a href={ex(r.refundSig)} target="_blank">paid</a> : "paid") : "—"}</td></tr>)}</tbody></table></div>
      {v.merchantRecord && <div className="card small">Merchant onchain record: {v.merchantRecord.promisesCreated} promises · {v.merchantRecord.receiptsIssued} receipts · {v.merchantRecord.refundsPaid} refunds · hedge held {v.merchantRecord.cutoffHeldFull}× · breaks {v.merchantRecord.hedgeBreaks}</div>}
      <p className="footer">Our team is the demo merchant and also runs the attestor and relayer (disclosed). Neither Solana key can move vault funds. Refunds are devnet test USDC.</p>
    </main>
  );
}
