"use client";
// M3 Hedge Desk (SPEC §14.4): price direct cover from the live book; buy only on the Gemini sandbox, behind merchant login.
import { useCallback, useEffect, useRef, useState } from "react";
import { ex, short } from "@/lib/hh/client";
import { SuiteNav } from "../nav";
import { api, Boundary, ErrorBox, errStatus, useElapsed } from "../api";
import type { DeskQuote, DeskTicket } from "@/lib/hh/hedgeDesk";

type Info = { tickets: DeskTicket[]; buyEnabled: boolean; tradeHost: string; dataHost: string; maxUsd: number };
const m2 = (x: number | null | undefined) => (x == null || !isFinite(x) ? "—" : `$${x.toFixed(2)}`);
const pct = (x: number | null | undefined) => (x == null || !isFinite(x) ? "—" : `${Math.round(x * 100)}%`);
const DEFAULT_DESK_MAX = 100; // matches lib/hh/hedgeDesk deskMax() default (DESK_MAX_USD)
const clampPayout = (n: number) => Math.max(1, Math.min(10_000, Math.round(n) || 1));
const ceil2 = (x: number) => Math.ceil(x * 100 - 1e-6) / 100;

export default function HedgeDesk() {
  const [sel, setSel] = useState<{ t: string; s: string[]; o: "yes" | "no" } | null>(null);
  const [payout, setPayout] = useState(10);
  const [capNote, setCapNote] = useState("");
  const [q, setQ] = useState<DeskQuote | null>(null);
  const [qErr, setQErr] = useState<unknown>(null);
  const [qT0, setQT0] = useState<number | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [infoErr, setInfoErr] = useState<unknown>(null);
  const [maxUsd, setMaxUsd] = useState("");
  const [buyT0, setBuyT0] = useState<number | null>(null);
  const [result, setResult] = useState<DeskTicket | null>(null);
  const [buyErr, setBuyErr] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0); // bump to force a re-quote (e.g. after login)
  const payoutRef = useRef(payout); payoutRef.current = payout;
  const qSecs = useElapsed(qT0);
  const buySecs = useElapsed(buyT0);
  const busy = buyT0 != null;

  const loadInfo = useCallback(async () => {
    try { const i = await api<Info>("/api/hedge-desk", { timeoutMs: 30_000 }); setInfo({ ...i, tickets: Array.isArray(i.tickets) ? i.tickets : [] }); setInfoErr(null); }
    catch (e) { setInfoErr(e); }
  }, []);

  useEffect(() => {
    const u = new URLSearchParams(location.search);
    const t = u.get("t"), s = u.get("s");
    if (t && s) setSel({ t, s: s.split(",").filter(Boolean), o: u.get("o") === "no" ? "no" : "yes" });
    // Cover amount: keep the Risk Scan's `p` (estimated hit) but cap the starting point so the premium fits the
    // desk's per-ticket limit (default $100) — otherwise the first quote is "Over the desk limit" and Buy is dead.
    // `c` = cost per $1 of cover from the scan; without it fall back to a modest $10.
    const p = Number(u.get("p")), c = Number(u.get("c"));
    if (p > 0) {
      let start = clampPayout(p);
      if (c > 0 && start * c > DEFAULT_DESK_MAX * 0.9) {
        const fit = clampPayout(Math.floor((DEFAULT_DESK_MAX * 0.9) / c));
        setCapNote(`Started at $${fit} of cover (not the $${start} estimated hit) so the premium fits the $${DEFAULT_DESK_MAX} per-ticket desk limit. Raise it if you like.`);
        start = fit;
      }
      setPayout(start);
    }
    loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    if (!sel) return;
    let stop = false;
    const ctl = new AbortController();
    const go = async (first: boolean) => {
      if (first) setQT0(Date.now());
      try {
        const r = await api<DeskQuote>("/api/hedge-desk/quote", { body: { event_ticker: sel.t, symbols: sel.s, outcome: sel.o, payout_usd: payoutRef.current }, timeoutMs: 45_000, signal: ctl.signal });
        if (stop) return;
        setQ({ ...r, legs: Array.isArray(r.legs) ? r.legs : [] }); setQErr(null);
      } catch (e) { if (!stop) setQErr(e); }
      finally { if (first && !stop) setQT0(null); }
    };
    const d = setTimeout(() => go(true), 300); // debounce typing in the cover amount
    const i = setInterval(() => go(false), 10_000);
    return () => { stop = true; ctl.abort(); clearTimeout(d); clearInterval(i); setQT0(null); };
  }, [sel, payout, nonce]);

  async function buy() {
    if (!q || !sel) return;
    setBuyT0(Date.now()); setBuyErr(null); setResult(null);
    try {
      const r = await api<DeskTicket>("/api/hedge-desk/buy", { body: { event_ticker: sel.t, symbols: sel.s, outcome: sel.o, payout_usd: payout, max_usd: Number(maxUsd) }, timeoutMs: 90_000 });
      setResult({ ...r, fills: Array.isArray(r.fills) ? r.fills : [] }); setMaxUsd(""); loadInfo();
    } catch (e) { setBuyErr(e); } finally { setBuyT0(null); }
  }

  const afterLogin = () => { setNonce((n) => n + 1); loadInfo(); };
  const premium = q?.premium ?? null;
  const stale = !!q && q.payout_usd !== clampPayout(payout);
  const maxN = Number(maxUsd);
  const suggested = premium != null ? ceil2(premium * 1.03) : null; // 3% room for the book moving before the order
  const overLimit = !!q && !q.tradeable && /desk limit/i.test(q.reason ?? "") && premium != null && premium > 0;
  const fitPayout = overLimit && info ? clampPayout(Math.floor((payout * info.maxUsd * 0.9) / (premium as number))) : null;

  const depthFit = q && q.legs.length ? Math.min(...q.legs.map((l) => Number(l.depth) || 0)) : null;
  let why = "";
  if (busy) why = "";
  else if (!info) why = infoErr ? "Can’t load desk status (see the error above)." : "Loading desk status…";
  else if (!info.buyEnabled) why = `Buying is off on this server: it needs HEDGE_MODE=live, Gemini trading keys and GEMINI_TRADE_BASE=https://api.sandbox.gemini.com (trade venue now: ${info.tradeHost}).`;
  else if (!q) why = "Waiting for a quote…";
  else if (!q.tradeable) why = q.reason ?? "This cover isn’t tradeable right now.";
  else if (stale || qT0 != null) why = `Re-pricing for $${clampPayout(payout)} of cover…`;
  else if (premium == null) why = "No live price.";
  else if (!maxUsd.trim() || !(maxN > 0)) why = `Type the most you’ll pay (premium is ${m2(premium)}).`;
  else if (maxN < premium) why = `Premium is ${m2(premium)}: raise your max to at least ${m2(premium)} or lower the cover amount.`;
  const canBuy = !busy && !why;

  return (
    <main>
      <SuiteNav here="desk" />
      <ErrorBox err={infoErr} onRetry={loadInfo} onLogin={afterLogin} />
      {info && (
        <div className="banner" style={{ marginBottom: 10 }}>
          {info.buyEnabled ? <>Buying is <b>live on {info.tradeHost}</b> (Gemini sandbox: real orders, test money). Each fill is committed on Solana devnet as a memo. Limit ${info.maxUsd} per ticket.</>
            : <>Quote only: buying is enabled on the Gemini sandbox only (trade venue now: {info.tradeHost}).</>}
        </div>
      )}

      {!sel && <div className="card"><p>Pick a risk on the <a href="/suite">Risk Scan</a> and tap <b>Hedge it</b> to price cover here.</p></div>}

      {sel && (
        <Boundary label="the quote">
          <div className="card">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{q?.event_title ?? sel.t}</h3>
              {q?.venue && <span className={`pill ${q.venue.sandbox ? "good" : "warn"}`}>{q.venue.mode === "live" ? `LIVE · ${q.venue.host}` : `QUOTE · ${q.venue.host} odds`}</span>}
            </div>
            <div className="small muted">Pays if: <b>{q?.legs.length ? q.legs.map((l) => l.label).join(" or ") : `${sel.o === "no" ? "NO on " : ""}${sel.s.join(", ")}`}</b>{q?.expiry && <> · settles {new Date(q.expiry).toLocaleString()}</>}</div>

            <div className="row" style={{ margin: "12px 0" }}>
              <label>Cover amount $ <input type="number" min={1} max={10000} value={payout} onChange={(e) => { setCapNote(""); setPayout(clampPayout(Number(e.target.value))); }} style={{ width: 110 }} /></label>
              {qT0 != null && <span className="small muted"><span className="spin" /> Pricing from Gemini’s live book… {qSecs}s</span>}
            </div>
            {capNote && <div className="small muted" style={{ marginBottom: 6 }}>{capNote}</div>}
            <ErrorBox err={qErr} onRetry={() => setNonce((n) => n + 1)} onLogin={afterLogin} />

            {q && (
              <>
                {q.fillable !== false ? <div className="big" style={{ margin: "6px 0 10px" }}>{q.plain}</div> : (
                  <div className="banner" style={{ margin: "6px 0 10px" }} data-testid="depth-warn">
                    <b>Not enough depth in Gemini’s book for ${q.payout_usd} of cover.</b> The prices below only cover what the book holds right now, so they are not a real price for this amount.
                    {depthFit != null && depthFit >= 1 && depthFit < payout && <> <a href="#" onClick={(e) => { e.preventDefault(); setCapNote(""); setPayout(depthFit); }}>lower cover to ${depthFit}</a></>}
                  </div>
                )}
                <div className="row small" style={{ margin: "8px 0" }}>
                  <span className="stat"><span className="muted">premium</span><b data-testid="premium">{m2(q.premium)}</b></span>
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
                <div className="small muted" style={{ marginTop: 6 }}>Re-priced every 10 s from the live book · IOC limit orders at ask + 2¢ · {q.quotedAt ? new Date(q.quotedAt).toLocaleTimeString() : ""}</div>

                <div className="row" style={{ marginTop: 14 }}>
                  <label className="small">Most I’ll pay $ <input type="number" step="0.01" min={0} placeholder={premium != null ? premium.toFixed(2) : ""} value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canBuy) buy(); }} style={{ width: 100 }} /></label>
                  {suggested != null && q.tradeable && <a href="#" className="small" onClick={(e) => { e.preventDefault(); setMaxUsd(suggested.toFixed(2)); }}>use {m2(suggested)} (price + 3% room)</a>}
                  <button onClick={buy} disabled={!canBuy}>{busy ? <><span className="spin" /> Buying on Gemini… {buySecs}s</> : "Buy cover"}</button>
                </div>
                {why && <div className="small" style={{ marginTop: 6, color: "var(--warn)" }} data-testid="buy-why">{why}
                  {fitPayout != null && fitPayout < payout && <> <a href="#" onClick={(e) => { e.preventDefault(); setPayout(fitPayout); }}>lower cover to ${fitPayout}</a></>}</div>}
                <ErrorBox err={buyErr} onLogin={afterLogin} />
                {result && <div className={`small ${result.status === "REJECTED" ? "err" : "ok"}`} style={{ marginTop: 6 }} data-testid="buy-outcome">
                  {result.status === "REJECTED" ? `Order not filled: ${result.note ?? "Gemini rejected it"}. Nothing was spent.` : `${result.status}: ${result.covered} contracts for ${m2(result.spent)}. Ticket below.`}</div>}
                {buyErr != null && errStatus(buyErr) !== 401 && <div className="small muted">Nothing was charged unless a ticket appears under “Your cover”.</div>}
              </>
            )}
          </div>
        </Boundary>
      )}

      <h2>Your cover</h2>
      {result && <Boundary label="the new ticket"><TicketCard t={result} highlight /></Boundary>}
      {!info && !infoErr && <p className="muted">Loading…</p>}
      {info && !info.tickets.length && <p className="muted">No cover bought yet.</p>}
      {info?.tickets.filter((t) => t.id !== result?.id).map((t, i) => <Boundary key={t?.id ?? i} label="a ticket"><TicketCard t={t} /></Boundary>)}
    </main>
  );
}

