import type { History, LineExplain } from "@/lib/client/explain";
import { money, signedUsd } from "@/lib/client/explain";
import { usd } from "@/lib/client/format";
import s from "./explain.module.css";

/** 100 dots, `round(p*100)` filled: "28 in 100". */
export function OddsDots({ p, label }: { p: number; label?: string }) {
  const n = Math.max(0, Math.min(100, Math.round(p * 100)));
  return (
    <svg className={s.dots} viewBox="0 0 100 100" role="img" aria-label={label ?? `${n} in 100`}>
      {Array.from({ length: 100 }, (_, i) => (
        <circle key={i} cx={5 + (i % 10) * 10} cy={5 + Math.floor(i / 10) * 10} r={3.4} className={i < n ? s.dotOn : s.dotOff} />
      ))}
    </svg>
  );
}

/** One square per past day/game; filled = it happened. Counts only (not in date order). */
export function HistoryDots({ h }: { h: History }) {
  if (h.total > 90) return null;
  return (
    <span className={s.hist} role="img" aria-label={`${h.hits} of the last ${h.total} ${h.unit}s`}>
      {Array.from({ length: h.total }, (_, i) => <i key={i} className={i < h.hits ? s.hit : ""} />)}
    </span>
  );
}

/** One ledger bar. `recovered` (same units as value) is drawn as an engraved hatched slice after the fill. */
function Bar({ label, value, max, kind, recovered = 0 }: { label: string; value: number; max: number; kind: "loss" | "cost" | "soft"; recovered?: number }) {
  const pct = (v: number) => (max > 0 ? Math.min(100, (Math.abs(v) / max) * 100) : 0);
  const w = pct(value);
  const r = recovered > 0 ? Math.min(100 - w, pct(recovered)) : 0;
  return (
    <div className={s.barRow}>
      <span>{label}</span>
      <span className={s.track} aria-hidden="true">
        {w > 0 && <i className={`${s.fill} ${kind === "cost" ? s.fillCost : kind === "soft" ? `loss-gap ${s.fillGap}` : ""}`} style={{ width: `${w}%` }} />}
        {r > 0 && <i className={`hatch-pay ${s.fillPay}`} style={{ width: `${r}%` }} />}
      </span>
      <b>{signedUsd(value)}</b>
    </div>
  );
}

/** "If it happens" vs "If it doesn't", each with / without the hedge. */
export function Scenarios({ ex }: { ex: LineExplain }) {
  const { happens, doesnt } = ex.scenario;
  const max = Math.max(1, Math.abs(happens.without), Math.abs(happens.withHedge), Math.abs(doesnt.withHedge));
  const saved = happens.withHedge - happens.without;
  return (
    <div className={s.scen}>
      <div className={s.sc}>
        <span className={s.scHead}>If {ex.ifClause}</span>
        <Bar label="No hedge" value={happens.without} max={max} kind="soft" />
        <Bar label="With hedge" value={happens.withHedge} max={max} kind="loss" recovered={happens.without < 0 && happens.withHedge < 0 ? saved : 0} />
        <p className={s.scNote}>You lose {usd(ex.lossUsd)}, the hedge pays {usd(ex.payoutUsd)}{saved > 0 ? <>: <b>{usd(saved)} better off</b>.</> : "."}</p>
      </div>
      <div className={s.sc}>
        <span className={s.scHead}>If it doesn&apos;t</span>
        <Bar label="No hedge" value={doesnt.without} max={max} kind="soft" />
        <Bar label="With hedge" value={doesnt.withHedge} max={max} kind="cost" />
        <p className={s.scNote}>A normal day. You&apos;re out the {money(ex.premiumUsd)} premium.</p>
      </div>
    </div>
  );
}

/**
 * "Normal day vs bad day" (spec §6.3): sales as an ink bar; on the bad day the lost part is outlined in red
 * dashes and the part the hedge pays is engraved hatching. Numbers come from props only.
 */
export function DayBars({ normalUsd, lossUsd, payoutUsd, premiumUsd, normalLabel = "Normal day", badLabel = "Bad day" }: {
  normalUsd: number; lossUsd: number; payoutUsd: number; premiumUsd?: number; normalLabel?: string; badLabel?: string;
}) {
  const max = Math.max(1, normalUsd);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const kept = Math.max(0, normalUsd - lossUsd);
  const paid = Math.min(payoutUsd, lossUsd);
  return (
    <figure className={s.day} aria-label={`${normalLabel}: ${usd(normalUsd)} in sales. ${badLabel}: about ${usd(lossUsd)} lost; the hedge pays ${usd(payoutUsd)}.`}>
      <div className={s.dayRow}>
        <span className={s.dayLab}>{normalLabel}</span>
        <span className={s.dayTrack} aria-hidden="true"><i className={s.daySales} style={{ width: "100%" }} /></span>
        <b className={s.dayFig}>{usd(normalUsd)}</b>
      </div>
      <div className={s.dayRow}>
        <span className={s.dayLab}>{badLabel}</span>
        <span className={s.dayTrack} aria-hidden="true">
          <i className={s.daySales} style={{ width: pct(kept) }} />
          <i className={`loss-gap ${s.dayGap}`} style={{ width: pct(lossUsd) }}>
            <i className={`hatch-pay ${s.dayPay}`} style={{ width: `${lossUsd > 0 ? (paid / lossUsd) * 100 : 0}%` }} />
          </i>
        </span>
        <b className={s.dayFig}>{usd(kept)}</b>
      </div>
      <div className={s.dayRow} aria-hidden="true">
        <span />
        <span className={s.dayNote}><span style={{ marginLeft: pct(kept) }}>↑ hedge pays this part</span></span>
        <span />
      </div>
      <dl className={s.dayKv}>
        <div><dt>Sales lost</dt><dd className="bad">~{usd(lossUsd)}</dd></div>
        <div><dt>The hedge pays</dt><dd className="pay">{usd(payoutUsd)}</dd></div>
        {premiumUsd != null && <div><dt>Premium if it doesn&apos;t happen</dt><dd className="cost">{usd(premiumUsd)}</dd></div>}
      </dl>
    </figure>
  );
}
