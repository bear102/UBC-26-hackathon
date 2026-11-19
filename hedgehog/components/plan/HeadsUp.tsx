"use client";
// "Heads-up" banner: 1-3 short forecast lines for the owner's location, linked to the line that covers it.
// On the plan (quote + onCover given) and the dashboard (no props: last business from storage, links to its plan).
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ForecastSummary } from "@/lib/ai/forecast";
import type { BusinessProfile, Quote, QuoteLine } from "@/lib/types";
import { headsUpItems, weatherPlan } from "@/lib/client/headsUp";
import { isMock } from "@/lib/client/mode";
import { lastBusiness, loadProfile, loadQuote, lastQuotePct } from "@/lib/client/storage";
import s from "./HeadsUp.module.css";

const memo = new Map<string, ForecastSummary | null>();

export function HeadsUp({ profile: given, quote: givenQuote, onCover }: { profile?: BusinessProfile | null; quote?: Quote | null; onCover?: (line: QuoteLine) => void }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(given ?? null);
  const [quote, setQuote] = useState<Quote | null>(givenQuote ?? null);
  const [fc, setFc] = useState<ForecastSummary | null>(null);

  useEffect(() => { if (given) setProfile(given); }, [given]);
  useEffect(() => { if (givenQuote !== undefined) setQuote(givenQuote); }, [givenQuote]);
  // dashboard: the last business the owner quoted
  useEffect(() => {
    if (given) return;
    const id = lastBusiness();
    const p = id ? loadProfile(id) : null;
    if (!p) return;
    setProfile(p);
    const pct = lastQuotePct(p.id);
    if (givenQuote === undefined && pct) setQuote(loadQuote(p.id, pct));
  }, [given, givenQuote]);

  const key = profile ? `${profile.zip ?? ""}|${profile.city}|${profile.busyDays.join(",")}` : "";
  useEffect(() => {
    if (!profile || isMock()) return;
    if (memo.has(key)) { setFc(memo.get(key) ?? null); return; }
    let live = true;
    const qs = new URLSearchParams({ city: profile.city, busy: profile.busyDays.join(","), desc: profile.description.slice(0, 300) });
    if (profile.zip) qs.set("zip", profile.zip);
    fetch(`/api/forecast?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j: ForecastSummary | null) => { memo.set(key, j); if (live) setFc(j); });
    return () => { live = false; };
  }, [key, profile]);

  if (!profile || !fc) return null;
  // the plan: only when it has weather exposure (or NWS has an alert out)
  if (onCover && !weatherPlan(quote) && !fc.alerts.length) return null;
  const items = headsUpItems(fc, quote);
  if (!items.length) return null;

  return (
    <aside className={s.box} aria-label="Weather heads-up">
      <span className={s.k}>Heads-up · {fc.place.replace(/ \d{5}$/, "")} forecast</span>
      <ul className={s.list}>
        {items.map((it) => (
          <li key={it.key} className={s.item} data-tone={it.tone}>
            <span>{it.text}{it.cover ? <> <b>{it.cover}</b></> : null}</span>
            {it.line && (onCover
              ? <button type="button" className={s.go} onClick={() => onCover(it.line!)}>Get covered</button>
              : <Link className={s.go} href={`/plan?b=${encodeURIComponent(profile.id)}`}>Get covered</Link>)}
          </li>
        ))}
      </ul>
      <span className={s.src}>{fc.source}</span>
    </aside>
  );
}
