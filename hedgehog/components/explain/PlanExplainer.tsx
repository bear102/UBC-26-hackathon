"use client";
import type { BusinessProfile, Quote } from "@/lib/types";
import { explainPlan, fmtPct, money } from "@/lib/client/explain";
import { usd } from "@/lib/client/format";
import s from "./explain.module.css";

/** "Your plan in plain English". */
export function PlanExplainer({ quote, profile }: { quote: Quote; profile?: Pick<BusinessProfile, "avgDailyRevenueUsd"> | null }) {
  const pe = explainPlan(quote.lines, quote.risks, profile);
  const w = pe.worst;
  return (
    <section className={`card ${s.plan}`} aria-label="Your plan in plain English">
      <div>
        <span className="eyebrow">In plain English</span>
        {pe.premiumUsd > 0 ? (
          <p className={s.planLead}>
            You pay <b className="cost">{money(pe.premiumUsd)}</b> once
            {pe.dayShare != null ? <> (about <b>{fmtPct(pe.dayShare)}</b> of a normal day&apos;s sales)</> : null}.
            {w?.ex ? <> If your worst day comes (<b>{w.risk.title.charAt(0).toLowerCase() + w.risk.title.slice(1)}</b>), the plan pays <b className="pay">{usd(w.ex.payoutUsd)}</b> toward a ~<b className="bad">{usd(w.risk.lossUsd)}</b> loss.</> : null}
            {" "}If none of it happens, that premium is the whole cost.
          </p>
        ) : (
          <p className={s.planLead}>Nothing in this plan fits the budget yet. Raise the monthly budget or lower the coverage.</p>
        )}
        <div className={s.tally} aria-label="Our take on each hedge">
          {pe.counts.good > 0 && <span className="badge badge-good">{pe.counts.good} worth it</span>}
          {pe.counts.ok > 0 && <span className="badge badge-brand">{pe.counts.ok} optional</span>}
          {pe.counts.skip > 0 && <span className="badge badge-gold">{pe.counts.skip} probably skip</span>}
        </div>
      </div>
    </section>
  );
}
