"use client";
import type { ReactNode } from "react";
import type { BusinessProfile, QuoteLine, Risk } from "@/lib/types";
import { explainLine, fmtPct, money } from "@/lib/client/explain";
import { cents, usd, VENUE_LABEL } from "@/lib/client/format";
import { Term } from "./Term";
import { HistoryDots, OddsDots, Scenarios } from "./Visuals";
import s from "./explain.module.css";

const ICON = { good: "✓", ok: "•", warn: "!", bad: "✕" } as const;

/**
 * Plain-English "Why this hedge" for one quote line: story, tangible odds, two scenarios, an honest
 * worth-it check, what could go wrong, how you get paid. `children` (the raw market numbers) go
 * inside the "See the analysis" disclosure.
 */
export function WhyThisHedge({ line, risk, profile, children }: {
  line: QuoteLine; risk?: Risk | null; profile?: Pick<BusinessProfile, "avgDailyRevenueUsd"> | null; children?: ReactNode;
}) {
  const ex = explainLine(line, risk, profile);
  const c = line.contract;
  const visiblePitfalls = ex.pitfalls.slice(0, 2);
  const morePitfalls = ex.pitfalls.slice(2);
  const sold = c.venue === "gemini" && line.action === "buy-onchain";

  return (
    <div className={s.why}>
      <div className={`${s.verdict} ${s[`v_${ex.verdict.tone}`]}`} role="note">
        <div>
          <p><b>{ex.verdict.label}.</b> {ex.verdict.reason}</p>
          {risk?.worthIt && <span className={s.advisor}>Advisor: {risk.worthIt}</span>}
        </div>
      </div>

      <p className={s.story}>
        If <b>{ex.ifClause}</b>{ex.when}, you&apos;d lose about <b className={s.lossN}>{usd(ex.lossUsd)}</b>.{" "}
        {ex.inPlan
          ? <>This hedge costs <b className={s.costN}>{money(ex.premiumUsd)}</b> and pays you <b className={s.payN}>{usd(ex.payoutUsd)}</b> if it happens.</>
          : line.action === "read-only" ? <>The market below shows how likely that is.</> : <>This hedge isn&apos;t in your plan right now.</>}
      </p>

      {risk?.kind === "proxy" && risk.causalStory && <p className={s.link}><b>Why it&apos;s linked:</b> {risk.causalStory}</p>}

      <div className={s.odds}>
        <OddsDots p={ex.prob} label={`Market odds: ${Math.round(ex.prob * 100)} in 100`} />
        <div>
          <p>The <Term k="market odds">market</Term> thinks there&apos;s a <b>{fmtPct(ex.prob)}</b> chance: <b>{ex.odds}</b>.</p>
          {ex.history
            ? <p className="small muted">History: it happened on <b style={{ color: "var(--ink)" }}>{ex.history.hits} of the last {ex.history.total}</b> {ex.history.unit}s.<HistoryDots h={ex.history} /></p>
            : risk?.evidence ? <p className="small muted">History: {risk.evidence}</p> : null}
        </div>
      </div>

      {ex.inPlan && <Scenarios ex={ex} />}

      {ex.checks.length > 0 && (
        <div>
          <p className={s.h4}>Is it worth it?</p>
          <ul className={s.checks}>
            {ex.checks.slice(0, 5).map((ck, i) => (
              <li key={i}><span className={`${s.ic} ${s[`t_${ck.tone}`]}`} aria-hidden="true">{ICON[ck.tone]}</span><span>{ck.text}</span></li>
            ))}
          </ul>
        </div>
      )}

      {visiblePitfalls.length > 0 && (
        <div>
          <p className={s.h4}>What could go wrong</p>
          <ul className={s.pitfalls}>{visiblePitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      <p className={s.pay}><span aria-hidden="true">💸</span><span><b>How you get paid:</b> {ex.payment}</span></p>

      <details className={s.more}>
        <summary>See the analysis</summary>
        <div className={s.moreBody}>
          <dl className={s.kv}>
            <dt>What you hold</dt><dd>{ex.sideExplain}</dd>
            <dt>Market used</dt><dd>{c.eventTitle} · “{c.label}” on {VENUE_LABEL[c.venue] ?? c.venue}{line.tier ? ` · ${line.tier}` : ""}</dd>
            <dt>Price</dt><dd>{cents(line.pricePerContract)} per $1 of payout × {line.contracts.toLocaleString()} = {usd(line.premiumUsd, 2)}</dd>
            {c.depthYes != null || c.depthNo != null ? <><dt>For sale now</dt><dd>~{(line.side === "yes" ? c.depthYes : c.depthNo)?.toLocaleString() ?? "—"} contracts near this price{line.maxCoverable != null ? ` (max for you: ${Math.floor(line.maxCoverable).toLocaleString()})` : ""}</dd></> : null}
            {risk?.evidence && <><dt>Backtest</dt><dd>{risk.evidence}</dd></>}
            {risk?.causalStory && risk.kind !== "proxy" && <><dt>Cause → effect</dt><dd>{risk.causalStory}</dd></>}
            {risk?.correlation && <><dt>Link strength</dt><dd>{risk.correlation}</dd></>}
            {sold && <><dt>Backing</dt><dd>Sold to you on Solana; Hedgehog&apos;s desk backs it with a matching order on Gemini.</dd></>}
            {morePitfalls.length > 0 && <><dt>Also note</dt><dd>{morePitfalls.join(" ")}</dd></>}
            <dt>Expected value</dt><dd>On average a hedge pays back a bit less than it costs (the market&apos;s margin), like any insurance. You buy it to <b>smooth out a bad day</b>, not to make money.</dd>
          </dl>
          {children}
        </div>
      </details>
    </div>
  );
}
