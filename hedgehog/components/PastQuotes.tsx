"use client";
// "Your past quotes": shown only when a wallet is connected (the user's notion of "logged in").
// Quotes live in this browser's storage (hh.quote.<businessId>.<pct>); we show the latest per business.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Quote } from "@/lib/types";
import { loadProfile, storedQuoteEntries } from "@/lib/client/storage";
import { isMock } from "@/lib/client/mode";
import { usd } from "@/lib/client/format";
import { IconArrowRight } from "./Icons";
import s from "./PastQuotes.module.css";

type Row = { id: string; name: string; pct: number; quote: Quote; at: number };

function latestPerBusiness(): Row[] {
  const demo = isMock();
  const best = new Map<string, Row>();
  for (const { quote, pct } of storedQuoteEntries()) {
    if (!demo && /fixture|demo/i.test(quote.model ?? "")) continue; // demo quotes only in demo mode
    const at = Date.parse(quote.createdAt) || 0;
    const prev = best.get(quote.businessId);
    if (!prev || at > prev.at) best.set(quote.businessId, { id: quote.businessId, name: loadProfile(quote.businessId)?.name ?? quote.businessId, pct, quote, at });
  }
  return [...best.values()].sort((a, b) => b.at - a.at).slice(0, 6);
}

const when = (t: number) => {
  if (!t) return "";
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

export function PastQuotes({ eyebrow = "Signed in", title = "Your past quotes" }: { eyebrow?: string; title?: string }) {
  const { connected } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (connected) setRows(latestPerBusiness()); }, [connected]);
  if (!connected || rows.length === 0) return null;
  return (
    <section className={s.wrap} aria-label={title}>
      <div className="sec-head">
        <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
        <span className="muted small">Saved in this browser</span>
      </div>
      <ul className={s.list}>
        {rows.map((r) => {
          const n = r.quote.lines.filter((l) => l.action !== "read-only" && l.contracts > 0).length;
          return (
            <li key={r.id}>
              <Link href={`/plan?b=${encodeURIComponent(r.id)}&c=${r.pct}`} className={s.row}>
                <span className={s.name}><b>{r.name}</b><small>{when(r.at)} · {r.pct}% coverage · {n} risk{n === 1 ? "" : "s"}</small></span>
                <span className={s.fig}><small>Pays</small><b className="num pay">{usd(r.quote.totalPayoutUsd)}</b></span>
                <span className={s.fig}><small>Costs</small><b className="num">{usd(r.quote.totalPremiumUsd, 2)}</b></span>
                <span className={s.open}>Open <IconArrowRight size={14} /></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
