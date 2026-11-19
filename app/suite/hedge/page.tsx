"use client";
// M3 Hedge Desk (SPEC §14.4): price direct cover from the live book; buy only on the Gemini sandbox, behind merchant login.
import { useEffect, useRef, useState } from "react";
import { getJSON, post, ex, short } from "@/lib/hh/client";
import { SuiteNav } from "../nav";
import type { DeskQuote, DeskTicket } from "@/lib/hh/hedgeDesk";

type Info = { tickets: DeskTicket[]; buyEnabled: boolean; tradeHost: string; dataHost: string; maxUsd: number };
const m2 = (x: number | null | undefined) => (x == null ? "—" : `$${x.toFixed(2)}`);
const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default function HedgeDesk() {
  const [sel, setSel] = useState<{ t: string; s: string[] } | null>(null);
  const [payout, setPayout] = useState(100);
  const [q, setQ] = useState<DeskQuote | null>(null);
  const [qErr, setQErr] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [maxUsd, setMaxUsd] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeskTicket | null>(null);
  const [buyErr, setBuyErr] = useState("");
  const payoutRef = useRef(payout); payoutRef.current = payout;

  const loadInfo = () => getJSON<Info>("/api/hedge-desk").then(setInfo).catch(() => {});
  useEffect(() => {
    const u = new URLSearchParams(location.search);
    const t = u.get("t"), s = u.get("s");
    if (t && s) setSel({ t, s: s.split(",").filter(Boolean) });
    if (u.get("p")) setPayout(Math.max(1, Math.round(Number(u.get("p")) || 100)));
    loadInfo();
  }, []);

  useEffect(() => {
    if (!sel) return;
    let stop = false;
    const go = async () => {
      try {
        const r = await post<DeskQuote & { error?: string }>("/api/hedge-desk/quote", { event_ticker: sel.t, symbols: sel.s, payout_usd: payoutRef.current });
        if (stop) return;
        if (r.error) { setQErr(r.error); return; }
        setQ(r); setQErr("");
      } catch (e) { if (!stop) setQErr(String((e as Error).message)); }
    };
    go();
    const i = setInterval(go, 10_000);
    return () => { stop = true; clearInterval(i); };
  }, [sel, payout]);

  async function buy() {
    if (!q || !sel) return;
    setBusy(true); setBuyErr(""); setResult(null);
    try {
      const r = await post<DeskTicket & { error?: string }>("/api/hedge-desk/buy", { event_ticker: sel.t, symbols: sel.s, payout_usd: payout, max_usd: Number(maxUsd) });
      if (r.error) throw new Error(r.error);
      setResult(r); setMaxUsd(""); loadInfo();
    } catch (e) { setBuyErr(String((e as Error).message)); } finally { setBusy(false); }
  }

  const canBuy = !!q?.tradeable && !!info?.buyEnabled && Number(maxUsd) >= (q?.premium ?? Infinity) && !busy;

  return (
    <main>
      <SuiteNav here="desk" />
      {info && (
        <div className="banner" style={{ marginBottom: 10 }}>
          {info.buyEnabled ? <>Buying is <b>live on {info.tradeHost}</b> (Gemini sandbox: real orders, test money). Each fill is committed on Solana devnet as a memo. Limit ${info.maxUsd} per ticket.</>
            : <>Quote only: buying is enabled on the Gemini sandbox only (trade venue now: {info.tradeHost}).</>}
        </div>
      )}

      {!sel && <div className="card"><p>Pick a risk on the <a href="/suite">Risk Scan</a> and tap <b>Hedge it</b> to price cover here.</p></div>}

      {sel && (
        <div className="card">
          <div className="row spread">
            <h3 style={{ margin: 0 }}>{q?.event_title ?? sel.t}</h3>
            {q && <span className={`pill ${q.venue.sandbox ? "good" : "warn"}`}>{q.venue.mode === "live" ? `LIVE · ${q.venue.host}` : `QUOTE · ${q.venue.host} odds`}</span>}
          </div>
          <div className="small muted">Pays if: <b>{q ? q.legs.map((l) => l.label).join(" or ") : sel.s.join(", ")}</b>{q?.expiry && <> · settles {new Date(q.expiry).toLocaleString()}</>}</div>

          <div className="row" style={{ margin: "12px 0" }}>
            <label>Cover amount $ <input type="number" min={1} max={10000} value={payout} onChange={(e) => setPayout(Math.max(1, Math.round(Number(e.target.value) || 1)))} style={{ width: 110 }} /></label>
            {qErr && <span className="err small">{qErr}</span>}
          </div>

          {q && (
            <>
              <div className="big" style={{ margin: "6px 0 10px" }}>{q.plain}</div>
              <div className="row small" style={{ margin: "8px 0" }}>
                <span className="stat"><span className="muted">premium</span><b>{m2(q.premium)}</b></span>
                <span className="stat"><span className="muted">fair (mid)</span><b>{m2(q.fair)}</b></span>
                <span className="stat"><span className="muted">spread paid</span><b>{m2(q.spread)}</b></span>
                <span className="stat"><span className="muted">chance it pays</span><b>{pct(q.p_bad)}</b></span>
                <span className="stat"><span className="muted">expected payout</span><b>{m2(q.expected_payout)}</b></span>
              </div>
              <table className="small">
                <thead><tr><th>contract</th><th>ask</th><th>bid</th><th>qty</th><th>cost (book walk)</th><th>depth ≤ limit</th></tr></thead>
                <tbody>{q.legs.map((l) => (
                  <tr key={l.symbol}><td>{l.label}<div className="mono muted">{l.symbol}</div></td><td>{m2(l.ask)}</td><td>{m2(l.bid)}</td><td>{l.qty}</td><td>{m2(l.cost)} {!l.fillable && <span className="pill warn">not fillable</span>}</td><td>{l.depth}</td></tr>
                ))}</tbody>
              </table>
              <div className="small muted" style={{ marginTop: 6 }}>Re-priced every 10 s from the live book · IOC limit orders at ask + 2¢ · {new Date(q.quotedAt).toLocaleTimeString()}</div>

              <div className="row" style={{ marginTop: 14 }}>
                {q.tradeable && info?.buyEnabled ? (
                  <>
                    <label className="small">Most I’ll pay $ <input type="number" step="0.01" placeholder={q.premium?.toFixed(2)} value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} style={{ width: 100 }} /></label>
                    <button onClick={buy} disabled={!canBuy}>{busy ? <><span className="spin" /> Buying on Gemini…</> : `Buy cover`}</button>
                    <span className="muted small">Type at least {m2(q.premium)} to confirm.</span>
                  </>
                ) : <span className="pill warn">{q.reason ?? "Quote only"}</span>}
              </div>
              {buyErr && <p className="err">{buyErr}</p>}
            </>
          )}
        </div>
      )}

      {result && <TicketCard t={result} highlight />}

      <h2>Your cover</h2>
      {!info?.tickets.length && <p className="muted">No cover bought yet.</p>}
      {info?.tickets.filter((t) => t.id !== result?.id).map((t) => <TicketCard key={t.id} t={t} />)}
    </main>
  );
}

