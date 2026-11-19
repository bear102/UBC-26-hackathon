"use client";
// Live-odds ticker strip above the header (decoration + proof of liveness; aria-hidden, not a data source).
// Starts as security-paper microtext; swaps to real market odds once /api/markets answers. No demo flagging,
// no fixtures: if the feed is down or slow it simply stays microtext.
import { useEffect, useState } from "react";
import type { MarketContract } from "@/lib/types";
import { isMock } from "@/lib/client/mode";

type Item = { k: string; t: string; l: string; p: number; v: string };
const MICRO = "Hedgehog worst-day cover · Priced on live prediction markets · Pays out on Solana ·";
const VENUE: Record<string, string> = { gemini: "Gemini", kalshi: "Kalshi", polymarket: "Polymarket" };

function pick(ms: MarketContract[]): Item[] {
  const open = ms.filter((m) => m.status === "open" && m.yesAsk != null && m.yesAsk > 0.02 && m.yesAsk < 0.98);
  const seen = new Map<string, number>();
  const out: Item[] = [];
  for (const m of open) {
    const n = seen.get(m.peril) ?? 0;
    if (n >= 2) continue; // spread across perils
    seen.set(m.peril, n + 1);
    const t = m.eventTitle.replace(/\?$/, "");
    out.push({ k: m.id, t: t.length > 46 ? t.slice(0, 44).trimEnd() + "…" : t, l: m.label.length > 26 ? m.label.slice(0, 24).trimEnd() + "…" : m.label, p: Math.round((m.yesAsk ?? 0) * 100), v: VENUE[m.venue] ?? m.venue });
    if (out.length >= 8) break;
  }
  return out;
}

export function OddsTicker() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    if (isMock()) return;
    const ctl = new AbortController();
    fetch("/api/markets", { signal: ctl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((ms: unknown) => { if (Array.isArray(ms)) { const it = pick(ms as MarketContract[]); if (it.length >= 3) setItems(it); } })
      .catch(() => { /* stay on microtext */ });
    return () => ctl.abort();
  }, []);

  const run = (copy: number) => items
    ? items.map((i) => (
      <span key={`${copy}-${i.k}`} className="tk">
        <b>{i.t}</b> · {i.l} · <span className="pct">{i.p}%</span> <span className="ven">{i.v}</span>
      </span>
    ))
    : Array.from({ length: 4 }, (_, n) => <span key={`${copy}-${n}`} className="tk">{MICRO}</span>);

  return (
    <div className={`ticker${items ? " live" : ""}`} aria-hidden="true">
      <div className="track">{run(0)}{run(1)}</div>
    </div>
  );
}
