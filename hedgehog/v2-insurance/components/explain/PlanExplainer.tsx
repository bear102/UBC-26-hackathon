"use client";
import type { BusinessProfile, Quote } from "@/lib/types";
import { explainPlan, fmtPct, money } from "@/lib/client/explain";
import { usd } from "@/lib/client/format";
import { Term } from "./Term";
import s from "./explain.module.css";

/** "Your plan in plain English" + 3-step how-it-works-for-me + glossary words. */
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
        <p className={s.words}>
          <span>Words you&apos;ll see:</span>
          <Term k="premium">premium</Term><Term k="payout">payout</Term><Term k="market odds">market odds</Term>
          <Term k="basis risk">basis risk</Term><Term k="settles">settles</Term><Term k="token">token</Term>
        </p>
      </div>
      <div>
        <span className="eyebrow">How it works for you</span>
        <ol className={s.steps3} style={{ marginTop: 8 }}>
          <li><div><b>Pay once, now</b><span>One wallet approval. This demo uses <Term k="devnet">test dollars</Term>.</span></div></li>
          <li><div><b>The day plays out</b><span>We check the official result: weather station, final score or price index.</span></div></li>
          <li><div><b>Money lands automatically</b><span>If it happened, the payout hits your wallet within hours. No claim forms.</span></div></li>
        </ol>
      </div>
    </section>
  );
}
