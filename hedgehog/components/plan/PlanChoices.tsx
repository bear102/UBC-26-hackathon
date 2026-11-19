"use client";
// Package switcher (Essentials / Balanced / Max protection) + per-risk strike/window choices.
import { useMemo } from "react";
import type { Quote, QuoteLine } from "@/lib/types";
import type { Coverage } from "@/lib/client/quote";
import { applyPicks, currentPicks, packagePicks, samePicks, type Picks } from "@/lib/client/choices";
import { cents, usd } from "@/lib/client/format";
import { IconCheck } from "../Icons";
import s from "./Choices.module.css";

export function choiceLabel(c: QuoteLine) {
  return `${c.side.toUpperCase()} · ${c.contract.label}`;
}

export function PlanChoices({ quote, coverage, onChange }: { quote: Quote; coverage: Coverage; onChange: (q: Quote) => void }) {
  const picks = useMemo(() => currentPicks(quote), [quote]);
  const pkgs = useMemo(() => (quote.packages ?? []).map((p) => {
    const pp = packagePicks(quote, p);
    const q = applyPicks(quote, pp, coverage);
    return { p, picks: pp, premium: q.totalPremiumUsd, payout: q.totalPayoutUsd, n: q.lines.filter((l) => l.contracts > 0).length };
  }), [quote, coverage]);
  if (!pkgs.length) return null;

  const set = (next: Picks) => onChange(applyPicks(quote, next, coverage));
  const risk = (id: string) => quote.risks.find((r) => r.id === id);

  return (
    <section className="section" style={{ paddingTop: 56, paddingBottom: 8 }}>
      <div className="sec-head">
        <div><span className="eyebrow">Options</span><h2>Pick <em>a plan</em></h2></div>
        <span className="muted small">Every option fits your {usd(quote.budgetUsd)}/mo budget.</span>
      </div>
      {pkgs.length > 0 && (
        <div className={s.pkgs} role="group" aria-label="Plan packages">
          {pkgs.map(({ p, picks: pp, premium, payout, n }, i) => (
            <button key={p.id} className={s.pkg} aria-pressed={samePicks(pp, picks)} onClick={() => set(pp)}>
              <span className={s.pkgTop}><span className={s.fno}>Plan {String.fromCharCode(65 + i)}</span>{samePicks(pp, picks) && <span className={s.sel}><IconCheck size={12} /> Selected</span>}</span>
              <span className={s.pkgName}>{p.name}{p.id === "balanced" && <span className="badge badge-brand">AI pick</span>}</span>
              <span className="xs muted">{p.blurb}</span>
              <span className={s.pkgNums}>
                <span>Premium<b className="num cost">{usd(premium, 2)}</b></span>
                <span>Pays up to<b className="num pay">{usd(payout)}</b></span>
                <span>Hedges<b className="num">{n}</b></span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function shortExpiry(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
