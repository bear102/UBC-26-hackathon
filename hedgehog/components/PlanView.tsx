"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessProfile, ClarifyAnswer, ClarifyQuestion, Quote, QuoteLine, Risk } from "@/lib/types";
import { advise, adviseQuestions, getPresets } from "@/lib/client/api";
import { rescaleQuote, type Coverage } from "@/lib/client/quote";
import { clearQuotes, lastBusiness, lastQuotePct, loadClarify, loadProfile, loadQuote, saveClarify, saveProfile, saveQuote, setLastBusiness } from "@/lib/client/storage";
import { FIXTURE_PRESETS } from "@/lib/fixtures";
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
import { HeadsUp } from "./plan/HeadsUp";
import { IconArrowRight, IconCheck } from "./Icons";
import s from "./PlanView.module.css";

const COVS: Coverage[] = [25, 50, 100];
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
  // Quick questions before the quote (null = not asking). `edit` = re-answering on an existing plan.
  const [asking, setAsking] = useState<{ questions: ClarifyQuestion[]; previous: ClarifyAnswer[]; edit: boolean } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

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
      saveQuote(q, c); setQuote(q); setLocal(false);
    } catch (e) {
      if (my === reqId.current) setError(e instanceof Error ? e.message : String(e));
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
    const cached = loadQuote(profile.id, c);
    if (cached) { setQuote(cached); setLocal(false); return; }
    setQuote(rescaleQuote(quote, c)); setLocal(true);
  }

  const risksById = useMemo(() => new Map<string, Risk>((quote?.risks ?? []).map((r) => [r.id, r])), [quote]);
  const linesByRisk = useMemo(() => {
    const m = new Map<string, QuoteLine[]>();
    for (const l of quote?.lines ?? []) m.set(l.riskId, [...(m.get(l.riskId) ?? []), l]);
    return m;
  }, [quote]);

  if (missing) return (
    <section className="section"><div className="container narrow">
      <div className="card card-dashed stack"><span className="eyebrow">Step 3 · Your hedge plan</span><h2 style={{ margin: 0 }}>No business <em>selected</em></h2><p className="muted" style={{ margin: 0 }}>Pick a preset or describe your business to get a hedge plan.</p><div><Link className="btn btn-primary" href="/">Start <IconArrowRight size={16} /></Link></div></div>
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
  const notCoverable = quote.uncovered.filter((u) => !proxyIds.has(u.riskId));
  const uncoveredIds = new Set([...quote.uncovered.map((u) => u.riskId), ...proxyIds]);
  const applyChoice = (q: Quote) => { setQuote(q); setLocal(true); };
  const totalLoss = coveredRisks.reduce((a, r) => a + r.lossUsd, 0);
  const items = coverItems(quote.lines, risksById, (l) => !!bought[`cover:${l.contractId}`], profile);
  const doneCount = items.filter((i) => i.done).length;
  const startCover = (line: QuoteLine) => setCheckout({ kind: "cover", line });

  return (
    <div className="container">
      <section className="page-head">
        <div>
          <span className="eyebrow">Step 3 · Your hedge plan</span>
          <h1 className={s.title}>{profile.name}</h1>
        </div>
        <p className={s.meta}>{profile.city}{profile.zip ? ` · ${profile.zip}` : ""} · {usd(profile.avgDailyRevenueUsd)}/day · busy {profile.busyDays.join(", ") || "—"}
          {" · "}<Link href={`/intake?preset=${encodeURIComponent(profile.id)}`}>Edit</Link></p>
      </section>

      <CoverSteps total={items.length} done={doneCount} />
      <HeadsUp profile={profile} quote={quote} onCover={startCover} />

      <section className={s.schedGrid}>
        <div className={s.left}>
          <div className={`card ${s.ai}`}>
            <div className="doc-head">
              <span className="caps-title">Underwriter&apos;s note</span>
              <span className="meta" title="Model that produced this plan">AI RISK ADVISOR · {quote.model}</span>
            </div>
            <p className={s.summary}>{quote.summary}</p>
            <ClarifyRecap answers={quote.clarifications ?? loadClarify(profile)?.answers} asked={!!loadClarify(profile)?.questions.length} onEdit={editAnswers} busy={loading} />
            <p className={`xs ${s.venues}`}>
              <span className="badge badge-gemini">Priced live: Gemini · Kalshi · Polymarket</span>
              <span className="badge badge-kalshi">Settled on Solana</span>
              <span className="muted">Each line uses the cheapest venue for that contract. <Link href="/how-it-works">How</Link></span>
            </p>
          </div>

          <QuoteTable quote={quote} />

          <div className="fine">
            <b>Basis risk.</b> Each line pays on the market&apos;s official result, not on your actual loss.
          </div>
        </div>

        <aside ref={bindRef} className={`bind ${s.bind}`} aria-label="Your quote">
          <div className="bind-inner">
            <div className={s.bindTop}>
              <span className="bind-k">Your quote · binding summary</span>
              <div className="seg" role="group" aria-label="Coverage level">
                {COVS.map((c) => <button key={c} aria-pressed={cov === c} onClick={() => changeCoverage(c)}>{c}%</button>)}
              </div>
            </div>
            <div className="bind-big pay"><span>Pays out if it happens</span><b>{usd(quote.totalPayoutUsd)}</b></div>
            <div className="bind-big"><span>Premium if it doesn&apos;t</span><b>{usd(quote.totalPremiumUsd, 2)}</b></div>
            <div className={s.budget}>
              <div className={s.budgetRow}>
                <span>Monthly budget used</span>
                <span className="num"><b>{usd(used, 0)}</b> of {usd(budget)}</span>
              </div>
              <div className={`bar ${used > budget + 0.01 ? "over" : ""}`}><i style={{ width: `${budgetPct}%` }} /></div>
            </div>
            <p className={s.bindSummary}>
              Covers {cov}% of ~{usd(totalLoss)} in estimated losses across {coveredRisks.length} risk{coveredRisks.length === 1 ? "" : "s"}.
              {local && <> Resized at current prices. <button className={s.linkBtn} onClick={() => runAdvise(profile, cov)} disabled={loading}>{loading ? "Re-running…" : "Re-run AI"}</button></>}
            </p>
            <CoverChecklist items={items} onCover={startCover} onCoverAll={() => setCoverAll(items.filter((i) => !i.done))} />
            <div className="signline"><span className="x">x</span><span className="l" /><span>Your wallet signs</span></div>
            <ul className="assure">
              <li><IconCheck size={14} />You see the exact cost before you sign.</li>
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
          <div><span className="eyebrow">Each risk in detail · buy here</span><h2>Your risks, <em>matched to markets</em></h2></div>
          <span className={`muted small ${s.quoted}`}>{loading ? <><span className="spinner" /> refreshing…</> : `Quoted ${new Date(quote.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</span>
        </div>
        <div className="stack">
          {coveredRisks.map((r, i) => (
            <RiskCard key={r.id} index={i + 1} total={coveredRisks.length} risk={r} lines={linesByRisk.get(r.id) ?? []} bought={bought} profile={profile}
              onBuy={(line) => setCheckout({ kind: "hedge", line })} onCover={(line) => setCheckout({ kind: "cover", line })} />
          ))}
        </div>
      </section>

      <CreativeHedges quote={quote} coverage={cov} onChange={applyChoice} />

      {(notCoverable.length > 0 || quote.risks.some((r) => !linesByRisk.has(r.id) && !uncoveredIds.has(r.id))) && (
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="sec-head">
            <div><span className="eyebrow">Exclusions</span><h2>Not coverable <em>(yet)</em></h2></div>
            <span className="muted small">We&apos;d rather tell you than sell you a hedge that doesn&apos;t fit.</span>
          </div>
          <div className="grid grid-2">
            {[...notCoverable, ...quote.risks.filter((r) => !linesByRisk.has(r.id) && !uncoveredIds.has(r.id))
              .map((r) => ({ riskId: r.id, reason: "No live market matches this risk closely enough." }))].map((u) => {
              const r = risksById.get(u.riskId);
              return (
                <div key={u.riskId} className={`card card-dashed ${s.excl}`}>
                  <span className={`stamp stamp-void ${s.exclStamp}`}>Excluded</span>
                  <div className="row between" style={{ alignItems: "baseline" }}><h3 style={{ margin: 0 }}>{r?.title ?? u.riskId}</h3>{r && <span className="num bad small">~{usd(r.lossUsd)} at risk</span>}</div>
                  {r?.trigger && <p className="small muted" style={{ margin: "4px 0 8px" }}>{r.trigger}</p>}
                  <p className="small" style={{ margin: 0 }}>{u.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <NextStepBar items={items} onCover={startCover} onCoverAll={() => setCoverAll(items.filter((i) => !i.done))} watch={bindRef} />
      <div className={s.barSpace} aria-hidden="true" />

      {coverAll && (
        <CoverAllDialog items={coverAll} businessId={profile.id} budgetUsd={budget} onClose={() => setCoverAll(null)}
          onDone={({ contractId, ...r }) => setBought((b) => ({ ...b, [`cover:${contractId}`]: r }))} />
      )}

      {checkout && (
        <CheckoutDialog kind={checkout.kind} line={checkout.line} risk={risksById.get(checkout.line.riskId)} businessId={profile.id}
          onClose={() => setCheckout(null)}
          onDone={(r) => setBought((b) => ({ ...b, [`${r.kind}:${checkout.line.contractId}`]: r }))} />
      )}
    </div>
  );
}
