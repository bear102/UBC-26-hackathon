"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BusinessProfile, Quote, QuoteLine, Risk } from "@/lib/types";
import { advise, getPresets } from "@/lib/client/api";
import { rescaleQuote, type Coverage } from "@/lib/client/quote";
import { lastBusiness, lastQuotePct, loadProfile, loadQuote, saveProfile, saveQuote, setLastBusiness } from "@/lib/client/storage";
import { FIXTURE_PRESETS } from "@/lib/fixtures";
import { usd } from "@/lib/client/format";
import { AdviseProgress } from "./AdviseProgress";
import { RiskCard } from "./RiskCard";
import { PlanExplainer } from "./explain/PlanExplainer";
import { PlanChoices } from "./plan/PlanChoices";
import { CreativeHedges } from "./plan/CreativeHedges";
import { QuoteTable } from "./QuoteTable";
import { CheckoutDialog, type CheckoutKind, type CheckoutResult } from "./CheckoutDialog";
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
  const reqId = useRef(0);

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

  const runAdvise = useCallback(async (p: BusinessProfile, c: Coverage) => {
    const my = ++reqId.current;
    setLoading(true); setError(null);
    try {
      const q = await advise(p, c);
      if (my !== reqId.current) return;
      saveQuote(q, c); setQuote(q); setLocal(false);
    } catch (e) {
      if (my === reqId.current) setError(e instanceof Error ? e.message : String(e));
    } finally { if (my === reqId.current) setLoading(false); }
  }, []);

  // First quote: cached for this coverage, or rescale another cached one, or call the AI.
  useEffect(() => {
    if (!profile || quote) return;
    setLastBusiness(profile.id);
    const cached = loadQuote(profile.id, cov);
    if (cached) { setQuote(cached); return; }
    const lp = lastQuotePct(profile.id);
    const other = lp ? loadQuote(profile.id, lp) : null;
    if (other) { setQuote(rescaleQuote(other, cov)); setLocal(true); return; }
    runAdvise(profile, cov);
  }, [profile, quote, cov, runAdvise]);

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
    <section className="container narrow section">
      <div className="card"><h2>No business selected</h2><p className="muted">Pick a preset or describe your business to get a hedge plan.</p><Link className="btn btn-primary" href="/">Start</Link></div>
    </section>
  );
  if (!profile || (loading && !quote)) return <section className="container section"><AdviseProgress name={profile?.name} /></section>;
  if (error && !quote) return (
    <section className="container narrow section">
      <div className="card stack">
        <h2>We couldn&apos;t build the plan</h2>
        <div className="alert alert-bad" role="alert">{error}</div>
        <div className="row"><button className="btn btn-primary" onClick={() => runAdvise(profile, cov)}>Try again</button><Link href={`/intake?preset=${profile.id}`} className="btn">Edit details</Link></div>
      </div>
    </section>
  );
  if (!quote) return <section className="container section"><AdviseProgress name={profile.name} /></section>;

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

  return (
    <div className="container">
      <section className={s.head}>
        <div>
          <span className="eyebrow">Step 3 · Your hedge plan</span>
          <h1 className={s.title}>{profile.name}</h1>
          <p className="muted" style={{ margin: 0 }}>{profile.city}{profile.zip ? ` · ${profile.zip}` : ""} · {usd(profile.avgDailyRevenueUsd)}/day · busy {profile.busyDays.join(", ") || "—"}
            {" · "}<Link href={`/intake?preset=${encodeURIComponent(profile.id)}`}>Edit</Link></p>
        </div>
      </section>

      <section className={s.summaryGrid}>
        <div className={`card ${s.ai}`}>
          <div className="row between" style={{ marginBottom: 6 }}>
            <span className="eyebrow">AI risk advisor</span>
            <span className="badge badge-neutral" title="Model that produced this plan">{quote.model}</span>
          </div>
          <p className={s.summary}>{quote.summary}</p>
          <p className="xs muted" style={{ margin: 0 }}>Every contract below is a real listing picked from live order books. Prices move; we re-quote at checkout.</p>
          <p className="xs" style={{ margin: "8px 0 0", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge badge-gemini">Priced &amp; hedged on Gemini</span>
            <span className="badge badge-kalshi">Settled on Solana</span>
            <span className="muted">You buy Solana tokens or a Cover policy; Hedgehog backs Gemini-priced cover with the same contract on Gemini. <Link href="/how-it-works">How</Link></span>
          </p>
        </div>
        <div className={`card ${s.totals}`}>
          <div className="row between">
            <span className="eyebrow">Your quote</span>
            <div className="seg" role="group" aria-label="Coverage level">
              {COVS.map((c) => <button key={c} aria-pressed={cov === c} onClick={() => changeCoverage(c)}>{c}%</button>)}
            </div>
          </div>
          <div className={s.bigRow}>
            <div><span className="xs muted">Pays out if it happens</span><b className="num pay">{usd(quote.totalPayoutUsd)}</b></div>
            <div><span className="xs muted">Premium if it doesn&apos;t</span><b className="num cost">{usd(quote.totalPremiumUsd, 2)}</b></div>
          </div>
          <div>
            <div className="row between xs" style={{ marginBottom: 6 }}>
              <span className="muted">Monthly budget used</span>
              <span className="num"><b>{usd(used, 0)}</b> of {usd(budget)}</span>
            </div>
            <div className={`bar ${used > budget + 0.01 ? "over" : ""}`}><i style={{ width: `${budgetPct}%` }} /></div>
          </div>
          <p className="xs muted" style={{ margin: "10px 0 0" }}>
            Covers {cov}% of ~{usd(totalLoss)} in estimated losses across {coveredRisks.length} risk{coveredRisks.length === 1 ? "" : "s"}.
            {local && <> Resized locally at current prices. <button className={s.linkBtn} onClick={() => runAdvise(profile, cov)} disabled={loading}>{loading ? "Re-running…" : "Re-run AI"}</button></>}
          </p>
        </div>
      </section>

      <PlanExplainer quote={quote} profile={profile} />

      <PlanChoices quote={quote} coverage={cov} onChange={applyChoice} />

      <section className="section" style={{ paddingTop: 8 }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>Your risks, matched to markets</h2>
          <span className="muted small">{loading ? <><span className="spinner" /> refreshing…</> : `Quoted ${new Date(quote.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</span>
        </div>
        <div className="stack">
          {coveredRisks.map((r) => (
            <RiskCard key={r.id} risk={r} lines={linesByRisk.get(r.id) ?? []} bought={bought} profile={profile}
              onBuy={(line) => setCheckout({ kind: "hedge", line })} onCover={(line) => setCheckout({ kind: "cover", line })} />
          ))}
        </div>
      </section>

      <CreativeHedges quote={quote} coverage={cov} onChange={applyChoice} />

      <section className="section" style={{ paddingTop: 0 }}>
        <h2>Quote</h2>
        <QuoteTable quote={quote} />
      </section>

      {(notCoverable.length > 0 || quote.risks.some((r) => !linesByRisk.has(r.id) && !uncoveredIds.has(r.id))) && (
        <section className="section" style={{ paddingTop: 0 }}>
          <h2>Not coverable (yet)</h2>
          <p className="muted small">We&apos;d rather tell you than sell you a hedge that doesn&apos;t fit.</p>
          <div className="grid grid-2">
            {[...notCoverable, ...quote.risks.filter((r) => !linesByRisk.has(r.id) && !uncoveredIds.has(r.id))
              .map((r) => ({ riskId: r.id, reason: "No live market matched this risk closely enough to hedge it." }))].map((u) => {
              const r = risksById.get(u.riskId);
              return (
                <div key={u.riskId} className="card flat">
                  <div className="row between"><h3 style={{ margin: 0 }}>{r?.title ?? u.riskId}</h3>{r && <span className="num bad small">~{usd(r.lossUsd)} at risk</span>}</div>
                  {r?.trigger && <p className="small muted" style={{ margin: "4px 0 8px" }}>{r.trigger}</p>}
                  <p className="small" style={{ margin: 0 }}>{u.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {checkout && (
        <CheckoutDialog kind={checkout.kind} line={checkout.line} risk={risksById.get(checkout.line.riskId)} businessId={profile.id}
          onClose={() => setCheckout(null)}
          onDone={(r) => setBought((b) => ({ ...b, [`${r.kind}:${checkout.line.contractId}`]: r }))} />
      )}
    </div>
  );
}
