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
        <circle key={i} cx={5 + (i % 10) * 10} cy={5 + Math.floor(i / 10) * 10} r={3.6} className={i < n ? s.dotOn : s.dotOff} />
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

function Bar({ label, value, max, kind }: { label: string; value: number; max: number; kind: "loss" | "cost" | "soft" }) {
  const w = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className={s.barRow}>
      <span>{label}</span>
      <span className={s.track} aria-hidden="true"><i className={`${s.fill} ${kind === "cost" ? s.fillCost : kind === "soft" ? s.fillMuted : ""}`} style={{ width: `${w}%` }} /></span>
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
        <Bar label="With hedge" value={happens.withHedge} max={max} kind="loss" />
        <p className={s.scNote}>You lose {usd(ex.lossUsd)}, the hedge pays {usd(ex.payoutUsd)}{saved > 0 ? <>: <b>{usd(saved)} better off</b>.</> : "."}</p>
      </div>
      <div className={s.sc}>
        <span className={s.scHead}>If it doesn&apos;t</span>
        <Bar label="No hedge" value={doesnt.without} max={max} kind="soft" />
        <Bar label="With hedge" value={doesnt.withHedge} max={max} kind="cost" />
        <p className={s.scNote}>A normal day. You&apos;re out the {money(ex.premiumUsd)}, like an insurance premium.</p>
      </div>
    </div>
  );
}
