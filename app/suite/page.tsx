"use client";
// M1 Risk Scan (SPEC §14.2): one sentence → the live Gemini markets that move this business.
import { useRef, useState } from "react";
import { SuiteNav } from "./nav";
import { api, Boundary, ErrorBox, useElapsed, useMounted } from "./api";
import type { ExposureMap, ExposureRow } from "@/lib/hh/exposure";

const PRESETS = [
  { label: "Coffee cart near UT", text: "coffee cart near UT, iced and hot drinks, we take crypto" },
  { label: "Sports bar", text: "sports bar on Guadalupe, $6 drafts, patio, game nights, variable-rate SBA loan" },
  { label: "Taqueria + trucks", text: "taqueria on East 6th, gas griddles, 2 food trucks" },
];
const pct = (x: number | null | undefined) => (x == null || !isFinite(x) ? "—" : `${Math.round(x * 100)}%`);
const money = (x: number | null | undefined) => (x == null || !isFinite(x) ? "—" : `$${x.toFixed(x >= 100 ? 0 : 2)}`);
const SCAN_TIMEOUT_MS = 90_000;

function stage(s: number) {
  if (s < 4) return "Loading Gemini’s live market catalog…";
  if (s < 30) return "Picking the markets that move this business (AI, or keyword fallback)…";
  if (s < 60) return "Pricing each market from the live order book… (AI scans can take up to a minute)";
  return "Still working: slower than usual. It gives up at 90 s.";
}

export default function RiskScan() {
  const [text, setText] = useState(PRESETS[0].text);
  const [res, setRes] = useState<ExposureMap | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [t0, setT0] = useState<number | null>(null);
  const last = useRef<{ t: string; fresh: boolean }>({ t: text, fresh: false });
  const secs = useElapsed(t0);
  const busy = t0 != null;
  const ready = useMounted();

  async function run(t = text, fresh = false) {
    if (!t.trim()) { setErr(new Error("Type one sentence about the business first.")); return; }
    last.current = { t, fresh };
    setT0(Date.now()); setErr(null);
    try {
      const r = await api<ExposureMap>("/api/exposures", { body: { text: t, fresh }, timeoutMs: SCAN_TIMEOUT_MS });
      if (!Array.isArray(r.rows)) throw new Error(`The scan reply had no rows (got keys: ${Object.keys(r).join(", ") || "none"}).`);
      setRes(r);
    } catch (e) { setErr(e); } finally { setT0(null); }
  }

  return (
    <main>
      <SuiteNav here="scan" />
      <div className="card">
        <h3>Describe your business in one sentence</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => run()} disabled={busy || !ready}>{!ready ? <><span className="spin" /> Loading app…</> : busy ? <><span className="spin" /> Scanning… {secs}s</> : "Scan my risks"}</button>
          {PRESETS.map((p) => <button key={p.label} className="secondary" disabled={busy || !ready} onClick={() => { setText(p.text); run(p.text); }}>{p.label}</button>)}
        </div>
        {busy && <div className="small muted" style={{ marginTop: 6 }} data-testid="scan-stage">{stage(secs)} ({secs}s)</div>}
        <ErrorBox err={err} onRetry={() => run(last.current.t, last.current.fresh)} />
      </div>

      {res && (
        <Boundary label="the scan results">
          <div className="row spread small muted">
            <span>{res.profile?.business_type ?? "business"}{res.profile?.city ? ` · ${res.profile.city}` : ""} · {res.rows.length} risks from {res.catalogSize ?? "?"} live markets</span>
            <span>{res.source === "llm" ? `AI-picked (${res.note ?? ""})` : `Keyword fallback (${res.note ?? "no AI key"})`} · {((res.ms ?? 0) / 1000).toFixed(1)}s{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); if (!busy) run(text, true); }}>{busy ? "rescanning…" : "rescan"}</a></span>
          </div>
          {res.rows.length === 0 && <p className="muted">No live market matched this business right now. Try another sentence or a preset.</p>}
          <div className="grid">{res.rows.map((r, i) => <Boundary key={r?.id ?? i} label={`risk #${i + 1}`}><Row r={r} biz={text} /></Boundary>)}</div>
          <p className="footer">The AI only picks which markets matter and writes the words. Every odds, price and depth number comes from Gemini’s live order book. Dollar hits are rough AI estimates you can edit. Not financial advice.</p>
        </Boundary>
      )}
    </main>
  );
}

