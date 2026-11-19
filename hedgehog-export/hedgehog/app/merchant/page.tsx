"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getJSON, post, usd } from "@/lib/hh/client";

type Quote = { costPerReceipt: number | null; fair: number | null; spread: number | null; maxReceipts: number; hedgeable: boolean; reason?: string };
type QCard = { event_ticker: string; event_title: string; strip: string[]; sentence: string; why: string; applies_to: string; rules_text?: string; quote: Quote; scale?: { contracts: number; cost: number; fillable: boolean } | null; salesClose: number; kind: string };
type PRow = { id: string; card: { sentence: string; event_ticker: string }; status: string; cap: number; premium: number; createdAt: number; testLabel?: string; salesCloseTs: number };

export default function Merchant() {
  const [text, setText] = useState("sports bar on Guadalupe, $6 drafts, ~150 covers on game nights");
  const [cards, setCards] = useState<QCard[]>([]);
  const [src, setSrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [list, setList] = useState<PRow[]>([]);
  const [cfg, setCfg] = useState<{ hedgeMode: string; merchant: string } | null>(null);
  const refresh = () => getJSON<{ promises: PRow[] }>("/api/promises").then((r) => setList(r.promises)).catch(() => {});
  useEffect(() => { refresh(); getJSON<{ hedgeMode: string; merchant: string }>("/api/config").then(setCfg); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  async function find() {
    setBusy(true); setMsg(""); setCards([]);
    try {
      const r = await post<{ cards: QCard[]; source: string; note?: string; error?: string }>("/api/scan", { text });
      if (r.error) throw new Error(r.error);
      setCards(r.cards); setSrc(r.source === "llm" ? "AI-picked from Gemini's live markets" : `Templates from Gemini's live markets${r.note ? ` (${r.note})` : ""}`);
    } catch (e) { setMsg(String((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <main>
      <div className="row spread"><h1>Hedgehog · merchant</h1>{cfg && <span className={`pill ${cfg.hedgeMode === "live" ? "good" : "warn"}`}>{cfg.hedgeMode === "live" ? "LIVE Gemini hedges" : "PAPER hedges (no Gemini keys yet)"}</span>}</div>
      <div className="card">
        <h3>Describe your business in one sentence</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={find} disabled={busy}>{busy ? <><span className="spin" /> Reading Gemini’s live markets…</> : "Find promos"}</button>
          {src && <span className="muted small">{src}</span>}
          {msg && <span className="err">{msg}</span>}
        </div>
      </div>
      <div className="grid">{cards.map((c, i) => <PromoCard key={i} c={c} onCreated={(id) => { location.href = `/merchant/p/${id}`; }} />)}</div>
      <h2>Your promises</h2>
      {list.length === 0 && <p className="muted">None yet.</p>}
      {list.map((p) => (
        <Link key={p.id} href={`/merchant/p/${p.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card row spread">
            <div><b>{p.card.sentence}</b> {p.testLabel && <span className="pill warn">{p.testLabel}</span>}<div className="muted small">{p.card.event_ticker} · cap {p.cap} · premium {usd(p.premium)} · sales close {new Date(p.salesCloseTs * 1000).toLocaleString()}</div></div>
            <span className="pill">{p.status.replace(/_/g, " ")}</span>
          </div>
        </Link>
      ))}
    </main>
  );
}

function PromoCard({ c, onCreated }: { c: QCard; onCreated: (id: string) => void }) {
  const [cap, setCap] = useState(20);
  const [refund, setRefund] = useState(1);
  const [threshold, setThreshold] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const q = c.quote;
  async function lock() {
    setBusy(true); setErr("");
    try {
      const r = await post<{ id?: string; error?: string }>("/api/promises", { card: { event_ticker: c.event_ticker, event_title: c.event_title, strip: c.strip, sentence: c.sentence, why: c.why, applies_to: c.applies_to }, cap, refundUsd: refund, topupThreshold: threshold });
      if (!r.id) throw new Error(r.error || "failed");
      onCreated(r.id);
    } catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  }
  return (
    <div className="card">
      <div className="big">{c.sentence}</div>
      <div className="muted small">{c.event_title} · applies to {c.applies_to}</div>
      <p className="small">{c.why}</p>
      {c.rules_text && <details className="small"><summary>Gemini rules (the customer’s terms)</summary><p>{c.rules_text}</p></details>}
      {q.hedgeable ? (
        <>
          <div className="row small" style={{ margin: "8px 0" }}>
            <span>Cost/receipt <b>{usd(q.costPerReceipt)}</b></span><span>Fair <b>{usd(q.fair)}</b></span><span>Spread <b>{usd(q.spread)}</b></span>
            <span>Max receipts <b>{q.maxReceipts.toLocaleString()}</b></span><span>Chance customers get paid <b>{q.fair != null ? Math.round(q.fair * 100) : "—"}%</b></span>
          </div>
          {c.scale && <div className="small muted">300 covers × $5: $1,500 tail → {usd(c.scale.cost)} hedge {c.scale.fillable ? "(fillable now)" : "(not fillable at today’s depth)"}</div>}
          <div className="row small" style={{ marginTop: 10 }}>
            <label>cap <input type="number" value={cap} min={1} max={500} onChange={(e) => setCap(Number(e.target.value))} style={{ width: 70 }} /></label>
            <label>refund $ <input type="number" value={refund} step={0.1} min={0.01} onChange={(e) => setRefund(Number(e.target.value))} style={{ width: 70 }} /></label>
            <label>auto top-up <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}><option value={-1}>on demand only</option><option value={3}>when 3 left</option></select></label>
            <span className="muted">Lock {usd(cap * refund)} · sales close {new Date(c.salesClose * 1000).toLocaleString()}</span>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button onClick={lock} disabled={busy}>{busy ? "Locking & hedging…" : "Lock & hedge"}</button>{err && <span className="err small">{err}</span>}</div>
        </>
      ) : <p className="err">{q.reason || "No Gemini book: can’t hedge"}</p>}
    </div>
  );
}
