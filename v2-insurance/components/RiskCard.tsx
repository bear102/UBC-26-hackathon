"use client";
import type { BusinessProfile, QuoteLine, Risk } from "@/lib/types";
import { WhyThisHedge } from "./explain/WhyThisHedge";
import { cents, explorerTx, pct, PERIL_ICON, PERIL_LABEL, shortDate, usd, VENUE_LABEL, VENUE_ROLE } from "@/lib/client/format";
import type { CheckoutResult } from "./CheckoutDialog";
import { RiskInsights } from "./plan/CreativeHedges";
import s from "./RiskCard.module.css";

export function VenueBadge({ venue }: { venue: string }) {
  return <span className={`badge badge-${venue}`}>{VENUE_LABEL[venue] ?? venue}</span>;
}

export function Confidence({ value }: { value: number }) {
  const n = Math.round(Math.max(0, Math.min(1, value)) * 5);
  return (
    <span className="conf" title={`AI confidence ${pct(value)}`} aria-label={`Confidence ${pct(value)}`}>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < n ? "on" : ""} />)}
    </span>
  );
}

export function RiskCard({ risk, lines, bought, onBuy, onCover, profile }: {
  risk: Risk; lines: QuoteLine[]; bought: Record<string, CheckoutResult>; profile?: Pick<BusinessProfile, "avgDailyRevenueUsd"> | null;
  onBuy: (l: QuoteLine) => void; onCover: (l: QuoteLine) => void;
}) {
  return (
    <article className={s.card}>
      <div className={s.risk}>
        <div className="row" style={{ gap: 10 }}>
          <span className={s.icon} aria-hidden="true">{PERIL_ICON[risk.peril] ?? "•"}</span>
          <span className="eyebrow">{PERIL_LABEL[risk.peril] ?? risk.peril}{risk.window ? ` · ${risk.window}` : ""}</span>
        </div>
        <h3 className={s.title}>{risk.title}</h3>
        <p className={s.trigger}><span className="xs muted">Trigger</span><br />{risk.trigger}</p>
        <div className={s.loss}>
          <span className="xs muted">Estimated loss if it happens</span>
          <b className="num bad">~{usd(risk.lossUsd)}</b>
        </div>
        <p className="small" style={{ color: "var(--ink-2)" }}>{risk.lossReasoning}</p>
        <div className="row xs muted" style={{ gap: 8 }}>AI confidence <Confidence value={risk.confidence} /> <span className="num">{pct(risk.confidence)}</span></div>
        <RiskInsights risk={risk} />
      </div>

      <div className={s.hedges}>
        {lines.map((l) => {
          const c = l.contract;
          const hedgeDone = bought[`hedge:${l.contractId}`];
          const coverDone = bought[`cover:${l.contractId}`];
          const zero = l.contracts <= 0;
          return (
            <div key={l.contractId} className={s.hedge}>
              <div className="row between" style={{ gap: 8 }}>
                <span className="eyebrow">Matched market{l.tier ? <> · <span style={{ color: "var(--brand)" }}>{l.tier}</span></> : null}</span>
                <VenueBadge venue={c.venue} />
              </div>
              <p className={s.event}>{c.eventTitle}</p>
              <p className={s.label}>Buy <b>{l.side.toUpperCase()}</b> · {c.label}</p>
              <div className="row xs" style={{ gap: 6, flexWrap: "wrap", margin: "-2px 0 8px" }}>
                <span className="muted">{c.venue === "gemini" && l.action !== "buy-onchain" ? "Priced on Gemini" : VENUE_ROLE[c.venue] ?? c.venue}</span>
                {l.crossCheck && (
                  <a className="badge badge-polymarket" href={l.crossCheck.url} target="_blank" rel="noreferrer"
                    title={`${l.crossCheck.exact ? "Same event" : "Similar market"} on Polymarket: ${l.crossCheck.title}`}>
                    Cross-check · Polymarket {pct(l.crossCheck.prob)}{Math.abs(l.crossCheck.diffPts) >= 1 ? ` (${l.crossCheck.diffPts > 0 ? "+" : ""}${l.crossCheck.diffPts} pts here)` : " · agrees"}
                  </a>
                )}
              </div>
              <WhyThisHedge line={l} risk={risk} profile={profile}>
              <div className={s.stats}>
                <div><span>Market odds</span><b className="num">{pct(l.impliedProb)}</b></div>
                <div><span>Price / $1</span><b className="num">{cents(l.pricePerContract)}</b></div>
                <div><span>Expires</span><b>{shortDate(c.expiry)}</b></div>
              </div>
              <div className={s.payline}>
                <div><span className="xs muted">Pays</span><b className="num pay">{usd(l.payoutUsd)}</b></div>
                <div><span className="xs muted">Costs</span><b className="num cost">{usd(l.premiumUsd, 2)}</b></div>
                <div><span className="xs muted">Contracts</span><b className="num">{l.contracts.toLocaleString()}</b></div>
              </div>
              {l.maxCoverable != null && l.contracts > 0 && l.contracts >= Math.floor(l.maxCoverable) && <p className="xs" style={{ color: "var(--gold)", margin: "0 0 8px" }}>Book depth limits this hedge to {l.maxCoverable.toLocaleString()} contracts.</p>}
              {zero && <p className="xs" style={{ color: "var(--gold)", margin: "0 0 8px" }}>Left out to stay inside your monthly budget. Raise the budget or lower coverage.</p>}
              <p className={s.why}>{l.rationale}</p>
              <p className={s.basis}><b>Basis risk:</b> {l.basisRisk}</p>
              </WhyThisHedge>

              <div className={s.actions}>
                {l.action === "buy-onchain" && (hedgeDone
                  ? <a className="btn btn-sm" href={hedgeDone.simulated ? "/dashboard" : explorerTx(hedgeDone.signature, hedgeDone.network)} target={hedgeDone.simulated ? undefined : "_blank"} rel="noreferrer">✓ Hedge bought {hedgeDone.simulated ? "" : "↗"}</a>
                  : <button className="btn btn-primary btn-sm" disabled={zero} onClick={() => onBuy(l)}>Buy hedge (devnet)</button>)}
                {l.action === "open-on-gemini" && (
                  <a className="btn btn-primary btn-sm" href={c.url || "https://www.gemini.com/prediction-markets"} target="_blank" rel="noreferrer">
                    Open on Gemini ↗
                  </a>
                )}
                {l.action === "read-only" && (c.url
                  ? <a className="badge badge-neutral" href={c.url} target="_blank" rel="noreferrer">Context only · view on {VENUE_LABEL[c.venue] ?? c.venue} ↗</a>
                  : <span className="badge badge-neutral">Context only · not tradable here</span>)}
                {l.action !== "read-only" && (coverDone
                  ? <span className="badge badge-good">✓ Hedgehog Cover active</span>
                  : <button className="btn btn-gold btn-sm" disabled={zero} onClick={() => onCover(l)}>Get Hedgehog Cover instead</button>)}
                {c.venue === "gemini" && l.action === "buy-onchain" && (
                  <a className="btn btn-ghost btn-sm" href={c.url || "https://www.gemini.com/predictions"} target="_blank" rel="noreferrer">Open on Gemini ↗</a>
                )}
              </div>
              {c.venue === "gemini" && l.action === "buy-onchain" && <p className="xs muted" style={{ margin: "6px 0 0" }}>Priced off Gemini&apos;s live book. You get Solana tokens; Hedgehog backs them with the same {l.side.toUpperCase()} contract on Gemini.</p>}
              {l.action === "open-on-gemini" && <p className="xs muted" style={{ margin: "6px 0 0" }}>Buy {l.contracts.toLocaleString()} × “{c.label}” at ≤ {cents(l.pricePerContract)} in your Gemini account.</p>}
            </div>
          );
        })}
      </div>
    </article>
  );
}