function TicketCard({ t, highlight }: { t: DeskTicket; highlight?: boolean }) {
  const legs = t.quote?.legs ?? [];
  const fills = t.fills ?? [];
  return (
    <div className="card" style={highlight ? { borderColor: t.status === "REJECTED" ? "var(--bad)" : "var(--good)" } : undefined} data-testid="ticket">
      <div className="row spread">
        <b>{t.quote?.event_title ?? t.id}</b>
        <span className={`pill ${t.status === "FILLED" ? "good" : t.status === "PARTIAL" ? "warn" : "bad"}`}>{t.status}</span>
      </div>
      <div className="small">Cover {t.covered} × $1 if <b>{legs.map((l) => l.label).join(" or ")}</b> · paid {m2(t.spent)} · {new Date(t.createdAt).toLocaleString()} · {t.quote?.venue?.host}</div>
      <div className="small mono muted" style={{ marginTop: 4 }}>{fills.map((f) => `order ${f.orderId}: ${f.filled}/${f.qty} @ ${Number(f.avgPx ?? f.price).toFixed(2)} (${f.status})`).join(" · ")}</div>
      {t.memo && <div className="small" style={{ marginTop: 4 }}>Onchain commitment: {t.memo.sig ? <a href={ex(t.memo.sig)} target="_blank" rel="noreferrer">{short(t.memo.sig, 6)}</a> : <span className="err">memo failed: {t.memo.error}</span>} <span className="muted">(memo = sha256 of the fills; a commitment, not an attestation)</span></div>}
      {t.note && <div className="small err">{t.note}</div>}
    </div>
  );
}
