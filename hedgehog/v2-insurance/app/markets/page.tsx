// /markets — the live market universe the AI searches, grouped by risk type and place, venues merged per event.
import Link from "next/link";
import { Suspense } from "react";
import { getExplorerData } from "@/lib/markets/explorer";
import { MarketExplorer, type ExplorerInitial } from "@/components/markets/MarketExplorer";
import { VenueLegend } from "@/components/markets/VenueBadge";
import { IconArrowRight } from "@/components/Icons";
import s from "@/components/markets/markets.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Markets · Hedgehog", description: "Live prediction markets across Gemini, Kalshi and Polymarket, grouped by business risk." };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Explorer({ initial }: { initial: ExplorerInitial }) {
  try {
    const data = await getExplorerData();
    return <MarketExplorer data={data} initial={initial} />;
  } catch (e) {
    return <div className="alert alert-bad" role="alert"><b>Couldn&apos;t reach the market venues right now</b> ({e instanceof Error ? e.message : String(e)}). Try again in a minute.</div>;
  }
}

export default async function MarketsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const initial: ExplorerInitial = { risk: one(sp.risk), city: one(sp.city), venue: one(sp.venue), q: one(sp.q), cross: one(sp.cross) };
  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <header className="page-head">
        <div>
          <span className="eyebrow">Market explorer</span>
          <h1>Every market <em>our AI can use</em></h1>
        </div>
        <span className={s.headMeta}>Register of live contracts<br />Gemini · Kalshi · Polymarket</span>
      </header>

      <div className={s.intro}>
        <p className="lede" style={{ margin: 0 }}>
          Three venues, one list. When the same event trades in more than one place we put the prices side by side, so you can see
          whether the markets agree before you pay for cover.
        </p>
        <Link href="/" className="btn btn-primary">Get a plan for your business <IconArrowRight size={16} /></Link>
      </div>

      <section className={`card ${s.legend}`} aria-label="Venues">
        <div className="doc-head">
          <span className="caps-title">Venues of record</span>
          <span className="meta">3 venues · roles</span>
        </div>
        <VenueLegend />
      </section>

      <Suspense fallback={<div className="empty" style={{ marginTop: 20 }}><span className="spinner" /> Loading live markets from Gemini, Kalshi and Polymarket…</div>}>
        <Explorer initial={initial} />
      </Suspense>
    </div>
  );
}