function TicketCard({ t, highlight }: { t: DeskTicket; highlight?: boolean }) {
  return (
    <div className="card" style={highlight ? { borderColor: "var(--good)" } : undefined}>
      <div className="row spread">
        <b>{t.quote.event_title}</b>
        <span className={`pill ${t.status === "FILLED" ? "good" : t.status === "PARTIAL" ? "warn" : "bad"}`}>{t.status}</span>
      </div>
      <div className="small">Cover {t.covered} × $1 if <b>{t.quote.legs.map((l) => l.label).join(" or ")}</b> · paid {m2(t.spent)} · {new Date(t.createdAt).toLocaleString()} · {t.quote.venue.host}</div>
      <div className="small mono muted" style={{ marginTop: 4 }}>{t.fills.map((f) => `order ${f.orderId}: ${f.filled}/${f.qty} @ ${(f.avgPx ?? f.price).toFixed(2)} (${f.status})`).join(" · ")}</div>
      {t.memo && <div className="small" style={{ marginTop: 4 }}>Onchain commitment: {t.memo.sig ? <a href={ex(t.memo.sig)} target="_blank" rel="noreferrer">{short(t.memo.sig, 6)}</a> : <span className="err">memo failed: {t.memo.error}</span>} <span className="muted">(memo = sha256 of the fills; a commitment, not an attestation)</span></div>}
      {t.note && <div className="small err">{t.note}</div>}
    </div>
  );
}
