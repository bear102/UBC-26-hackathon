import Link from "next/link";
import { CoverInfoPanel } from "@/components/CoverInfoPanel";
import { VenueLegend } from "@/components/markets/VenueBadge";
import { Rosette } from "@/components/Engraving";
import { IconArrowRight } from "@/components/Icons";
import { DayBars } from "@/components/explain/Visuals";
import s from "./page.module.css";

export const metadata = { title: "How it works — Hedgehog" };

/** Diagram box: a square-cut ink document with a red serial number, a sans title and a mono sub-line. */
function Box({ x, y, w, h, n, title, sub, tone }: { x: number; y: number; w: number; h: number; n: string; title: string; sub?: string; tone?: string }) {
  return (
    <g>
      <rect x={x + 4} y={y + 4} width={w} height={h} fill="var(--bg-2)" />
      <rect x={x} y={y} width={w} height={h} fill="var(--surface)" stroke="var(--ink)" strokeWidth="1" />
      <text x={x + 10} y={y + 3.5} className={s.dN}>{n}</text>
      {tone && <rect x={x + 14} y={y + (sub ? h / 2 - 12 : h / 2 - 4)} width="7" height="7" fill={tone} />}
      <text x={x + (tone ? 28 : 14)} y={y + (sub ? h / 2 - 3 : h / 2 + 5)} className={s.dTitle}>{title}</text>
      {sub && <text x={x + 14} y={y + h / 2 + 15} className={s.dSub}>{sub}</text>}
    </g>
  );
}
function Arrow({ d, label, lx, ly }: { d: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.1" markerEnd="url(#arr)" />
      {label && <text x={lx} y={ly} className={s.dLabel} textAnchor="middle">{label}</text>}
    </g>
  );
}

export default function HowItWorks() {
  return (
    <>
      <div className={s.headWrap}>
        <Rosette className={s.headRosette} density={10} steps={240} />
        <div className="container">
          <div className={`page-head ${s.head}`}>
            <div>
              <span className="eyebrow">For judges &amp; the curious</span>
              <h1>How Hedgehog <em>works</em></h1>
              <p className={`lede ${s.lede}`}>
                Small businesses lose money on predictable bad days: rain, cold fronts, game-night losses, fuel spikes. Prediction markets already price those events.
                Hedgehog turns them into cover a shop owner understands: <b>what it pays if it happens, what it costs if it doesn&apos;t</b>.
              </p>
            </div>
            <dl className={s.headMeta}>
              <div><dt>Priced on</dt><dd>Gemini · Kalshi · Polymarket</dd></div>
              <div><dt>Settled on</dt><dd>Solana devnet</dd></div>
              <div><dt>Live feed</dt><dd>QuickNode Streams</dd></div>
            </dl>
          </div>
        </div>
      </div>

      <div className="container">
        {/* Exhibit A: architecture */}
        <section className={`card ${s.exhibit}`} aria-labelledby="ex-a">
          <div className="doc-head">
            <span className="caps-title" id="ex-a">Exhibit A · Architecture</span>
            <span className="meta">OFFCHAIN APP + MARKETS <span className={s.metaSep}>/</span> ONCHAIN SOLANA DEVNET</span>
          </div>
          <div className={s.diagram}>
            <svg viewBox="0 0 980 450" role="img" aria-labelledby="arch-t">
              <title id="arch-t">Hedgehog architecture: the owner describes the business; the AI advisor maps risks and picks live markets on Kalshi, Gemini and Polymarket; the quote engine sizes cover; the owner signs in their wallet, buying outcome tokens from the desk or a Hedgehog Cover policy on Solana devnet; Hedgehog&apos;s desk backs each sale on Gemini and the crank settles from official results; QuickNode Streams pushes onchain events to the live dashboard.</title>
              <defs>
                <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="var(--ink)" /></marker>
                <pattern id="onchain" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="1" />
                </pattern>
              </defs>
              {/* onchain zone: engraved hatching below the fold line */}
              <rect x="8" y="290" width="964" height="156" fill="url(#onchain)" />
              <line x1="8" y1="290" x2="972" y2="290" stroke="var(--ink)" strokeWidth="1" />
              <line x1="8" y1="293" x2="972" y2="293" stroke="var(--ink)" strokeWidth="1" />
              <text x="20" y="24" className={s.dZone}>OFFCHAIN · NEXT.JS APP + MARKETS</text>
              <text x="20" y="280" className={s.dZone}>ONCHAIN · SOLANA DEVNET ↓</text>

              {/* row 1: intake → AI → markets */}
              <Box x={20} y={60} w={170} h={60} n="01" title="Business owner" sub="preset or one sentence" />
              <Box x={240} y={60} w={200} h={60} n="02" title="AI risk advisor" sub="risks → live market picks" />
              <Box x={500} y={40} w={220} h={50} n="03" title="Kalshi · Polymarket" sub="gaps Gemini can't fill · cross-check" tone="var(--kalshi)" />
              <Box x={500} y={106} w={220} h={50} n="04" title="Gemini Prediction Markets" sub="primary prices · desk backs here" tone="var(--gemini)" />
              {/* row 2: quote, desk/crank, dashboard */}
              <Box x={240} y={190} w={200} h={60} n="05" title="Quote engine" sub="size · walk book · fit budget" />
              <Box x={500} y={190} w={220} h={60} n="06" title="Hedgehog desk + crank" sub="backs sales · settles from results" />
              <Box x={780} y={190} w={180} h={60} n="07" title="Live dashboard" sub="positions, payouts, feed" />
              {/* row 3: onchain */}
              <Box x={20} y={330} w={180} h={64} n="08" title="Owner's wallet" sub="Phantom / MetaMask signs" />
              <Box x={240} y={330} w={220} h={64} n="09" title="Outcome tokens" sub="YES/NO SPL mints · $1 if it happens" />
              <Box x={500} y={330} w={220} h={64} n="10" title="hedgehog_policy (Anchor)" sub="USDC vault · budget · payout" />
              <Box x={780} y={330} w={180} h={64} n="11" title="QuickNode Streams" sub="filters our txs → webhook" />

              <Arrow d="M190 90 H238" />
              <Arrow d="M440 80 L498 66" label="prices" lx={469} ly={60} />
              <Arrow d="M440 100 L498 128" />
              <Arrow d="M340 120 V188" label="picks (IDs only)" lx={392} ly={160} />
              <Arrow d="M580 188 V158" label="backing" lx={548} ly={177} />
              <Arrow d="M640 158 V188" label="results" lx={676} ly={177} />
              <Arrow d="M290 250 V300 H110 V328" label="quote → buy tx" lx={200} ly={314} />
              <Arrow d="M200 362 H238" />
              <Arrow d="M110 394 V424 H560 V396" label="signs policy" lx={335} ly={440} />
              <Arrow d="M640 250 V328" label="settle" lx={668} ly={314} />
              <Arrow d="M540 250 V300 H400 V328" label="payouts" lx={470} ly={318} />
              <Arrow d="M720 362 H778" />
              <Arrow d="M870 328 V252" label="webhook" lx={906} ly={314} />
            </svg>
          </div>
          <p className={s.scrollHint} aria-hidden="true">Scroll the exhibit sideways <IconArrowRight size={12} /></p>
        </section>

        {/* Exhibit B: what the cover does on a bad day */}
        <section className="sec" aria-labelledby="ex-b">
          <div className="sec-head">
            <div><span className="eyebrow">Exhibit B</span><h2 id="ex-b">A worst day, <em>on paper</em></h2></div>
            <span className="muted small">Example: the patio bar at 50% coverage.</span>
          </div>
          <div className={`card ${s.dayCard}`}>
            <DayBars normalUsd={3200} lossUsd={1100} payoutUsd={550} premiumUsd={154} normalLabel="Normal day" badLabel="Rainy Saturday" />
          </div>
        </section>

        {/* Three clauses */}
        <section className="sec" aria-labelledby="clauses">
          <div className="sec-head">
            <div><span className="eyebrow">The stack, in three clauses</span><h2 id="clauses">Priced, settled, <em>and watched</em></h2></div>
          </div>
          <ol className={s.clauses}>
            <li className={s.clause}>
              <span className={s.cno}>§ 1</span>
              <span className="badge badge-gemini">Gemini Prediction Markets</span>
              <h3>Priced &amp; hedged on Gemini</h3>
              <p>Gemini is the primary venue. Its live books (Austin highs, NBA/NFL games, WTI and Brent) price the cover. When a business buys, Hedgehog&apos;s desk <b>backs the exposure with the same contract on Gemini</b> via the Trader API, like an insurer reinsuring. Kalshi (on Solana via DFlow) fills what Gemini doesn&apos;t list: rain, snow, Texas power, lake levels, diesel, CPI. Polymarket is a read-only price check.</p>
            </li>
            <li className={s.clause}>
              <span className={s.cno}>§ 2</span>
              <span className="badge badge-kalshi">Solana</span>
              <h3>Settled on Solana</h3>
              <p>Each hedge is an SPL outcome token (the DFlow model) minted at the venue&apos;s live ask. The desk co-signs, the owner signs in Phantom, and winning tokens pay $1 USDC. <b>Hedgehog Cover</b> is our Anchor program: premiums go into a USDC vault, a monthly budget cap is enforced onchain, and payouts are parametric.</p>
            </li>
            <li className={s.clause}>
              <span className={s.cno}>§ 3</span>
              <span className="badge badge-neutral">QuickNode Streams</span>
              <h3>The live coverage feed</h3>
              <p>A QuickNode Stream on the owner&apos;s token mints and the policy program pushes fills, resolutions and payouts to our webhook. The dashboard shows them in plain words: “Hedge filled”, “Paid $480”.</p>
            </li>
          </ol>
        </section>

        <section className="sec">
          <div className={s.two}>
            <div>
              <span className="eyebrow">Venues</span>
              <h2 className={s.h2}>One market layer, <em>three venues</em></h2>
              <p className={s.intro}>You never pick a venue. <b>Gemini first, Kalshi where Gemini has nothing, Polymarket for reference.</b></p>
              <div className={`card ${s.legend}`}><VenueLegend /></div>
              <h3 className={s.h3}>What&apos;s on the menu</h3>
              <ul className={s.ledger}>
                <li><b>Gemini:</b> daily highs in 60+ cities, games, crude, natural gas, metals, crypto, Fed decisions.</li>
                <li><b>Kalshi via DFlow on Solana:</b> rain (daily and monthly totals in 30+ cities), daily highs and lows, December snowfall by city, ski-resort snowfall, season snow days, ERCOT power prices, Lake Mead, heating degree days, weekly diesel and gas, CPI, tornado counts.</li>
                <li><b>Polymarket (reference only):</b> Mississippi River low water, Lake Powell, Great Salt Lake, LA earthquake, US tornado totals.</li>
                <li><b>Not hedgeable anywhere yet:</b> wildfire, flood, hail, air quality. We say so rather than force a bad proxy.</li>
              </ul>
            </div>
            <div>
              <span className="eyebrow">Selection</span>
              <h2 className={s.h2}>How we choose, <em>and show it</em></h2>
              <ol className={`${s.ledger} ${s.numbered}`}>
                <li><b>Same event, side by side.</b> Each hedge shows a one-line check, e.g. <span className={s.sample}>Gemini 11% · Kalshi 12% · Polymarket 11% — markets agree</span>, that opens into a full comparison.</li>
                <li><b>Gemini first.</b> Code (not the AI) swaps a Kalshi pick for the identical Gemini contract if it costs at most 1¢ more. Otherwise Kalshi stays.</li>
                <li><b>Disagreement is flagged.</b> A venue 4+ points away gets a warning. Similar-but-not-identical questions are marked ≈.</li>
                <li><b>Same on the dashboard.</b> Each position shows where its price came from and where it&apos;s backed.</li>
              </ol>
              <Link href="/markets?cross=1" className="btn">Browse every live market <IconArrowRight size={14} /></Link>
            </div>
          </div>
        </section>

        <section className={`sec ${s.last}`}>
          <div className={s.two}>
            <div>
              <span className="eyebrow">Disclosures</span>
              <h2 className={s.h2}>Trust assumptions, <em>stated plainly</em></h2>
              <ol className={s.articles}>
                <li><b>The AI can&apos;t invent markets.</b> It picks from contract IDs our code pulled from live venue APIs. Sizing and budget are plain code.</li>
                <li><b>Basis risk is real.</b> Rain at the airport ≠ rain on your patio; a loss ≠ an empty bar. Every line shows its mismatch note.</li>
                <li><b>Desk solvency.</b> Gemini-priced tokens are a promise from Hedgehog&apos;s desk, backed by an offsetting Gemini position and a USDC vault anyone can check onchain (below). Backing orders are <b>dry-run</b> until the desk&apos;s Gemini account is funded.</li>
                <li><b>Settlement.</b> One attestor key (our crank) settles Cover policies from the venue&apos;s official result. If it never settles, the owner can reclaim the premium after expiry. Next: oracle or multisig.</li>
                <li><b>Devnet only.</b> Everything runs on Solana devnet with test USDC. The token desk mirrors real Gemini/Kalshi prices but is our own venue; the DFlow mainnet path uses the same interface.</li>
                <li><b>Not an insurer.</b> Hedgehog is an advisor plus self-directed hedges; the Cover program is a prototype of the long-term product.</li>
              </ol>
              <Link href="/" className="btn btn-primary">Try it with a preset <IconArrowRight size={14} /></Link>
            </div>
            <div>
              <span className="eyebrow">Onchain</span>
              <h2 className={s.h2}>Addresses</h2>
              <CoverInfoPanel />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
