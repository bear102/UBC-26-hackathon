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
          <svg viewBox="0 0 980 450" role="img" aria-labelledby="arch-t">
            <title id="arch-t">Hedgehog architecture: the owner describes the business; the AI advisor maps risks and picks live markets on Kalshi, Gemini and Polymarket; the quote engine sizes cover; the owner signs in their wallet, buying outcome tokens from the desk or a Hedgehog Cover policy on Solana devnet; Hedgehog's desk backs each sale on Gemini and the crank settles from official results; QuickNode Streams pushes onchain events to the live dashboard.</title>
            <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--line-2)" /></marker></defs>
            <text x="20" y="24" fill="var(--muted)" fontSize="11" letterSpacing="2" fontFamily="var(--sans)">OFFCHAIN · NEXT.JS APP + MARKETS</text>
            <line x1="20" y1="286" x2="960" y2="286" stroke="var(--line)" strokeDasharray="5 5" />
            <text x="20" y="278" fill="var(--muted)" fontSize="11" letterSpacing="2" fontFamily="var(--sans)">ONCHAIN · SOLANA DEVNET ↓</text>

            {/* row 1: intake → AI → markets */}
            <Box x={20} y={60} w={170} h={60} title="Business owner" sub="preset or one sentence" tone="var(--ink-2)" />
            <Box x={240} y={60} w={200} h={60} title="AI risk advisor" sub="risks → live market picks" />
            <Box x={500} y={40} w={220} h={50} title="Kalshi · Polymarket" sub="gaps Gemini can't fill · cross-check" tone="var(--kalshi)" />
            <Box x={500} y={106} w={220} h={50} title="Gemini Prediction Markets" sub="primary prices · desk backs here" tone="var(--gemini)" />
            {/* row 2: quote, desk/crank, dashboard */}
            <Box x={240} y={190} w={200} h={60} title="Quote engine" sub="size · walk book · fit budget" tone="var(--gold)" />
            <Box x={500} y={190} w={220} h={60} title="Hedgehog desk + crank" sub="backs sales · settles from results" tone="var(--gold)" />
            <Box x={780} y={190} w={180} h={60} title="Live dashboard" sub="positions, payouts, feed" tone="var(--ink-2)" />
            {/* row 3: onchain */}
            <Box x={20} y={330} w={180} h={64} title="Owner's wallet" sub="Phantom / MetaMask signs" tone="var(--ink-2)" />
            <Box x={240} y={330} w={220} h={64} title="Outcome tokens" sub="YES/NO SPL mints · $1 if it happens" tone="var(--kalshi)" />
            <Box x={500} y={330} w={220} h={64} title="hedgehog_policy (Anchor)" sub="USDC vault · budget · payout" />
            <Box x={780} y={330} w={180} h={64} title="QuickNode Streams" sub="filters our txs → webhook" tone="var(--info)" />

            <Arrow d="M190 90 H238" />
            <Arrow d="M440 80 L498 66" label="prices" lx={469} ly={60} />
            <Arrow d="M440 100 L498 128" />
            <Arrow d="M340 120 V188" label="picks (IDs only)" lx={392} ly={160} />
            <Arrow d="M580 188 V158" label="backing" lx={548} ly={177} />
            <Arrow d="M640 158 V188" label="results" lx={676} ly={177} />
            <Arrow d="M290 250 V300 H110 V328" label="quote → buy tx" lx={200} ly={314} />
            <Arrow d="M200 362 H238" />
            <Arrow d="M110 394 V424 H560 V396" label="signs policy" lx={335} ly={440} />
            <Arrow d="M640 250 V328" label="settle" lx={668} ly={300} />
            <Arrow d="M540 250 V300 H400 V328" label="payouts" lx={470} ly={318} />
            <Arrow d="M720 362 H778" />
            <Arrow d="M870 328 V252" label="webhook" lx={906} ly={300} />
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
