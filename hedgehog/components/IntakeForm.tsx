"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { BusinessProfile } from "@/lib/types";
import { getPresets } from "@/lib/client/api";
import { loadProfile, saveProfile, setLastBusiness } from "@/lib/client/storage";
import { FIXTURE_PRESETS } from "@/lib/fixtures";
import { Seal } from "./Engraving";
import { IconArrowRight } from "./Icons";
import s from "./IntakeForm.module.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "business";

export function IntakeForm() {
  const router = useRouter();
  const params = useSearchParams();
  const presetId = params.get("preset") ?? undefined;
  const [base, setBase] = useState<BusinessProfile | null>(null);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [revenue, setRevenue] = useState("1500");
  const [busy, setBusy] = useState<string[]>(["Fri", "Sat"]);
  const [zip, setZip] = useState("78701");
  const [budget, setBudget] = useState("200");
  const [coverage, setCoverage] = useState<25 | 50 | 100>(50);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!presetId) return;
    const apply = (p: BusinessProfile) => {
      setBase(p); setDescription(p.description); setName(p.name); setRevenue(String(p.avgDailyRevenueUsd));
      setBusy(p.busyDays); setZip(p.zip ?? ""); setBudget(String(p.monthlyBudgetUsd));
    };
    const cached = loadProfile(presetId);
    if (cached) apply(cached);
    else {
      const fx = FIXTURE_PRESETS.find((p) => p.id === presetId);
      if (fx) apply(fx);
      getPresets().then((ps) => { const p = ps.find((x) => x.id === presetId); if (p) apply(p); }).catch(() => {});
    }
  }, [presetId]);

  function toggle(d: string) { setBusy((b) => (b.includes(d) ? b.filter((x) => x !== d) : [...b, d])); }

  function submit(e: FormEvent) {
    e.preventDefault();
    const rev = Number(revenue), bud = Number(budget);
    if (description.trim().length < 12) return setErr("Tell us a bit more (one sentence is enough).");
    if (!name.trim()) return setErr("Add a business name.");
    if (!(rev > 0)) return setErr("Average daily revenue must be a positive number.");
    if (!(bud > 0)) return setErr("Monthly hedge budget must be a positive number.");
    setErr(null);
    const id = base?.id ?? `${slug(name)}-${Math.random().toString(36).slice(2, 7)}`;
    const profile: BusinessProfile = {
      id, name: name.trim(), description: description.trim(), city: base?.city ?? "Austin, TX", zip: zip.trim() || undefined,
      avgDailyRevenueUsd: rev, busyDays: DAYS.filter((d) => busy.includes(d)), monthlyBudgetUsd: bud, presetId: base?.presetId ?? base?.id,
    };
    saveProfile(profile); setLastBusiness(id);
    router.push(`/plan?b=${encodeURIComponent(id)}&c=${coverage}`);
  }

  return (
    <form onSubmit={submit} className={s.form} noValidate>
      <div className={`page-head ${s.head}`}>
        <div>
          <span className="eyebrow">Step 2 · Intake</span>
          <h1 className={s.h1}>{base ? <>Let&apos;s check {base.name}&apos;s <em>details</em></> : <>Tell us about <em>your business</em></>}</h1>
        </div>
        <span className={s.headMeta}>About 30 seconds · no account needed</span>
      </div>

      <div className={`card ${s.doc}`}>
        <div className="doc-head">
          <span className="caps-title">Proposal for cover</span>
          <span className="serial">Form P-1</span>
        </div>

        <div className={s.q}>
          <Seal withText={false} className={s.seal} />
          <p><span className={s.qn}>Q1</span>What do you sell, where, and what kind of day hurts your sales?</p>
        </div>
        <label className={s.you}>
          <span className="sr-only">Describe your business</span>
          <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. We run a taco truck in East Austin. No indoor seating, so rainy lunches kill us, and cold weekends are slow." />
        </label>

        <div className={s.part}><span className={s.qn}>Q2</span>The particulars</div>
        <div className="grid grid-2">
          <label className="field"><span>Business name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cielo Taco Truck" autoComplete="organization" />
          </label>
          <label className="field"><span>ZIP code</span>
            <input className="input num" value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" maxLength={5} placeholder="78702" autoComplete="postal-code" />
          </label>
          <label className="field"><span>Average daily revenue</span>
            <div className="input-prefix"><b>$</b><input className="input num" value={revenue} onChange={(e) => setRevenue(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></div>
          </label>
          <label className="field"><span>Monthly hedge budget</span>
            <div className="input-prefix"><b>$</b><input className="input num" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></div>
          </label>
        </div>
        <fieldset className={s.fieldset}>
          <legend>Busiest days</legend>
          <div className="chips">
            {DAYS.map((d) => <button type="button" key={d} className="chip" aria-pressed={busy.includes(d)} onClick={() => toggle(d)}>{d}</button>)}
          </div>
        </fieldset>
        <fieldset className={s.fieldset}>
          <legend>How much of a bad day should the hedge cover?</legend>
          <div className="seg" role="group" aria-label="Coverage">
            {([25, 50, 100] as const).map((c) => <button type="button" key={c} aria-pressed={coverage === c} onClick={() => setCoverage(c)}>{c}%</button>)}
          </div>
          <p className="muted xs" style={{ marginTop: 8, marginBottom: 0 }}>You can change this later. It always stays within your budget.</p>
        </fieldset>

        {err && <div className="alert alert-bad" role="alert" style={{ marginTop: 18 }}>{err}</div>}
        <div className={s.submit}>
          <span className="muted small">Built only from live markets.</span>
          <button className="btn btn-primary btn-lg" type="submit">Build my hedge plan <IconArrowRight size={16} /></button>
        </div>
      </div>
    </form>
  );
}
