import Link from "next/link";
import { CoverInfoPanel } from "@/components/CoverInfoPanel";
import { VenueLegend } from "@/components/markets/VenueBadge";
import s from "./page.module.css";

export const metadata = { title: "How it works — Hedgehog" };

function Box({ x, y, w, h, title, sub, tone = "var(--brand)" }: { x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill="var(--surface)" stroke={tone} strokeWidth="1.6" />
      <rect x={x} y={y} width="5" height={h} rx="2" fill={tone} />
      <text x={x + 16} y={y + (sub ? h / 2 - 3 : h / 2 + 5)} fill="var(--ink)" fontSize="14" fontWeight="650" fontFamily="var(--sans)">{title}</text>
      {sub && <text x={x + 16} y={y + h / 2 + 15} fill="var(--muted)" fontSize="11.5" fontFamily="var(--sans)">{sub}</text>}
    </g>
  );
}
function Arrow({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke="var(--line-2)" strokeWidth="1.8" markerEnd="url(#arr)" />
      {label && <text x={lx} y={ly} fill="var(--muted)" fontSize="11" fontFamily="var(--sans)" textAnchor="middle">{label}</text>}
    </g>
  );
}

export default function HowItWorks() {
  return (
    <div className="container">
      <section className="section narrow" style={{ paddingBottom: 16 }}>
        <span className="eyebrow">For judges & the curious</span>
        <h1 style={{ fontSize: "clamp(2rem,4.5vw,2.8rem)" }}>How Hedgehog works</h1>
        <p className="muted" style={{ fontSize: "1.1rem" }}>
          Small businesses lose money on predictable bad days: rain, cold fronts, game-night losses, fuel spikes. Prediction markets already price those events.
          Hedgehog turns them into cover a shop owner understands: <b style={{ color: "var(--ink)" }}>what it pays if it happens, what it costs if it doesn&apos;t</b>.
        </p>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <div className={s.diagram}>
          <svg viewBox="0 0 980 430" role="img" aria-labelledby="arch-t">
            <title id="arch-t">Hedgehog architecture: business intake to AI advisor; cover priced on Gemini and Kalshi, sold as Solana devnet tokens and policies, backed by the desk on Gemini; QuickNode Streams feed.</title>
            <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--line-2)" /></marker></defs>
            <text x="20" y="28" fill="var(--muted)" fontSize="11" letterSpacing="2" fontFamily="var(--sans)">OFFCHAIN · NEXT.JS APP</text>
            <text x="20" y="300" fill="var(--muted)" fontSize="11" letterSpacing="2" fontFamily="var(--sans)">ONCHAIN · SOLANA DEVNET</text>
            <line x1="20" y1="282" x2="960" y2="282" stroke="var(--line)" strokeDasharray="5 5" />

            <Box x={20} y={50} w={180} h={62} title="Business owner" sub="preset or one sentence" tone="var(--ink-2)" />
            <Box x={260} y={50} w={210} h={62} title="AI risk advisor" sub="risk map → market match" />
            <Box x={530} y={40} w={200} h={52} title="Gemini Prediction Markets" sub="prices cover · desk backs it here" tone="var(--gemini)" />
            <Box x={530} y={108} w={200} h={52} title="Kalshi (DFlow) · Polymarket" sub="gaps Gemini can't fill · cross-check" tone="var(--kalshi)" />
            <Box x={260} y={170} w={210} h={62} title="Quote engine" sub="size · walk book · fit budget" tone="var(--gold)" />
            <Box x={790} y={70} w={170} h={62} title="Phantom wallet" sub="owner signs every buy" tone="var(--ink-2)" />
            <Box x={530} y={196} w={200} h={52} title="Settlement crank" sub="reads official results" tone="var(--gold)" />

            <Box x={20} y={320} w={250} h={70} title="Outcome-token desk (devnet)" sub="YES/NO SPL mints at the live ask · $1" tone="var(--kalshi)" />
            <Box x={320} y={320} w={260} h={70} title="hedgehog_policy (Anchor)" sub="USDC vault · budget · parametric payout" />
            <Box x={630} y={320} w={330} h={70} title="QuickNode Streams → /api webhook" sub="fills, transfers, payouts → live dashboard" tone="var(--info)" />

            <Arrow d="M200 81 L258 81" />
            <Arrow d="M470 72 L528 66" label="prices" lx={500} ly={60} />
            <Arrow d="M255 318 C 505 300, 505 130, 528 88" label="backing" lx={466} ly={268} />
            <Arrow d="M470 92 L528 128" />
            <Arrow d="M365 112 L365 168" label="picks (IDs only)" lx={420} ly={145} />
            <Arrow d="M470 201 C 650 270, 760 200, 820 134" label="quote → buy tx" lx={690} ly={268} />
            <Arrow d="M840 132 L 150 318" />
            <Arrow d="M875 132 L 470 318" />
            <Arrow d="M630 248 L 470 318" label="settle" lx={575} ly={300} />
            <Arrow d="M270 355 L 318 355" />
            <Arrow d="M580 355 L 628 355" />
          </svg>
        </div>
      </section>

      <section className="section">
        <div className="grid grid-3">
          <div className="card">
            <span className="badge badge-gemini">Gemini Prediction Markets</span>
            <h3 style={{ marginTop: 10 }}>Priced &amp; hedged on Gemini</h3>
            <p className="small">Gemini is the primary venue. Its live books (Austin daily highs, NBA/NFL games, WTI and Brent) price the cover: every line shows ask, depth and odds, sized by walking the book. When a business buys, Hedgehog&apos;s desk <b>backs the exposure with the same contract on Gemini</b> through the Trader API, like an insurer reinsuring. Kalshi (tokenized on Solana by DFlow) fills perils Gemini doesn&apos;t list: rain, snow, Texas power, lake levels, diesel, CPI. Polymarket is a read-only price check.</p>
          </div>
          <div className="card">
            <span className="badge badge-kalshi">Solana</span>
            <h3 style={{ marginTop: 10 }}>Settled on Solana</h3>
            <p className="small">Each hedge is an SPL outcome token (the DFlow model) minted at the venue&apos;s live ask. The desk co-signs, the owner signs in Phantom, and winning tokens pay $1 of USDC automatically. <b>Hedgehog Cover</b> is our Anchor program: premiums go into a USDC vault PDA, a monthly budget mandate is enforced onchain, and payouts are parametric.</p>
          </div>
          <div className="card">
            <span className="badge badge-neutral">QuickNode Streams</span>
            <h3 style={{ marginTop: 10 }}>The live coverage feed</h3>
            <p className="small">A QuickNode Stream filtered to the owner&apos;s outcome-token mints and the policy program pushes fills, transfers, resolutions and payouts to our webhook. The dashboard turns them into plain words: “Hedge filled”, “Market resolved YES”, “Paid $480”.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className={s.two}>
          <div>
            <h2>One market layer, three venues</h2>
            <p className="small" style={{ color: "var(--ink-2)" }}>You never have to pick a venue. <b>Gemini first · Kalshi on Solana where Gemini lists nothing · Polymarket reference.</b> Every hedge carries the same three badges, and each one means one thing:</p>
            <div className="card-soft"><VenueLegend /></div>
            <h3 style={{ marginTop: 16 }}>What&apos;s on the menu</h3>
            <ul className={s.list}>
              <li><b>Gemini:</b> daily highs in 60+ cities, games, crude, natural gas, metals, crypto, Fed decisions.</li>
              <li><b>Kalshi via DFlow on Solana:</b> rain (daily and monthly totals in 30+ cities), daily highs and lows, December snowfall by city, ski-resort snowfall, season snow days, ERCOT power prices, Lake Mead, heating degree days, weekly diesel and gas, CPI, tornado counts.</li>
              <li><b>Polymarket (reference only, it isn&apos;t available to US desks):</b> Mississippi River low water, Lake Powell, Great Salt Lake, LA earthquake, US tornado totals.</li>
              <li><b>Not hedgeable on any venue today:</b> wildfire, flood, hail and air quality. We say so instead of forcing a bad proxy. Hurricanes are out of season (the Atlantic season ends Nov 30).</li>
            </ul>
          </div>
          <div>
            <h2>How we choose, and show it</h2>
            <ul className={s.list}>
              <li><b>Same event, side by side.</b> Each hedge has a one-line check, e.g. <span className="mono small">Gemini 11% · Kalshi 12% · Polymarket 11% — markets agree</span>. Open it to see chance, cost per $1, how much is for sale and when it closes on each venue, with <b>Best price</b> and <b>What we use</b> marked.</li>
              <li><b>Gemini first.</b> Gemini prices the cover and the desk backs it there. Code (not the AI) moves a pick from Kalshi to the identical Gemini contract when it costs no more than 1¢ extra. Kalshi stays when Gemini doesn&apos;t list the event, has no sellers, or is clearly dearer.</li>
              <li><b>Disagreement is flagged.</b> If another venue is 4+ points away (“Polymarket is 8 pts higher”), the plan says so. Similar-but-not-identical questions are marked ≈ and never count as agreement.</li>
              <li><b>Same story on the dashboard.</b> Each position shows where its price came from and where it&apos;s backed (Gemini desk order, dry-run for now).</li>
            </ul>
            <Link href="/markets?cross=1" className="btn" style={{ marginTop: 4 }}>Browse every live market →</Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className={s.two}>
          <div>
            <h2>Trust assumptions, stated plainly</h2>
            <ul className={s.list}>
              <li><b>The AI can&apos;t invent markets.</b> It picks from candidate contract IDs that our code pulled from live venue APIs; sizing and budget allocation are deterministic code.</li>
              <li><b>Basis risk is real.</b> Rain at the airport ≠ rain on your patio; a loss ≠ an empty bar. Every line shows its mismatch note.</li>
              <li><b>Desk solvency.</b> Gemini-priced tokens are a promise from Hedgehog&apos;s desk, backed by an offsetting Gemini position and a USDC vault whose balance anyone can check onchain (below). Backing orders are <b>dry-run</b> until the desk&apos;s Gemini account is funded; each one is shown on the dashboard.</li>
              <li><b>Settlement attestor.</b> Cover policies are settled by a single attestor key (our crank) from the venue&apos;s official result. If it never settles, the owner can reclaim the premium after expiry. Future: oracle or multisig.</li>
              <li><b>Devnet only.</b> Hedges and Cover run on Solana devnet with test USDC. The outcome-token desk mirrors real Gemini/Kalshi prices but is our own venue; the DFlow mainnet path (Kalshi) is the same interface.</li>
              <li><b>Not an insurer.</b> Hedgehog is an advisor plus self-directed hedges; the Cover program is a prototype of the long-term product.</li>
            </ul>
            <Link href="/" className="btn btn-primary" style={{ marginTop: 8 }}>Try it with a preset →</Link>
          </div>
          <div>
            <h2>Addresses</h2>
            <CoverInfoPanel />
          </div>
        </div>
      </section>
    </div>
  );
}
