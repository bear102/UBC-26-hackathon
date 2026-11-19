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
              Insure <span className={s.any}>any</span> <br className={s.br} />business against <br className={s.br} />
              <em className={s.stamp}>anything</em>
            </h1>
            <p className={`lede ${s.lede}`}>
              Our AI finds the days that would hurt your business and builds cover from live prediction markets.
              <b> You see what it pays if the bad day happens, and what it costs if it doesn&apos;t.</b>
              {" "}Your policy lives on Solana, not in our database: the vault is public and the program pays your wallet.
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
                  <ul className={s.ifs}>
                    <li><span>If it rains Saturday</span><b>we pay you $550</b></li>
                    <li><span>If a cold snap hits</span><b>we pay you $400</b></li>
                  </ul>
                  {/* worst case (rain and cold): −$1,900 uncovered vs −$952 covered = 49.9% less */}
                  <div className={s.worst}>
                    <span className={s.worstLab}>Cuts your worst-Saturday losses by</span>
                    <b className={s.worstPct}>50%</b>
                  </div>
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
              <h3>Your policy lives on Solana</h3>
              <p>A Solana program holds the premium in a public vault, only sells cover the vault can pay, and pays your wallet. If no result ever arrives, anyone can trigger your refund onchain.</p>
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
