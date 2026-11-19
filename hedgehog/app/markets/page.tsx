// /markets — the live market universe the AI searches, grouped by risk type and place, venues merged per event.
import Link from "next/link";
import { Suspense } from "react";
import { getExplorerData } from "@/lib/markets/explorer";
import { MarketExplorer, type ExplorerInitial } from "@/components/markets/MarketExplorer";
import { VenueLegend } from "@/components/markets/VenueBadge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Markets · Hedgehog", description: "Live prediction markets across Gemini, Kalshi and Polymarket, grouped by business risk." };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Explorer({ initial }: { initial: ExplorerInitial }) {
  try {
    const data = await getExplorerData();
    return <MarketExplorer data={data} initial={initial} />;
  } catch (e) {
    return <div className="alert alert-bad" role="alert">Couldn&apos;t reach the market venues right now ({e instanceof Error ? e.message : String(e)}). Try again in a minute.</div>;
  }
}

export default async function MarketsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const initial: ExplorerInitial = { risk: one(sp.risk), city: one(sp.city), venue: one(sp.venue), q: one(sp.q), cross: one(sp.cross) };
  return (
    <div className="container section" style={{ paddingTop: 28 }}>
      <span className="eyebrow">Market explorer</span>
      <h1 style={{ fontSize: "clamp(1.9rem,4vw,2.6rem)", margin: "4px 0 6px" }}>Every market our AI can use</h1>
      <p className="muted" style={{ maxWidth: 760, margin: "0 0 14px" }}>
        Three venues, one list. When the same event trades in more than one place we put the prices side by side, so you can see
        whether the markets agree before you pay for cover. <Link href="/">Get a plan for your business →</Link>
      </p>
      <div className="card-soft" style={{ marginBottom: 6 }}><VenueLegend /></div>
      <Suspense fallback={<div className="card muted" style={{ marginTop: 16 }}><span className="spinner" /> Loading live markets from Gemini, Kalshi and Polymarket…</div>}>
        <Explorer initial={initial} />
      </Suspense>
    </div>
  );
}
