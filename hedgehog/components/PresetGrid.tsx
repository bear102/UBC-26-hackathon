"use client";
import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { getPresets } from "@/lib/client/api";
import { FIXTURE_PRESETS, type Preset } from "@/lib/fixtures";
import { usd } from "@/lib/client/format";
import { saveProfile } from "@/lib/client/storage";
import { IconArrowRight, IconBlankForm, IconCloche, IconGlass, IconTruck, IconUmbrella } from "./Icons";
import s from "./PresetGrid.module.css";

type IconC = ComponentType<{ className?: string }>;
const ART: Record<string, { Icon: IconC; kind: string; worst: string }> = {
  "rainey-patio-bar": { Icon: IconGlass, kind: "Bar", worst: "Rainy Saturday + Spurs loss" },
  "east-austin-food-truck": { Icon: IconTruck, kind: "Food truck", worst: "Rain at the lunch rush" },
  "austin-catering-delivery": { Icon: IconCloche, kind: "Catering", worst: "Fuel spike on fixed-price jobs" },
};
const letter = (i: number) => String.fromCharCode(65 + (i % 26));

export function PresetGrid() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  useEffect(() => { getPresets().then(setPresets).catch(() => setPresets(FIXTURE_PRESETS)); }, []);
  return (
    <div className={s.grid} aria-busy={!presets}>
      {!presets && [0, 1, 2].map((i) => <div key={i} className={`form ${s.skeleton}`} aria-hidden="true" />)}
      {(presets ?? []).map((p, i) => {
        const art = ART[p.id] ?? { Icon: IconUmbrella, kind: "Business", worst: "" };
        return (
          <Link key={p.id} href={`/intake?preset=${encodeURIComponent(p.id)}`} className="form" onClick={() => saveProfile(p)}>
            <div className="fno"><span>Form {letter(i)} · {art.kind}</span><span>{p.zip ?? p.city}</span></div>
            <art.Icon className="ico" />
            <h3>{p.name}</h3>
            <p>{p.tagline}</p>
            {art.worst && <div className={s.worst}><span className={s.k}>Worst day</span>{art.worst}</div>}
            <dl className={s.meta}>
              <div><dt>Per day</dt><dd>{usd(p.avgDailyRevenueUsd)}</dd></div>
              <div><dt>Hedge budget</dt><dd>{usd(p.monthlyBudgetUsd)}</dd></div>
            </dl>
            <div className="go"><span>Get my quote</span><IconArrowRight size={15} /></div>
          </Link>
        );
      })}
      <Link href="/intake" className="form blank">
        <div className="fno"><span>Form · Blank</span><span>Any</span></div>
        <IconBlankForm className="ico" />
        <h3>Describe your business</h3>
        <p>One sentence: what you sell and what ruins a day.</p>
        <div className="lines" aria-hidden="true"><i /><i /></div>
        <div className="go"><span>Start from scratch</span><IconArrowRight size={15} /></div>
      </Link>
    </div>
  );
}
