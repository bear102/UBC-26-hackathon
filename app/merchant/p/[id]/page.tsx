"use client";
import { use, useEffect, useState } from "react";
import { getJSON, post, usd, short, ex } from "@/lib/hh/client";
import type { PromiseView } from "@/lib/hh/views";

const PHASE = ["OPEN", "CUTOFF", "PRESETTLE"];
const STATUS_LABEL: Record<string, string> = { HEDGING: "HEDGING", HEDGE_FAILED: "HEDGE FAILED", SELLING: "SELLING", CLOSED_FOR_SALES: "CLOSED FOR SALES", SETTLED_YES: "SETTLED: CUSTOMERS PAID", SETTLED_NO: "SETTLED: NO REFUND", CLOSED: "CLOSED" };

export default function Console({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [v, setV] = useState<PromiseView | null>(null);
  const [out, setOut] = useState<string>("");
  const [attacks, setAttacks] = useState<{ n: number; label: string; error: string | null; code: number | null; explorer: string | null; ok: boolean }[]>([]);
  const [busy, setBusy] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const load = () => getJSON<PromiseView>(`/api/promises/${id}`).then((x) => { setV(x); setLoadErr(""); }).catch((e) => setLoadErr(String(e.message)));
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [id]);
  if (!v) return <main>{loadErr ? <p className="err">{loadErr}</p> : <p><span className="spin" /> Loading…</p>}</main>;
  const oc = v.onchain;
  async function act(action: string) {
    setBusy(action); setOut("");
    try { const r = await post<Record<string, unknown>>(`/api/promises/${id}/action`, { action }); setOut(JSON.stringify(r)); if (action === "counter" && r.url) window.open(String(r.url), "_blank"); }
    catch (e) { setOut(String(e)); } finally { setBusy(""); load(); }
  }
  async function attack(n: number) {
    setBusy(`a${n}`);
    try { const r = await post<{ n: number; label: string; error: string | null; code: number | null; explorer: string | null; ok: boolean }>(`/api/promises/${id}/attack`, { n }); setAttacks((a) => [r, ...a]); }
    catch (e) { setOut(String((e as Error).message)); }
    finally { setBusy(""); load(); }
  }
  const sold = oc?.sold ?? 0, hedged = oc?.hedgedCapacity ?? 0, cap = v.cap;
  return (
    <main>
      <div className="row spread">
        <div><a href="/merchant" className="small">← all promises</a><h1>{v.card.sentence}</h1><div className="muted small">{v.card.event_title} · {v.merchantName} · {v.mode === "paper" ? `paper against ${v.venue.host}${v.venue.why ? ` (${v.venue.why})` : ""}` : `live orders on ${v.venue.host}`} · settles on {v.venue.resolveHost}</div></div>
        <div className="row"><span className="pill">{STATUS_LABEL[v.status] ?? v.status}</span>{v.mode === "paper" ? <span className="pill warn">PAPER HEDGE</span> : <span className="pill good">LIVE · {v.venue.host}</span>}{v.testLabel && <span className="pill warn">{v.testLabel}</span>}</div>
      </div>
      {v.agentNote && <div className="banner" style={{ marginTop: 10 }}>Agent: {v.agentNote}</div>}

      <div className="grid">
        <div className="card">
          <h3>Capacity</h3>
          <div className="row" style={{ gap: 24 }}><div className="stat"><span className="muted small">Sold</span><b>{sold}</b></div><div className="stat"><span className="muted small">Hedged</span><b>{hedged}</b></div><div className="stat"><span className="muted small">Cap</span><b>{cap}</b></div><div className="stat"><span className="muted small">Refunded</span><b>{oc?.refunded ?? 0}</b></div></div>
          <div className="bar" style={{ marginTop: 10 }}><span style={{ width: `${(hedged / cap) * 100}%`, background: "color-mix(in srgb, var(--accent) 35%, transparent)" }} /><span style={{ width: `${(sold / cap) * 100}%`, background: "var(--accent)" }} /></div>
          <p className="small muted">{v.topupThreshold < 0 ? "Next tranche auto-buys on demand (when a sale bounces Unhedged)." : `Auto top-up when ${v.topupThreshold} hedged receipts remain.`}</p>
          <div className="row"><button onClick={() => act("counter")} disabled={!!busy}>Open counter QR</button><a className="btn secondary" href={`/p/${id}`} target="_blank">Public page</a></div>
        </div>
        <div className="card">
          <h3>Vault</h3>
          <div className="huge">{usd(v.vaultBalance)}</div>
          <p className="small muted">Locked for {cap} customers at {usd(v.refundUnits / 1e6)} each. The merchant can’t touch it until settlement.</p>
          <p className="small"><a href={v.links.vault} target="_blank">vault {short(v.vault)}</a> · <a href={v.links.promise} target="_blank">promise {short(v.pda)}</a>{v.links.create && <> · <a href={v.links.create} target="_blank">create tx</a></>}</p>
          <div className="row"><button className="secondary" onClick={() => act("release")} disabled={!!busy}>Release vault</button><button className="secondary" onClick={() => act("crank")} disabled={!!busy}>Run crank</button><button className="secondary" onClick={() => act("relay")} disabled={!!busy}>Check outcome</button></div>
        </div>
      </div>

      <div className="card">
        <div className="row spread"><h3>Gemini hedge {v.mode === "paper" && <span className="pill warn">PAPER: simulated fills on the live book</span>}</h3><span className="small">premium so far <b>{usd(v.premium)}</b></span></div>
        <table><thead><tr><th>order id</th><th>side</th><th>contract</th><th>qty</th><th>limit</th><th>filled</th><th>avg</th><th>status</th></tr></thead>
          <tbody>{v.orders.map((o) => <tr key={o.orderId}><td className="mono">{o.orderId}</td><td>{o.side.toUpperCase()} YES</td><td className="mono">{o.symbol.replace(/^GEMI-/, "")}</td><td>{o.qty}</td><td>{o.price.toFixed(2)}</td><td>{o.filled}</td><td>{o.avgPx?.toFixed(2) ?? "—"}</td><td>{o.status}</td></tr>)}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}><button className="secondary" onClick={() => act("hedge")} disabled={!!busy}>Buy next tranche</button><button className="secondary" onClick={() => act("attest-open")} disabled={!!busy}>Re-attest</button><button className="danger" onClick={() => act("stop-agent")}>Stop agent</button><button className="secondary" onClick={() => act("resume-agent")}>Resume agent</button></div>
      </div>

      <div className="card">
        <h3>Attestations</h3>
        <table><thead><tr><th>phase</th><th>capacity</th><th>per-bin (contracts)</th><th>latency</th><th>tx</th></tr></thead>
          <tbody>{v.attestations.map((a, i) => <tr key={i}><td>{PHASE[a.phase]}</td><td>{a.capacity}</td><td className="mono">{a.qtyCenti.map((q) => (q / 100).toString()).join(", ")}</td><td>{a.latencyMs ? `${a.latencyMs} ms` : ""}</td><td>{a.sig ? <a href={ex(a.sig)} target="_blank">{short(a.sig, 6)}</a> : ""} {a.error && <span className="err">{a.error}</span>}</td></tr>)}</tbody></table>
        {oc && <p className="small">held at cutoff {oc.phasesDone & 2 ? `${oc.heldBpsCutoff / 100}%` : "—"} · minimum held {oc.heldBpsMin / 100}% · onchain status {oc.status}{oc.winningSymbol && <> · winner <span className="mono">{oc.winningSymbol}</span></>}{oc.outcomeHash && !/^0+$/.test(oc.outcomeHash) && <> · outcome hash <span className="mono">{short(oc.outcomeHash, 6)}</span></>}</p>}
        {v.merchantRecord && <p className="small muted">Merchant record: {v.merchantRecord.promisesCreated} promises · {v.merchantRecord.receiptsIssued} receipts · {v.merchantRecord.refundsPaid} refunds paid · hedge held at cutoff {v.merchantRecord.cutoffHeldFull}× · hedge breaks {v.merchantRecord.hedgeBreaks}</p>}
      </div>

      <div className="card">
        <h3>Try to cheat it</h3>
        <div className="row">
          <button className="secondary" onClick={() => attack(1)} disabled={!!busy}>Sell receipt #{sold + 1} now</button>
          <button className="secondary" onClick={() => attack(2)} disabled={!!busy}>Merchant pulls the vault</button>
          <button className="secondary" onClick={() => attack(3)} disabled={!!busy}>Merchant posts NO</button>
          <button className="secondary" onClick={() => attack(4)} disabled={!!busy}>Receipt after sales close</button>
        </div>
        {attacks.map((a, i) => <p key={i} className="small">{a.label}: {a.ok ? <span className="err">went through</span> : <span className="ok">blocked: {a.error}{a.code ? ` (${a.code})` : ""}</span>} {a.explorer && <a href={a.explorer} target="_blank">failed tx</a>}</p>)}
      </div>

      <div className="card">
        <h3>Receipts</h3>
        <table><thead><tr><th>#</th><th>holder</th><th>issued</th><th>refund</th></tr></thead>
          <tbody>{v.receipts.map((r) => <tr key={r.index}><td>{r.index}</td><td className="mono">{short(r.holder, 6)}</td><td><a href={ex(r.sig)} target="_blank">{new Date(r.ts).toLocaleTimeString()}</a></td><td>{r.refunded ? (r.refundSig ? <a href={ex(r.refundSig)} target="_blank">paid</a> : "paid") : "—"}</td></tr>)}</tbody></table>
      </div>
      {out && <pre className="mono small card">{out}</pre>}
    </main>
  );
}