function Row({ r, biz }: { r: ExposureRow; biz: string }) {
  const [impact, setImpact] = useState(Number(r.impact_usd) || 100);
  const symbols = r.symbols ?? [];
  const labels = r.labels ?? [];
  const flags = r.flags ?? [];
  const action = r.action ?? "plan";
  const expected = r.p_bad != null ? r.p_bad * impact : null;
  const coverCost = r.cost_per_usd != null ? r.cost_per_usd * impact : null;
  const actionPill = action === "promo" ? "good" : action === "hedge" ? "" : "warn";
  const hedgeHref = `/suite/hedge?t=${encodeURIComponent(r.event_ticker)}&s=${encodeURIComponent(symbols.join(","))}&p=${impact}${r.cost_per_usd != null ? `&c=${r.cost_per_usd}` : ""}`;
  const canHedge = action !== "plan" && r.cost_per_usd != null && symbols.length > 0 && !!r.event_ticker;
  return (
    <div className="card" data-testid="risk-row">
      <div className="row spread">
        <span className={`pill ${actionPill}`}>{String(action).toUpperCase()}</span>
        <span className="row" style={{ gap: 6 }}>
          {r.channel && <span className="pill">{r.channel}</span>}
          {r.venue && <span className={`pill ${r.venue.sandbox ? "good" : ""}`}>{r.venue.mode === "live" ? `LIVE · ${r.venue.host}` : `odds · ${r.venue.host}`}</span>}
        </span>
      </div>
      <h3 style={{ marginTop: 8 }}>{r.event_title ?? r.event_ticker}</h3>
      <div className="small">Bad case: <b>{labels.join(" or ") || symbols.join(", ") || "—"}</b></div>
      {r.why && <p className="small" style={{ margin: "6px 0" }}>{r.why}</p>}
      <div className="row small" style={{ margin: "8px 0" }}>
        <span className="stat"><span className="muted">chance</span><b>{pct(r.p_bad)}</b></span>
        <span className="stat"><span className="muted">cover / $1</span><b>{r.cost_per_usd == null ? "—" : `${Math.round(r.cost_per_usd * 100)}¢`}</b></span>
        <span className="stat"><span className="muted">AI est. hit</span><b>$<input type="number" min={0} value={impact} onChange={(e) => setImpact(Math.max(0, Number(e.target.value) || 0))} style={{ width: 80, padding: "2px 6px" }} /></b></span>
        <span className="stat"><span className="muted">expected loss</span><b>{money(expected)}</b></span>
      </div>
      {r.basis_note && <div className="small muted">{r.basis_note}</div>}
      {(flags.length > 0 || r.action_forced) && (
        <div className="row small" style={{ marginTop: 6, gap: 6 }}>
          {flags.map((f) => <span key={f} className="pill warn">{f === "thin" ? `thin book (${r.depth} at top)` : f}</span>)}
          {r.action_forced && <span className="pill">{r.action_forced}</span>}
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {action === "promo" && <a className="btn" href={`/merchant?q=${encodeURIComponent(biz)}`} title="Opens Promos with this business sentence and finds a customer promo for it">Make it a promo</a>}
        {canHedge && <a className={`btn ${action === "promo" ? "secondary" : ""}`} href={hedgeHref}>Hedge it · {money(coverCost)} for {money(impact)}</a>}
        {action !== "plan" && !canHedge && <span className="small muted">Can’t hedge right now: {r.cost_per_usd == null ? "no live ask in Gemini’s book for this outcome" : "no contracts listed"}.</span>}
        {action === "plan" && <span className="small">Plan for it: the market puts this at <b>{pct(r.p_bad)}</b>. Use it for timing and budgeting, not as a trade.</span>}
      </div>
    </div>
  );
}
