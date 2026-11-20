"use client";
// "Estimated loss ~$3,360 · Edit": lets the owner correct the AI's loss estimate; the plan re-sizes instantly
// (PlanView re-runs rescaleQuote with the new risk.lossUsd). Original AI value stays one click away.
import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/client/format";

export function EditableLoss({ value, original, onChange }: {
  value: number;                 // current loss (USD)
  original?: number;             // AI's estimate, if the owner changed it
  onChange: (usd: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.round(value)));
  const [bad, setBad] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(String(Math.round(value))); setBad(null); input.current?.select(); } }, [editing, value]);

  const save = () => {
    const n = Math.round(Number(draft.replace(/[$,\s]/g, "")));
    if (!Number.isFinite(n) || n <= 0) { setBad("Enter a dollar amount above $0."); input.current?.focus(); return; }
    if (n > 10_000_000) { setBad("That's above $10 million. Enter a smaller amount."); input.current?.focus(); return; }
    setBad(null); onChange(n); setEditing(false);
  };

  if (!editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b className="num bad">~{usd(value)}</b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} aria-label="Edit estimated loss">Edit</button>
        {original != null && Math.round(original) !== Math.round(value) && (
          <button type="button" className="btn btn-ghost btn-sm muted" onClick={() => onChange(original)} title="Use the AI's estimate">
            AI said {usd(original)}
          </button>
        )}
        {original != null && Math.round(original) !== Math.round(value) && (
          <span className="xs muted" style={{ flexBasis: "100%" }}>Your budget is shared, so other risks may resize.</span>
        )}
      </span>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span aria-hidden="true">$</span>
      <input ref={input} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        aria-label="Your estimated loss in dollars" aria-invalid={!!bad} aria-describedby={bad ? "loss-err" : undefined} style={{ width: 110, padding: "6px 10px" }} className="input num" />
      <button type="submit" className="btn btn-sm">Save</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      {bad && <span id="loss-err" role="alert" className="xs" style={{ flexBasis: "100%", color: "var(--red)" }}>{bad}</span>}
    </form>
  );
}
