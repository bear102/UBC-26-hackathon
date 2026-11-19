import Link from "next/link";
import { PresetGrid } from "@/components/PresetGrid";
import { GuillocheBand, Rosette, Seal } from "@/components/Engraving";
import { IconArrowRight } from "@/components/Icons";
import { PastQuotes } from "@/components/PastQuotes";
import s from "./page.module.css";

const PRICED = ["Priced on Gemini", "Kalshi", "Polymarket", "Paid out on Solana"];

export default function Landing() {
  const priced = (cls: string) => (
    <div className={`${s.priced} ${cls}`}>
      {PRICED.map((p, i) => <span key={p}>{i > 0 && <i className={s.sep} aria-hidden="true" />}{p}</span>)}
      <span className={s.feed}>Live feed via QuickNode Streams</span>
    </div>
  );
  return (
    <>
      <section className={s.hero}>
        <Rosette className={s.bgRosette} density={24} steps={360} />
        <div className={`container ${s.heroGrid}`}>
          <div className={s.copy}>
            <span className="eyebrow">Insurance for your worst business day</span>
            <h1 className={s.h1}>
              Insure any <br className={s.br} />business against <br className={s.br} />
              <em className={s.stamp}>anything</em>
            </h1>
            <p className={`lede ${s.lede}`}>
              Our AI finds the days that would hurt your business and builds cover from live prediction markets.
              <b> You see what it pays if the bad day happens, and what it costs if it doesn&apos;t.</b>
              {" "}Your policy lives on Solana: the payout pool is public, and when the result comes in you&apos;re paid automatically.
            </p>
            <div className={s.cta}>
              <a href="#pick" className="btn btn-primary btn-lg">Get my quote <IconArrowRight size={16} /></a>
              <Link href="/how-it-works" className="btn btn-lg">How it works</Link>
            </div>
            {priced(s.pricedDesk)}
          </div>

          <div className={`cert-stage ${s.stage}`} aria-label="Example quote">
            <div className="cert-under" />
            <div className="cert tilt">
              <div className="seal-stamp"><Seal /></div>
              <div className="cert-frame">
                <GuillocheBand />
                <div className="cert-in">
                  <Rosette className="cert-rosette" density={9} steps={220} />
                  <div className="cert-head">
                    <div><div className="cert-kicker">Example</div><div className="cert-title">Certificate of Cover</div></div>
                  </div>
                  <h3>Rain or a cold snap empties the patio</h3>
                  <p className="insured">Rainey St patio bar · <b>Sat Nov 21</b> · rain <b>28%</b> on Kalshi · cold snap <b>12%</b> on Gemini</p>
                  <div className="terms">
                    <div className="term pay"><span className="lab">You get up to</span><span className="amt">$950</span></div>
                    <div className="term cost"><span className="lab">You pay</span><span className="amt">$202</span></div>
                  </div>
                  <table className={s.swing}>
                    <thead><tr><th>Saturday</th><th>Without cover</th><th>With cover</th></tr></thead>
                    <tbody>
                      <tr><th>Normal</th><td>$0</td><td>−$202</td></tr>
                      <tr><th>Rainy</th><td className={s.bad}>−$1,100</td><td>−$752</td></tr>
                      <tr><th>Cold</th><td className={s.bad}>−$800</td><td>−$602</td></tr>
                      <tr className={s.worst}><th>Rainy and cold</th><td className={s.bad}>−$1,900</td><td>−$952</td></tr>
                    </tbody>
                  </table>
                  <p className={s.swingNote}>A known <b>$202</b> cuts your worst Saturday in half: <b>$952</b> instead of <b>$1,900</b>.</p>
                </div>
                <GuillocheBand tone="red" />
              </div>
            </div>
          </div>
          {priced(s.pricedMob)}
        </div>
      </section>

      <section className="sec" id="pick">
        <div className="container">
          <PastQuotes eyebrow="Welcome back" />
          <div className="sec-head">
            <div><span className="eyebrow">Step 1</span><h2>Pick a business, <em>or describe yours</em></h2></div>
            <span className="muted small">Three Austin examples · a quote in about 30 seconds</span>
          </div>
          <PresetGrid />
        </div>
      </section>

      <section className="sec">
        <div className="container">
          <div className="sec-head">
            <div><span className="eyebrow">The terms, in three clauses</span><h2>From your worst day <em>to a payout</em></h2></div>
            <Link href="/how-it-works" className="btn btn-sm">How it works <IconArrowRight size={14} /></Link>
          </div>
          <ol className={s.clauses}>
            <li className={s.clause}>
              <span className={s.cno}>§ 1</span>
              <h3>AI maps your risks</h3>
              <p>Rain, cold fronts, game nights, fuel spikes. Each gets a trigger and a dollar loss.</p>
            </li>
            <li className={s.clause}>
              <span className={s.cno}>§ 2</span>
              <h3>Matched to live markets</h3>
              <p>Live Gemini, Kalshi and Polymarket contracts that pay when that day comes. The cheapest one prices your cover.</p>
            </li>
            <li className={s.clause}>
              <span className={s.cno}>§ 3</span>
              <h3>One signature on Solana</h3>
              <p>One signature buys a Hedgehog Cover policy on Solana, sold only if its vault can pay. Payouts land in your wallet.</p>
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
