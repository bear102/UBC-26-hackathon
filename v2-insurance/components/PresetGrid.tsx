"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getPresets } from "@/lib/client/api";
import { FIXTURE_PRESETS, type Preset } from "@/lib/fixtures";
import { usd } from "@/lib/client/format";
import { saveProfile } from "@/lib/client/storage";
import s from "./PresetGrid.module.css";

const ART: Record<string, { icon: string; tone: string; worst: string }> = {
  "rainey-patio-bar": { icon: "☂", tone: "var(--kalshi)", worst: "Rainy Saturday + Spurs loss" },
  "east-austin-food-truck": { icon: "🌮", tone: "var(--gold)", worst: "Rain at the lunch rush" },
  "austin-catering-delivery": { icon: "⛽", tone: "var(--gemini)", worst: "Fuel spike on fixed-price jobs" },
};

export function PresetGrid() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  useEffect(() => { getPresets().then(setPresets).catch(() => setPresets(FIXTURE_PRESETS)); }, []);
  return (
    <div className={s.grid} aria-busy={!presets}>
      {!presets && [0, 1, 2].map((i) => <div key={i} className={`${s.card} ${s.skeleton}`} aria-hidden="true" />)}
      {(presets ?? []).map((p) => {
        const art = ART[p.id] ?? { icon: "◆", tone: "var(--brand)", worst: "" };
        return (
          <Link key={p.id} href={`/intake?preset=${encodeURIComponent(p.id)}`} className={s.card} onClick={() => saveProfile(p)}>
            <div className={s.top}>
              <span className={s.icon} style={{ color: art.tone, background: `color-mix(in srgb, ${art.tone} 12%, transparent)` }} aria-hidden="true">{art.icon}</span>
              <span className="badge badge-neutral">{p.zip ?? p.city}</span>
            </div>
            <h3>{p.name}</h3>
            <p className="muted small">{p.tagline}</p>
            {art.worst && <p className={s.worst}><span className="eyebrow">Worst day</span><br />{art.worst}</p>}
            <div className={s.meta}>
              <span><b className="num">{usd(p.avgDailyRevenueUsd)}</b><span className="muted xs"> / day</span></span>
              <span><b className="num">{usd(p.monthlyBudgetUsd)}</b><span className="muted xs"> hedge budget</span></span>
            </div>
            <span className={s.cta}>Get my quote →</span>
          </Link>
        );
      })}
      <Link href="/intake" className={`${s.card} ${s.custom}`}>
        <div className={s.top}><span className={s.icon} aria-hidden="true">✎</span></div>
        <h3>Describe your business</h3>
        <p className="muted small">Tell us in one sentence what you sell and what ruins a day. The AI maps your risks to live markets.</p>
        <span className={s.cta}>Start from scratch →</span>
      </Link>
    </div>
  );
}
