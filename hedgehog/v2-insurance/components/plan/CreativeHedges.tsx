"use client";
// "You might not have thought of": proxy / second-order hedges the AI found by scanning every live market,
// plus natural hedges (things that help the business and should not be insured).
import type { Quote, Risk } from "@/lib/types";
import type { Coverage } from "@/lib/client/quote";
import { applyPicks, currentPicks } from "@/lib/client/choices";
import { cents, PERIL_ICON, PERIL_LABEL, usd, VENUE_LABEL } from "@/lib/client/format";
import { choiceLabel, shortExpiry } from "./PlanChoices";
import s from "./Choices.module.css";

const CORR_BADGE: Record<string, string> = { strong: "badge-good", medium: "badge-gold", weak: "badge-neutral" };
const ADVICE: Record<string, string> = { "dont-hedge": "Don't hedge", "hedge-opposite": "Only hedge the extreme", watch: "Watch" };

export function CorrelationBadge({ risk }: { risk: Risk }) {
  if (!risk.correlation) return null;
  return <span className={`badge ${CORR_BADGE[risk.correlation] ?? "badge-neutral"}`} title="How closely this market tracks your loss">{risk.correlation} link</span>;
}

/** Small add-on for a risk card: creative badge, causal story, backtest evidence. */
export function RiskInsights({ risk }: { risk: Risk }) {
  if (risk.kind !== "proxy" && !risk.evidence) return null;
  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      {risk.kind === "proxy" && <div className="row" style={{ gap: 6 }}><span className="badge badge-demo">Creative hedge</span><CorrelationBadge risk={risk} /></div>}
      {risk.kind === "proxy" && risk.causalStory && <p className={s.story}>{risk.causalStory}</p>}
      {risk.evidence && <p className={s.evidence}>Backtest: {risk.evidence}</p>}
    </div>
  );
}

export function CreativeHedges({ quote, coverage, onChange }: { quote: Quote; coverage: Coverage; onChange: (q: Quote) => void }) {
  const ideas = quote.risks.filter((r) => r.kind === "proxy");
  const natural = quote.naturalHedges ?? [];
  if (!ideas.length && !natural.length) return null;
  const picks = currentPicks(quote);

  return (
    <section className="section" style={{ paddingTop: 0 }}>
      {ideas.length > 0 && <>
        <div className="row between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>You might not have thought of</h2>
          <span className="badge badge-demo">AI scanned every live market</span>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>Markets that move with your costs or your customers&apos; wallets, not just your weather. Looser fit, so we show how strong the link is.</p>
        <div className={s.ideas}>
          {ideas.map((r) => {
            const opt = quote.options?.find((o) => o.riskId === r.id);
            const chosen = picks[r.id] ? opt?.choices.find((c) => c.contractId === picks[r.id]) : undefined;
            const shown = chosen ?? opt?.choices[0];
            const inPlan = !!chosen;
            const line = quote.lines.find((l) => l.riskId === r.id);
            return (
              <article key={r.id} className={s.idea}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="eyebrow">{PERIL_ICON[r.peril] ?? "•"} {PERIL_LABEL[r.peril] ?? r.peril}{r.window ? ` · ${r.window}` : ""}</span>
                  <CorrelationBadge risk={r} />
                </div>
                <h3>{r.title}</h3>
                {r.causalStory && <p className={s.story}>{r.causalStory}</p>}
                <div className="row between xs"><span className="muted">If it hits</span><b className="num bad">~{usd(r.lossUsd)}</b></div>
                {shown ? (
                  <div className={s.market}>
                    <div><b>{choiceLabel(shown)}</b> <span className="muted">· {VENUE_LABEL[shown.contract.venue] ?? shown.contract.venue}</span></div>
                    <div className="xs muted">{shown.contract.eventTitle} · {cents(shown.pricePerContract)} per $1 · closes {shortExpiry(shown.contract.expiry)}</div>
                    {inPlan && line && <div className="xs">In plan: {usd(line.premiumUsd, 2)} premium for {usd(line.payoutUsd)} payout</div>}
                  </div>
                ) : <div className={s.market}><span className="muted">No live market for this right now; we&apos;ll keep watching.</span></div>}
                {r.worthIt && <p className={s.worth}><b>Worth it?</b> {r.worthIt}</p>}
                {opt && opt.choices.length > 1 && (
                  <div className={s.choices}>
                    {opt.choices.map((c) => (
                      <button key={c.contractId} className={s.choice} aria-pressed={picks[r.id] === c.contractId} title={c.rationale}
                        onClick={() => onChange(applyPicks(quote, { ...picks, [r.id]: c.contractId }, coverage))}>
                        <span className={s.tier}>{c.tier ?? "Option"}</span>
                        <span className={s.nums}>{c.contract.label} · {cents(c.pricePerContract)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {opt && (
                  <div className="row" style={{ marginTop: "auto" }}>
                    {inPlan
                      ? <button className="btn btn-sm" onClick={() => onChange(applyPicks(quote, { ...picks, [r.id]: null }, coverage))}>✓ In plan · Remove</button>
                      : <button className="btn btn-primary btn-sm" onClick={() => onChange(applyPicks(quote, { ...picks, [r.id]: opt.choices[0].contractId }, coverage))}>Add to plan</button>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </>}
      {natural.length > 0 && <>
        <h3 style={{ margin: "22px 0 4px" }}>Natural hedges: don&apos;t pay to insure these</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Some &ldquo;risks&rdquo; actually help you. Hedging them would cost premium and cancel a gain.</p>
        <div className="grid grid-2">
          {natural.map((n, i) => (
            <div key={i} className={s.nat}>
              <div className="row between" style={{ gap: 8, marginBottom: 4 }}>
                <h3>{PERIL_ICON[n.peril] ?? "•"} {n.title}</h3>
                <span className="badge badge-good">{ADVICE[n.advice] ?? n.advice}</span>
              </div>
              <p>{n.explanation}</p>
            </div>
          ))}
        </div>
      </>}
    </section>
  );
}
