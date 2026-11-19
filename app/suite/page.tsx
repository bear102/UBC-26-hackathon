"use client";
// M1 Risk Scan (SPEC §14.2): one sentence → the live Gemini markets that move this business.
import { useEffect, useState } from "react";
import { post } from "@/lib/hh/client";
import { SuiteNav } from "./nav";
import type { ExposureMap, ExposureRow } from "@/lib/hh/exposure";

const PRESETS = [
  { label: "Coffee cart near UT", text: "coffee cart near UT, iced and hot drinks, we take crypto" },
  { label: "Sports bar", text: "sports bar on Guadalupe, $6 drafts, patio, game nights, variable-rate SBA loan" },
  { label: "Taqueria + trucks", text: "taqueria on East 6th, gas griddles, 2 food trucks" },
];
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const money = (x: number | null | undefined) => (x == null ? "—" : `$${x.toFixed(x >= 100 ? 0 : 2)}`);

export default function RiskScan() {
  const [text, setText] = useState(PRESETS[0].text);
  const [res, setRes] = useState<ExposureMap | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [t0, setT0] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (!busy) return; const i = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(i); }, [busy]);

  async function run(t = text, fresh = false) {
    setBusy(true); setMsg(""); setT0(Date.now());
    try {
      const r = await post<ExposureMap & { error?: string }>("/api/exposures", { text: t, fresh });
      if (r.error) throw new Error(r.error);
      setRes(r);
    } catch (e) { setMsg(String((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <main>
      <SuiteNav here="scan" />
      <div className="card">
        <h3>Describe your business in one sentence</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => run()} disabled={busy}>{busy ? <><span className="spin" /> Reading Gemini’s live markets… {Math.round((Date.now() - t0) / 1000)}s</> : "Scan my risks"}</button>
          {PRESETS.map((p) => <button key={p.label} className="secondary" disabled={busy} onClick={() => { setText(p.text); run(p.text); }}>{p.label}</button>)}
          {msg && <span className="err">{msg}</span>}
        </div>
      </div>

      {res && (
        <>
          <div className="row spread small muted">
            <span>{res.profile.business_type} · {res.profile.city} · {res.rows.length} risks from {res.catalogSize} live markets</span>
            <span>{res.source === "llm" ? `AI-picked (${res.note})` : `Keyword fallback (${res.note})`} · {(res.ms / 1000).toFixed(1)}s <a href="#" onClick={(e) => { e.preventDefault(); run(text, true); }}>rescan</a></span>
          </div>
          {res.rows.length === 0 && <p className="muted">No live market matched this business right now.</p>}
          <div className="grid">{res.rows.map((r) => <Row key={r.id} r={r} biz={text} />)}</div>
          <p className="footer">The AI only picks which markets matter and writes the words. Every odds, price and depth number comes from Gemini’s live order book. Dollar hits are rough AI estimates you can edit. Not financial advice.</p>
        </>
      )}
    </main>
  );
}

function Row({ r, biz }: { r: ExposureRow; biz: string }) {
  const [impact, setImpact] = useState(r.impact_usd);
  const expected = r.p_bad != null ? r.p_bad * impact : null;
  const coverCost = r.cost_per_usd != null ? r.cost_per_usd * impact : null;
  const actionPill = r.action === "promo" ? "good" : r.action === "hedge" ? "" : "warn";
  const hedgeHref = `/suite/hedge?t=${encodeURIComponent(r.event_ticker)}&s=${encodeURIComponent(r.symbols.join(","))}&p=${impact}`;
  return (
    <div className="card">
      <div className="row spread">
        <span className={`pill ${actionPill}`}>{r.action.toUpperCase()}</span>
        <span className="row" style={{ gap: 6 }}>
          <span className="pill">{r.channel}</span>
          <span className={`pill ${r.venue.sandbox ? "good" : ""}`}>{r.venue.mode === "live" ? `LIVE · ${r.venue.host}` : `odds · ${r.venue.host}`}</span>
        </span>
      </div>
      <h3 style={{ marginTop: 8 }}>{r.event_title}</h3>
      <div className="small">Bad case: <b>{r.labels.join(" or ")}</b></div>
      <p className="small" style={{ margin: "6px 0" }}>{r.why}</p>
      <div className="row small" style={{ margin: "8px 0" }}>
        <span className="stat"><span className="muted">chance</span><b>{pct(r.p_bad)}</b></span>
        <span className="stat"><span className="muted">cover / $1</span><b>{r.cost_per_usd == null ? "—" : `${Math.round(r.cost_per_usd * 100)}¢`}</b></span>
        <span className="stat"><span className="muted">AI est. hit</span><b>$<input type="number" min={0} value={impact} onChange={(e) => setImpact(Math.max(0, Number(e.target.value)))} style={{ width: 80, padding: "2px 6px" }} /></b></span>
        <span className="stat"><span className="muted">expected loss</span><b>{money(expected)}</b></span>
      </div>
      <div className="small muted">{r.basis_note}</div>
      {(r.flags.length > 0 || r.action_forced) && (
        <div className="row small" style={{ marginTop: 6, gap: 6 }}>
          {r.flags.map((f) => <span key={f} className="pill warn">{f === "thin" ? `thin book (${r.depth} at top)` : f}</span>)}
          {r.action_forced && <span className="pill">{r.action_forced}</span>}
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {r.action === "promo" && <a className="btn" href={`/merchant?q=${encodeURIComponent(biz)}`}>Make it a promo</a>}
        {r.action !== "plan" && r.cost_per_usd != null && <a className={`btn ${r.action === "promo" ? "secondary" : ""}`} href={hedgeHref}>Hedge it · {money(coverCost)} for {money(impact)}</a>}
        {r.action === "plan" && <span className="small">Plan for it: the market puts this at <b>{pct(r.p_bad)}</b>. Use it for timing and budgeting, not as a trade.</span>}
      </div>
    </div>
  );
}
