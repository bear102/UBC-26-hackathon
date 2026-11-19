"use client";
// Live-odds ticker strip above the header (decoration + proof of liveness; aria-hidden, not a data source).
// Starts as security-paper microtext; swaps to real market odds once /api/markets/ticker answers. No demo flagging,
// no fixtures: if the feed is down or slow it simply stays microtext.
import { useEffect, useState } from "react";
import type { TickerItem } from "@/app/api/markets/ticker/route";
import { isMock } from "@/lib/client/mode";

type Item = TickerItem;
const MICRO = "Hedgehog worst-day cover · Priced on live prediction markets · Pays out on Solana ·";

export function OddsTicker() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    if (isMock()) return;
    const ctl = new AbortController();
    fetch("/api/markets/ticker", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((it: unknown) => { if (Array.isArray(it) && it.length >= 3) setItems(it as Item[]); })
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
