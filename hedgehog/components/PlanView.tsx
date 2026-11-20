"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { BusinessProfile, ClarifyAnswer, ClarifyQuestion, Quote, QuoteLine, Risk } from "@/lib/types";
import { advise, adviseQuestions, coverReprice, getPolicies, getPresets } from "@/lib/client/api";
import { rescaleQuote, type Coverage } from "@/lib/client/quote";
import { clearQuotes, lastBusiness, lastOwner, lastQuotePct, loadClarify, loadProfile, loadQuote, saveClarify, saveProfile, saveQuote, setLastBusiness } from "@/lib/client/storage";
import { FIXTURE_PRESETS } from "@/lib/fixtures";
import { plainError } from "@/lib/client/errors";
import { usd } from "@/lib/client/format";
import { AdviseProgress } from "./AdviseProgress";
import { RiskCard } from "./RiskCard";
import { PlanExplainer } from "./explain/PlanExplainer";
import { PlanChoices } from "./plan/PlanChoices";
import { CreativeHedges } from "./plan/CreativeHedges";
import { ClarifyQuestions, ClarifyRecap } from "./plan/ClarifyQuestions";
import { QuoteTable } from "./QuoteTable";
import { CheckoutDialog, type CheckoutKind, type CheckoutResult } from "./CheckoutDialog";
import { CoverChecklist, CoverSteps, NextStepBar, coverItems, type CoverItem } from "./plan/CoverChecklist";
import { CoverAllDialog } from "./plan/CoverAllDialog";
import { QuoteReveal } from "./plan/QuoteReveal";
import { PlanTour, tourDone } from "./plan/PlanTour";

/** Reveal + tour are for people. Off under browser automation (navigator.webdriver) unless the URL has ?fx=1. */
const fxAllowed = () => typeof window !== "undefined" && (!navigator.webdriver || new URLSearchParams(window.location.search).get("fx") === "1");
import { HeadsUp } from "./plan/HeadsUp";
import { IconArrowRight, IconCheck } from "./Icons";
import s from "./PlanView.module.css";

const COVS: Coverage[] = [25, 50, 100];
/** "4:02 PM" today; "Nov 19, 4:02 PM" for an older quote, so a stale price is visible. */
const pricedAt = (iso: string) => {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = d.toDateString() === new Date().toDateString() ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return d.toLocaleString([], opts);
};
const asCov = (n: number | null): Coverage => (n === 25 || n === 100 ? n : 50);

