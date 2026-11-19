"use client";
import type { MarketContract, Position, Risk } from "@/lib/types";
import { explainPosition, fmtPct, untilPhrase } from "@/lib/client/explain";
import { usd } from "@/lib/client/format";
import s from "./explain.module.css";

/** Dashboard: what this position means for the business, in one or two sentences. */
export function PositionStory({ position, risk, contract, mark }: {
  position: Position; risk?: Risk | null; contract?: Partial<MarketContract> | null; mark?: number | null;
}) {
  const pe = explainPosition(position, { risk, contract, mark });
  return (
    <div className={`${s.pstory} ${s[`ps_${pe.tone}`]}`}>
      <p className={s.head}>{pe.headline}</p>
      {pe.lines.map((l, i) => <p key={i}>{l}</p>)}
      {pe.odds && <p>{pe.odds}</p>}
      {pe.coveredShare != null && (
        <>
          <div className={s.cover} role="img" aria-label={`Payout covered ${fmtPct(Math.min(1, pe.coveredShare))} of the estimated loss`}>
            <i style={{ width: `${Math.min(100, pe.coveredShare * 100)}%` }} />
          </div>
          <p className="xs muted">Green = paid back · red = the rest of the estimated loss</p>
        </>
      )}
    </div>
  );
}

/** Dashboard: one-line story for a Hedgehog Cover policy. */
export function PolicyStory({ status, payoutUsd, premiumUsd, trigger, expiry }: { status: string; payoutUsd: number; premiumUsd: number; trigger?: string; expiry?: string }) {
  const paid = /paid|settled_yes|won/i.test(status);
  const open = /open|active|pending/i.test(status);
  const tone = paid ? "paid" : open ? "open" : "expired";
  return (
    <div className={`${s.pstory} ${s[`ps_${tone}`]}`}>
      {paid ? <p className={s.head}>The trigger hit. Hedgehog paid you {usd(payoutUsd)}.</p>
        : open ? <p className={s.head}>You&apos;re covered{expiry ? ` ${untilPhrase(expiry)}` : ""}.</p>
        : <p className={s.head}>The trigger didn&apos;t hit: a good day for the business.</p>}
      {open && <p>If {trigger ? <>“{trigger}”</> : "the trigger hits"}, Hedgehog pays {usd(payoutUsd)} straight to your wallet from its reserve. You paid {usd(premiumUsd, 2)}.</p>}
      {!open && !paid && <p>The {usd(premiumUsd, 2)} premium was the cost of being covered.</p>}
    </div>
  );
}
