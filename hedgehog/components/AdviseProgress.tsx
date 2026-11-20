"use client";
import { useEffect, useState } from "react";
import { IconCheck } from "./Icons";

const STAGES = [
  { at: 0, label: "Mapping your risks", sub: "Reading your business and the local forecast" },
  { at: 5, label: "Scanning Gemini, Kalshi + Polymarket", sub: "Weather, sports, commodity and macro contracts" },
  { at: 14, label: "Matching each risk to a contract", sub: "Picking the side that pays on your bad day" },
  { at: 22, label: "Sizing your cover", sub: "Fitting your budget" },
];

export function AdviseProgress({ name }: { name?: string }) {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT((x) => x + 0.25), 250); return () => clearInterval(i); }, []);
  const idx = STAGES.reduce((acc, s, i) => (t >= s.at ? i : acc), 0);
  const progress = Math.min(95, (1 - Math.exp(-t / 14)) * 100);
  return (
    <div className="card" style={{ maxWidth: 580, margin: "40px auto", padding: "20px 24px 22px", boxShadow: "var(--shadow-lg)" }} aria-live="polite">
      <div className="doc-head" style={{ margin: "-20px -24px 18px", padding: "14px 24px" }}>
        <span className="caps-title">Underwriting</span>
        <span className="meta">IN PROGRESS · {Math.round(progress)}%</span>
      </div>
      <span className="eyebrow">Building your hedge plan</span>
      <h2 style={{ margin: "10px 0 0", fontSize: "clamp(26px, 3vw, 36px)", overflowWrap: "anywhere" }}>{name ? `Looking at ${name}…` : "Working on it…"}</h2>
      <div className="bar" style={{ margin: "18px 0 22px" }} role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <ol className="steps">
        {STAGES.map((s, i) => (
          <li key={s.label} className={i < idx ? "done" : i === idx ? "active" : ""}>
            <span className="ic">{i < idx ? <IconCheck size={14} /> : ""}</span>
            <span>{s.label}…<br /><span className="xs muted" style={{ fontWeight: 400 }}>{s.sub}</span></span>
          </li>
        ))}
      </ol>
      <p className="xs muted" style={{ marginTop: 20, marginBottom: 0, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>Usually 10–40 seconds.</p>
    </div>
  );
}
