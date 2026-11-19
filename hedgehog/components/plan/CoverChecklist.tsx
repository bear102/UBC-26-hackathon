"use client";
// Guided "get covered" path on the plan page: a 3-step guide, the buy checklist inside the navy binding panel,
// and a sticky next-step bar. UI only: buying still goes through CheckoutDialog via onCover(line).
import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";
import type { BusinessProfile, QuoteLine, Risk } from "@/lib/types";
import { explainLine } from "@/lib/client/explain";
import { usd } from "@/lib/client/format";
import { IconArrowRight, IconCheck, IconShieldCheck } from "@/components/Icons";
import s from "./CoverChecklist.module.css";

export interface CoverItem { line: QuoteLine; risk: Risk | undefined; recommended: boolean; done: boolean }

/** Lines a user can actually buy, recommended ("Worth it") first, then in plan order. */
export function coverItems(lines: QuoteLine[], risks: Map<string, Risk>, isDone: (l: QuoteLine) => boolean,
  profile?: Pick<BusinessProfile, "avgDailyRevenueUsd"> | null): CoverItem[] {
  return lines
    .filter((l) => l.action !== "read-only" && l.contracts > 0)
    .map((line, i) => {
      const risk = risks.get(line.riskId);
      return { line, risk, recommended: explainLine(line, risk, profile).verdict.tone === "good", done: isDone(line), i };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.i - b.i)
    .map(({ i: _i, ...it }) => it);
}

export const riskAnchor = (riskId: string) => `risk-${riskId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

/** Three-step guide under the page title. */
export function CoverSteps({ total, done }: { total: number; done: number }) {
  const all = total > 0 && done >= total;
  const step = all ? 4 : done > 0 ? 2 : 1;
  const steps = [
    { n: 1, t: "Check your plan", d: "What each risk pays and costs." },
    { n: 2, t: "Press Get covered", d: total ? `On each risk you want. ${done} of ${total} done.` : "On each risk you want." },
    { n: 3, t: "Approve in your wallet", d: "One signature per risk. Payouts are automatic." },
  ];
  return (
    <ol className={s.steps} aria-label="How to get covered">
      {steps.map((x) => {
        const state = all || x.n < step ? "done" : x.n === step || (step === 2 && x.n === 3) ? "now" : "next";
        return (
          <li key={x.n} className={s[state]} aria-current={state === "now" && x.n === step ? "step" : undefined}>
            <span className={s.num}>{state === "done" ? <IconCheck size={14} /> : x.n}</span>
            <span><b>{x.t}</b><small>{x.d}</small></span>
          </li>
        );
      })}
      {all && <li className={s.finish}><Link href="/dashboard" className="btn btn-primary btn-sm">All covered · view my cover <IconArrowRight size={14} /></Link></li>}
    </ol>
  );
}

/** Buy checklist for the navy binding panel. */
export function CoverChecklist({ items, onCover, onCoverAll }: { items: CoverItem[]; onCover: (l: QuoteLine) => void; onCoverAll?: () => void }) {
  const next = items.find((i) => !i.done);
  const done = items.filter((i) => i.done).length;
  const left = items.filter((i) => !i.done);
  const leftCost = left.reduce((a, i) => a + i.line.premiumUsd, 0);
  if (!items.length) return <p className={s.none}>Nothing here can be bought right now.</p>;
  return (
    <div className={s.check}>
      <div className={s.checkHead}><span className="bind-k">Get covered, one risk at a time</span><span className={s.count}>{done}/{items.length}</span></div>
      <ul className={s.list}>
        {items.map((it) => (
          <li key={it.line.contractId} className={it.done ? s.isDone : undefined}>
            <a href={`#${riskAnchor(it.line.riskId)}`} className={s.itemText}>
              <b>{it.risk?.title ?? it.line.riskId}</b>
              <small>{it.recommended && <span className={s.rec}>Recommended</span>}Pays {usd(it.line.payoutUsd)} · costs {usd(it.line.premiumUsd, 2)}</small>
            </a>
            {it.done
              ? <span className={s.doneTag}><IconCheck size={14} /> Covered</span>
              : <button type="button" className={`btn btn-sm btn-on-ink ${s.itemBtn}`} onClick={() => onCover(it.line)}>Get covered</button>}
          </li>
        ))}
      </ul>
      {left.length >= 2 && onCoverAll
        ? <button type="button" className="btn btn-buy" onClick={onCoverAll}><IconShieldCheck size={20} />Cover all {left.length} · {usd(leftCost, 2)}</button>
        : next
        ? <button type="button" className="btn btn-buy" onClick={() => onCover(next.line)}><IconShieldCheck size={20} />{done ? "Cover the next risk" : "Get covered"}</button>
        : <Link className="btn btn-buy" href="/dashboard"><IconCheck size={20} />All covered · view my cover</Link>}
    </div>
  );
}

/** Bottom bar that keeps the next action in reach once the binding panel is off screen. */
export function NextStepBar({ items, onCover, onCoverAll, watch }: { items: CoverItem[]; onCover: (l: QuoteLine) => void; onCoverAll?: () => void; watch: RefObject<HTMLElement | null> }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const el = watch.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { rootMargin: "-80px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);
  if (!items.length) return null;
  const next = items.find((i) => !i.done);
  const done = items.length - items.filter((i) => !i.done).length;
  return (
    <div className={`${s.bar} ${hidden ? s.barHidden : ""}`} role="region" aria-label="Next step" aria-hidden={hidden}>
      <div className={`container ${s.barIn}`}>
        <span className={s.barCount}><b>{done} of {items.length}</b> covered</span>
        {next ? (
          <>
            <a className={s.barNext} href={`#${riskAnchor(next.line.riskId)}`} tabIndex={hidden ? -1 : 0}>
              <small>Next</small><b>{next.risk?.title ?? next.line.riskId}</b>
            </a>
            <span className={s.barPrice}>{usd(next.line.premiumUsd, 2)}</span>
            {onCoverAll && items.filter((i) => !i.done).length >= 2 && (
              <button type="button" className={`btn ${s.barAll}`} tabIndex={hidden ? -1 : 0} onClick={onCoverAll}>Cover all {items.filter((i) => !i.done).length}</button>
            )}
            <button type="button" className="btn btn-primary" tabIndex={hidden ? -1 : 0} onClick={() => onCover(next.line)}>Get covered <IconArrowRight size={15} /></button>
          </>
        ) : (
          <Link className="btn btn-primary" href="/dashboard" tabIndex={hidden ? -1 : 0}>All covered · view my cover <IconArrowRight size={15} /></Link>
        )}
      </div>
    </div>
  );
}