export function PlanView() {
  const router = useRouter();
  const params = useSearchParams();
  const [bizId, setBizId] = useState<string | null>(params.get("b"));
  const [cov, setCov] = useState<Coverage>(asCov(params.get("c") ? Number(params.get("c")) : null));
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [local, setLocal] = useState(false); // rescaled client-side, not re-run through the AI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [checkout, setCheckout] = useState<{ kind: CheckoutKind; line: QuoteLine } | null>(null);
  const [bought, setBought] = useState<Record<string, CheckoutResult>>({});
  const [coverAll, setCoverAll] = useState<CoverItem[] | null>(null); // frozen at open, so the receipt keeps its lines
  const reqId = useRef(0);
  const bindRef = useRef<HTMLElement>(null);
  // "Quote ready" reveal: only when the AI just built the first quote on this visit (never for a cached quote).
  const [reveal, setReveal] = useState(false);
  const [touring, setTouring] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [droppedCount, setDroppedCount] = useState(0); // risks removed by the last Refresh prices (for the note caption)
  const hadQuote = useRef(false);
  // Quick questions before the quote (null = not asking). `edit` = re-answering on an existing plan.
  const [asking, setAsking] = useState<{ questions: ClarifyQuestion[]; previous: ClarifyAnswer[]; edit: boolean } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  // Already covered (survives reload): this owner's open policies for this business, from the chain.
  const { publicKey } = useWallet();
  useEffect(() => {
    const owner = publicKey?.toBase58() ?? lastOwner();
    if (!owner || !profile) return;
    let live = true;
    getPolicies(owner).then((ps) => {
      if (!live) return;
      const have: Record<string, CheckoutResult> = {};
      for (const p of ps) {
        if (p.status !== "open" || p.businessId !== profile.id || !p.marketRef) continue;
        have[`cover:${p.marketRef}`] = { kind: "cover", signature: p.txSig ?? "", network: "devnet", policyId: p.policyId, policyPda: p.policyPda };
      }
      setBought((b) => ({ ...have, ...b }));
    }).catch(() => {});
    return () => { live = false; };
  }, [publicKey, profile]);

  // Resolve the business profile (URL → storage → presets).
  useEffect(() => {
    let id = bizId;
    if (!id) { id = lastBusiness(); if (id) setBizId(id); else { setMissing(true); return; } }
    const p = loadProfile(id);
    if (p) { setProfile(p); return; }
    const fx = FIXTURE_PRESETS.find((x) => x.id === id);
    getPresets().then((ps) => {
      const hit = ps.find((x) => x.id === id) ?? fx;
      if (hit) { saveProfile(hit); setProfile(hit); } else setMissing(true);
    }).catch(() => (fx ? setProfile(fx) : setMissing(true)));
  }, [bizId]);

  const runAdvise = useCallback(async (p: BusinessProfile, c: Coverage, answers?: ClarifyAnswer[]) => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const q = await advise(p, c, answers ?? loadClarify(p)?.answers);
      if (my !== reqId.current) return;
      clearQuotes(p.id); saveQuote(q, c); setQuote(q); setLocal(false); // older coverage levels were sized from the old quote
      if (!hadQuote.current && fxAllowed()) setReveal(true);
    } catch (e) {
      if (my === reqId.current) setError(plainError(e));
    } finally { if (my === reqId.current) setLoading(false); }
  }, []);

  // Before the first AI quote: ask 0-3 quick questions (answers cached per business, so a refresh doesn't re-ask).
  const startQuote = useCallback(async (p: BusinessProfile, c: Coverage) => {
    const stored = loadClarify(p);
    if (stored) { runAdvise(p, c, stored.answers); return; }
    const my = ++reqId.current;
    setLoading(true); setError(null);
    const questions = await adviseQuestions(p);
    if (my !== reqId.current) return;
    if (!questions.length) { saveClarify(p, [], []); runAdvise(p, c, []); return; }
    setAsking({ questions, previous: [], edit: false });
  }, [runAdvise]);

  const submitAnswers = useCallback(async (answers: ClarifyAnswer[]) => {
    if (!profile || !asking) return;
    const { questions, edit } = asking;
    saveClarify(profile, questions, answers);
    setAsking(null);
    if (!edit) { runAdvise(profile, cov, answers); return; }
    clearQuotes(profile.id);
    setRebuilding(true);
    await runAdvise(profile, cov, answers);
    setRebuilding(false);
  }, [profile, asking, cov, runAdvise]);

  const editAnswers = useCallback(async () => {
    if (!profile) return;
    const stored = loadClarify(profile);
    const questions = stored?.questions.length ? stored.questions : await adviseQuestions(profile);
    if (!questions.length) return;
    setAsking({ questions, previous: stored?.answers ?? quote?.clarifications ?? [], edit: true });
  }, [profile, quote]);

  // First quote: cached for this coverage, or rescale another cached one, or call the AI.
  useEffect(() => {
    if (!profile || quote) return;
    setLastBusiness(profile.id);
    const cached = loadQuote(profile.id, cov);
    if (cached) { setQuote(cached); return; }
    const lp = lastQuotePct(profile.id);
    const other = lp ? loadQuote(profile.id, lp) : null;
    if (other) { setQuote(rescaleQuote(other, cov)); setLocal(true); return; }
    startQuote(profile, cov);
  }, [profile, quote, cov, startQuote]);

  function changeCoverage(c: Coverage) {
    if (c === cov) return;
    setCov(c);
    const sp = new URLSearchParams(window.location.search); sp.set("c", String(c)); if (profile) sp.set("b", profile.id);
    router.replace(`/plan?${sp.toString()}`, { scroll: false });
    if (!profile || !quote) return;
    // re-size what's on screen (keeps the chosen plan and any loss edits; QA #6), and remember it for this coverage
    const q = rescaleQuote(quote, c);
    saveQuote(q, c); setQuote(q); setLocal(true);
  }

  useEffect(() => { if (quote && !reveal) hadQuote.current = true; }, [quote, reveal]);
  // First visit: walk through the finished plan once the reveal (if any) is over.
  useEffect(() => {
    if (!quote || reveal || loading || asking || touring || tourDone() || !fxAllowed()) return;
    const t = setTimeout(() => setTouring(true), 700);
    return () => clearTimeout(t);
  }, [quote, reveal, loading, asking, touring]);

  const risksById = useMemo(() => new Map<string, Risk>((quote?.risks ?? []).map((r) => [r.id, r])), [quote]);
  const linesByRisk = useMemo(() => {
    const m = new Map<string, QuoteLine[]>();
    for (const l of quote?.lines ?? []) m.set(l.riskId, [...(m.get(l.riskId) ?? []), l]);
    return m;
  }, [quote]);

  if (missing) return (
    <section className="section"><div className="container narrow">
      <div className="card card-dashed stack"><span className="eyebrow">Step 3</span><h2 style={{ margin: 0 }}>No business <em>selected</em></h2><p className="muted" style={{ margin: 0 }}>Pick a preset or describe your business to get a hedge plan.</p><div><Link className="btn btn-primary" href="/">Start <IconArrowRight size={16} /></Link></div></div>
    </div></section>
  );
  if (profile && asking) return (
    <section className="section"><div className="container">
      <ClarifyQuestions questions={asking.questions} previous={asking.previous} name={profile.name}
        onSubmit={submitAnswers} onCancel={asking.edit ? () => setAsking(null) : undefined} />
    </div></section>
  );
  if (!profile || (loading && !quote) || rebuilding) return <section className="section"><div className="container"><AdviseProgress name={profile?.name} /></div></section>;
  if (error && !quote) return (
    <section className="section"><div className="container narrow">
      <div className="card stack">
        <div className="doc-head"><span className="caps-title">Underwriting halted</span><span className="meta">{profile.name}</span></div>
        <h2 style={{ margin: 0 }}>We couldn&apos;t build <em>the plan</em></h2>
        <div className="alert alert-bad" role="alert">{error}</div>
        <div className="row"><button className="btn btn-primary" onClick={() => runAdvise(profile, cov)}>Try again</button><Link href={`/intake?preset=${profile.id}`} className="btn">Edit details</Link></div>
      </div>
    </div></section>
  );
  if (!quote) return <section className="section"><div className="container"><AdviseProgress name={profile.name} /></div></section>;

  const budget = quote.budgetUsd || profile.monthlyBudgetUsd;
  const used = quote.totalPremiumUsd;
  const budgetPct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
  const coveredRisks = quote.risks.filter((r) => linesByRisk.has(r.id));
  // creative (proxy) ideas live in their own section, never under "Not coverable"
  const proxyIds = new Set(quote.risks.filter((r) => r.kind === "proxy").map((r) => r.id));
  const notCoverable = quote.uncovered.filter((u) => !proxyIds.has(u.riskId) && !linesByRisk.has(u.riskId));
  const uncoveredIds = new Set([...quote.uncovered.map((u) => u.riskId), ...proxyIds]);
  const applyChoice = (q: Quote) => { saveQuote(q, cov); setQuote(q); setLocal(true); };
  // Owner corrects the AI's loss estimate: re-size that hedge (and the budget fit) instantly, no AI call.
  const editLoss = (riskId: string, usdValue: number) => {
    if (!quote) return;
    const risks = quote.risks.map((r) => (r.id === riskId ? { ...r, lossUsdAi: r.lossUsdAi ?? r.lossUsd, lossUsd: usdValue } : r));
    const q = rescaleQuote({ ...quote, risks }, cov);
    saveQuote(q, cov); setQuote(q); setLocal(true);
  };
  const totalLoss = coveredRisks.reduce((a, r) => a + r.lossUsd, 0);
  const items = coverItems(quote.lines, risksById, (l) => !!bought[`cover:${l.contractId}`], profile);
  const doneCount = items.filter((i) => i.done).length;
  const startCover = (line: QuoteLine) => setCheckout({ kind: "cover", line });
  /** Re-price every buyable line at the live ask (no AI), re-fit coverage + budget, and show it. Returns the new
   *  not-yet-covered items so an open "Cover all" dialog can continue with them. */
  const refreshPrices = async (): Promise<CoverItem[]> => {
    // Re-price the plan's lines AND every alternative (options feed the plan switcher), so nothing stale survives.
    const seen = new Set<string>();
    const all: { marketRef: string; side: "yes" | "no" }[] = [];
    for (const l of [...quote.lines.filter((x) => x.action !== "read-only"), ...(quote.options ?? []).flatMap((o) => o.choices)]) {
      const k = `${l.contractId}|${l.side}`;
      if (!seen.has(k)) { seen.add(k); all.push({ marketRef: l.contractId, side: l.side }); }
    }
    const r = await coverReprice(all);
    const ask = new Map(r.lines.map((x) => [`${x.marketRef}|${x.side}`, x.ask]));
    // A contract that can't be bought any more (closed, delisted, or not sellable on our program) is dropped with the right reason.
    const why = (err = "") => /not coverable/i.test(err) ? "Can't be bought on our program yet."
      : /not found/i.test(err) ? "Its market is no longer listed."
      : /market is (closed|settled)/i.test(err) ? "Its market has closed since this quote." : null;
    const shut = new Map<string, string>();
    for (const x of r.lines) { const w = x.ask == null ? why(x.error) : null; if (w) shut.set(`${x.marketRef}|${x.side}`, w); }
    const shutIds = new Set([...shut.keys()].map((k) => k.slice(0, k.lastIndexOf("|"))));
    const lines = quote.lines.filter((l) => !shut.has(`${l.contractId}|${l.side}`)).map((l) => {
      const a = ask.get(`${l.contractId}|${l.side}`);
      return a == null ? l : { ...l, pricePerContract: a };
    });
    const options = quote.options?.map((o) => ({
      ...o,
      choices: o.choices.filter((c) => !shut.has(`${c.contractId}|${c.side}`)).map((c) => {
        const a = ask.get(`${c.contractId}|${c.side}`);
        return a == null ? c : { ...c, pricePerContract: a };
      }),
    }));
    // plans must not point at dropped contracts, or "Selected" never matches and their totals include them
    const packages = quote.packages?.map((p) => ({ ...p, picks: p.picks.filter((x) => !shutIds.has(x.contractId)) }));
    const hasAlt = (riskId: string) => !!options?.some((o) => o.riskId === riskId && o.choices.length > 0); // another plan can still cover it
    const dropped = quote.lines.filter((l) => shut.has(`${l.contractId}|${l.side}`) && !lines.some((k) => k.riskId === l.riskId) && !hasAlt(l.riskId) && !quote.uncovered.some((u) => u.riskId === l.riskId));
    const removedCount = quote.lines.filter((l) => shut.has(`${l.contractId}|${l.side}`)).length;
    const uncovered = [...quote.uncovered, ...dropped.map((l) => ({ riskId: l.riskId, reason: shut.get(`${l.contractId}|${l.side}`)! }))];
    const q = rescaleQuote({ ...quote, lines, uncovered, ...(options ? { options } : {}), ...(packages ? { packages } : {}), createdAt: r.at }, cov);
    saveQuote(q, cov); setQuote(q); setLocal(true);
    if (removedCount) setDroppedCount((n) => n + removedCount);
    const byId = new Map(q.risks.map((x) => [x.id, x]));
    return coverItems(q.lines, byId, (l) => !!bought[`cover:${l.contractId}`], profile).filter((i) => !i.done);
  };

  return (
    <div className="container">
      <section className="page-head">
        <div>
          <span className="eyebrow">Step 3</span>
          <h1 className={s.title}>{profile.name}</h1>
        </div>
        <p className={s.meta}><button type="button" className={s.tourLink} onClick={() => setTouring(true)}>Show me around</button>{" · "}{[profile.city, profile.zip].filter(Boolean).join(" · ")} · {usd(profile.avgDailyRevenueUsd)}/day · busy {profile.busyDays.join(", ") || "—"}
          {" · "}<Link href={`/intake?preset=${encodeURIComponent(profile.id)}`}>Edit</Link></p>
      </section>

      <CoverSteps total={items.length} done={doneCount} />
      <HeadsUp profile={profile} quote={quote} onCover={startCover} />

      <section className={s.schedGrid}>
        <div className={s.left}>
          <div className={`card ${s.ai}`} data-tour="note">
            <div className="doc-head">
              <span className="caps-title">Underwriter&apos;s note</span>
            </div>
            <p className={s.summary}>{quote.summary}</p>
            {local && <p className="xs muted">Written for the original quote; numbers below are current.{droppedCount > 0 && <> {droppedCount === 1 ? "One risk it mentions can" : `${droppedCount} risks it mentions can`} no longer be bought and {droppedCount === 1 ? "was" : "were"} removed.</>}</p>}
            {error && !loading && <div className="alert alert-bad small" role="alert">Couldn&apos;t re-run the AI: {error}. Your current plan is unchanged.</div>}
            <ClarifyRecap answers={quote.clarifications ?? loadClarify(profile)?.answers} asked={!!loadClarify(profile)?.questions.length} onEdit={editAnswers} busy={loading} />
            <p className={`xs ${s.venues}`}>
              <span className="badge badge-gemini">Priced live: Gemini · Kalshi · Polymarket</span>
              <span className="badge badge-kalshi">Settled on Solana</span>
            </p>
          </div>

          <div data-tour="schedule"><QuoteTable quote={quote} /></div>
        </div>

        <aside ref={bindRef} className={`bind ${s.bind}`} aria-label="Your quote">
          <div className="bind-inner">
            <div className={s.bindTop}>
              <span className="bind-k">Your quote</span>
              <div className="seg" role="group" aria-label="Coverage level" data-tour="coverage">
                {COVS.map((c) => <button key={c} aria-pressed={cov === c} onClick={() => changeCoverage(c)}>{c}%</button>)}
              </div>
            </div>
            <div className="bind-big pay"><span>Pays out if it happens</span><b>{usd(quote.totalPayoutUsd)}</b></div>
            <div className="bind-big"><span>Premium if it doesn&apos;t</span><b>{usd(quote.totalPremiumUsd, 2)}</b></div>
            <div className={s.budget}>
              <div className={s.budgetRow}>
                <span>Premium vs. monthly budget</span>
                <span className="num"><b>{usd(used, 0)}</b> of {usd(budget)}</span>
              </div>
              <div className={`bar ${used > budget + 0.01 ? "over" : ""}`}><i style={{ width: `${budgetPct}%` }} /></div>
            </div>
            <p className={s.bindSummary}>
              Pays up to {usd(quote.totalPayoutUsd)} of ~{usd(totalLoss)} in estimated losses across {coveredRisks.length} risk{coveredRisks.length === 1 ? "" : "s"}{quote.totalPayoutUsd < (totalLoss * cov) / 100 * 0.9 ? ", limited by your budget" : ""}.
              {local && <> Resized at current prices. <button className={s.linkBtn} onClick={() => runAdvise(profile, cov)} disabled={loading}>{loading ? "Re-running…" : "Re-run AI"}</button></>}
            </p>
            <CoverChecklist items={items} onCover={startCover} onCoverAll={() => setCoverAll(items.filter((i) => !i.done))} />
            <ul className="assure">
              <li><IconCheck size={14} />Pays to your wallet when the market settles. No claim forms.</li>
              <li><IconCheck size={14} />Your policy and its vault are public on Solana.</li>
            </ul>
          </div>
        </aside>
      </section>

      <PlanExplainer quote={quote} profile={profile} />

      <PlanChoices quote={quote} coverage={cov} onChange={applyChoice} />

      <section className={`section ${s.risks}`} id="risks">
        <div className="sec-head">
          <div><span className="eyebrow">Each risk in detail</span><h2>Your risks, <em>matched to markets</em></h2></div>
          <span className={`muted small ${s.quoted}`}>{loading || repricing ? <><span className="spinner" /> refreshing…</> : <>
            Priced {pricedAt(quote.createdAt)}
            {" · "}<button type="button" className={s.tourLink} onClick={async () => { setRepricing(true); try { await refreshPrices(); } finally { setRepricing(false); } }}>Refresh prices</button>
          </>}</span>
        </div>
        <div className="stack">
          {coveredRisks.map((r, i) => (
            <RiskCard key={r.id} index={i + 1} total={coveredRisks.length} risk={r} lines={linesByRisk.get(r.id) ?? []} bought={bought} profile={profile}
              onBuy={(line) => setCheckout({ kind: "hedge", line })} onCover={(line) => setCheckout({ kind: "cover", line })} onLossChange={editLoss} />
          ))}
        </div>
      </section>

      <CreativeHedges quote={quote} coverage={cov} onChange={applyChoice} />

      {(notCoverable.length > 0 || quote.risks.some((r) => !linesByRisk.has(r.id) && !uncoveredIds.has(r.id))) && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="sec-head">
            <div><span className="eyebrow">Exclusions</span><h2>Not coverable <em>(yet)</em></h2></div>
          </div>
          <div className="grid grid-2">
            {[...notCoverable, ...quote.risks.filter((r) => !linesByRisk.has(r.id) && !uncoveredIds.has(r.id))
              .map((r) => ({ riskId: r.id, reason: quote.options?.some((o) => o.riskId === r.id && o.choices.length > 0)
                ? "Not in this plan. Pick a plan above that includes it."
                : "No live market matches this risk closely enough." }))].map((u) => {
              const r = risksById.get(u.riskId);
              return (
                <div key={u.riskId} className={`card card-dashed ${s.excl}`}>
                  <div className="row between" style={{ alignItems: "baseline" }}><h3 style={{ margin: 0 }}>{r?.title ?? u.riskId}</h3>{r && <span className="num bad small">~{usd(r.lossUsd)} at risk</span>}</div>
                  {r?.trigger && <p className="small muted" style={{ margin: "4px 0 8px" }}>{r.trigger}</p>}
                  <p className="small" style={{ margin: 0 }}>{u.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {reveal && (
        <QuoteReveal name={profile.name} payoutUsd={quote.totalPayoutUsd}
          lines={items.map((it) => ({ title: it.risk?.title ?? it.line.contract.eventTitle, payoutUsd: it.line.payoutUsd }))}
          onDone={() => { setReveal(false); window.scrollTo({ top: 0 }); }} />
      )}
      {touring && !reveal && <PlanTour onClose={() => setTouring(false)} />}

      <NextStepBar items={items} onCover={startCover} onCoverAll={() => setCoverAll(items.filter((i) => !i.done))} watch={bindRef} />
      <div className={s.barSpace} aria-hidden="true" />

      {coverAll && (
        <CoverAllDialog items={coverAll} businessId={profile.id} budgetUsd={budget} onClose={() => setCoverAll(null)} onRefresh={refreshPrices}
          onDone={({ contractId, ...r }) => setBought((b) => ({ ...b, [`cover:${contractId}`]: r }))} />
      )}

      {checkout && (
        <CheckoutDialog kind={checkout.kind} line={checkout.line} risk={risksById.get(checkout.line.riskId)} businessId={profile.id}
          onClose={() => setCheckout(null)} onRefresh={refreshPrices}
          onDone={(r) => setBought((b) => ({ ...b, [`${r.kind}:${checkout.line.contractId}`]: r }))} />
      )}
    </div>
  );
}
