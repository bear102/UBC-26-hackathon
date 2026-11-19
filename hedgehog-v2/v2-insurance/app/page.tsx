import Link from "next/link";
import { PresetGrid } from "@/components/PresetGrid";
import s from "./page.module.css";

export default function Landing() {
  return (
    <>
      <section className="container">
        <div className={s.hero}>
          <div>
            <span className="eyebrow">Insurance for your worst business day</span>
            <h1>What&apos;s your worst business day? <em>Hedge it.</em></h1>
            <p className={s.lede}>
              Hedgehog&apos;s AI reads your business, finds the days that hurt, and builds cover from live prediction markets.
              You see it like an insurance quote: what it pays if the bad day happens, what it costs if it doesn&apos;t.
            </p>
            <div className="row">
              <a href="#pick" className="btn btn-primary btn-lg">Get my quote</a>
              <Link href="/how-it-works" className="btn btn-lg btn-ghost">How it works</Link>
            </div>
            <div className={s.trust}>
              <span className="badge badge-gemini">Priced on Gemini prediction markets</span>
              <span className="badge badge-kalshi">Kalshi outcome tokens on Solana</span>
              <span className="badge badge-neutral">Live feed via QuickNode Streams</span>
            </div>
          </div>
          <div className={s.sample} aria-label="Example quote">
            <div className={s.behind} />
            <div className="card">
              <div className={s.sampleHead}>
                <span className="eyebrow">Example cover</span>
                <span className="badge badge-kalshi">Kalshi · DFlow</span>
              </div>
              <h3>Rain washes out Saturday on the patio</h3>
              <p className="muted small" style={{ margin: 0 }}>Rainey St patio bar · trigger: measurable rain at Austin-Bergstrom, Sat Nov 21</p>
              <div className={s.split}>
                <div className={`${s.box} ${s.boxPay}`}><span className="xs">If it rains, you get</span><b>$550</b></div>
                <div className={`${s.box} ${s.boxCost}`}><span className="xs">If it doesn&apos;t, you paid</span><b>$154</b></div>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                Expected loss on a wet Saturday: <b style={{ color: "var(--ink)" }}>~$1,100</b>. Market odds of rain: <b style={{ color: "var(--ink)" }}>28%</b>. 50% coverage, one signature.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="container section" id="pick">
        <div className="row between" style={{ alignItems: "flex-end", marginBottom: 16 }}>
          <div>
            <span className="eyebrow">Step 1</span>
            <h2 style={{ margin: 0 }}>Pick a business, or describe yours</h2>
          </div>
          <span className="muted small">Three Austin examples · about 30 seconds to a quote</span>
        </div>
        <PresetGrid />
      </section>

      <section className="container section">
        <div className={s.steps}>
          <div className={s.step}><h3>AI maps your risks</h3><p>Rain, cold fronts, game nights, fuel spikes. Each with a trigger, a dollar loss and the reasoning behind it.</p></div>
          <div className={s.step}><h3>Matched to live markets</h3><p>Gemini and Kalshi contracts that pay when that bad day happens, with the odds, the price and an honest basis-risk note.</p></div>
          <div className={s.step}><h3>One signature on Solana</h3><p>Buy the hedge as outcome tokens, or take a Hedgehog Cover policy from the onchain underwriter. Payouts land in your wallet.</p></div>
        </div>
      </section>
    </>
  );
}
