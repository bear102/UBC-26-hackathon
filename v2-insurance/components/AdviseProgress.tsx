"use client";
import { useEffect, useState } from "react";

const STAGES = [
  { at: 0, label: "Mapping your risks", sub: "Reading your business and the Austin forecast" },
  { at: 5, label: "Scanning Gemini + Kalshi markets", sub: "Weather, sports, commodity and macro contracts" },
  { at: 14, label: "Matching each risk to a contract", sub: "Picking the side that pays on your bad day" },
  { at: 22, label: "Sizing your cover", sub: "Walking the order book, fitting your budget" },
];

export function AdviseProgress({ name }: { name?: string }) {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT((x) => x + 0.25), 250); return () => clearInterval(i); }, []);
  const idx = STAGES.reduce((acc, s, i) => (t >= s.at ? i : acc), 0);
  const progress = Math.min(95, (1 - Math.exp(-t / 14)) * 100);
  return (
    <div className="card" style={{ maxWidth: 560, margin: "32px auto" }} aria-live="polite">
      <span className="eyebrow">Building your hedge plan</span>
      <h2 style={{ marginTop: 4 }}>{name ? `Looking at ${name}…` : "Working on it…"}</h2>
      <div className="bar" style={{ margin: "14px 0 20px" }} role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <ol className="steps">
        {STAGES.map((s, i) => (
          <li key={s.label} className={i < idx ? "done" : i === idx ? "active" : ""}>
            <span className="ic">{i < idx ? "✓" : ""}</span>
            <span>{s.label}…<br /><span className="xs muted" style={{ fontWeight: 400 }}>{s.sub}</span></span>
          </li>
        ))}
      </ol>
      <p className="xs muted" style={{ marginTop: 18, marginBottom: 0 }}>Usually 10–40 seconds. The AI can only pick contracts that exist on the live books.</p>
    </div>
  );
}
