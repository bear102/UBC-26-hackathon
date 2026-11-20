import Link from "next/link";
import { PresetGrid } from "@/components/PresetGrid";
import { GuillocheBand, Rosette, Seal } from "@/components/Engraving";
import { IconArrowRight, PerilIcon } from "@/components/Icons";
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
            <div className={`cert tilt ${s.heroCert}`}>
              <div className="seal-stamp"><Seal /></div>
              <div className="cert-frame">
                <GuillocheBand />
                <div className="cert-in">
                  <Rosette className="cert-rosette" density={9} steps={220} />
                  <div className={s.certHead}>
                    <span className={s.rule} aria-hidden="true" />
                    <div className={s.certTitle}>Certificate of Cover</div>
                    <span className={s.rule} aria-hidden="true" />
                  </div>
                  <h3 className={s.certH}>If it rains or turns cold and nobody shows up…</h3>
                  <p className={s.certWho}>Rainey St patio bar, Austin · <b>Saturday, Nov 21</b></p>
                  <div className={`terms ${s.certTerms}`}>
                    <div className={`term pay ${s.payBox}`}><span className={`lab ${s.payLab}`}><i aria-hidden="true" />We pay you up to<i aria-hidden="true" /></span><span className="amt">$950</span></div>
                  </div>
                  <ul className={s.ifs}>
                    <li>
                      <span className={s.ifIc} aria-hidden="true"><PerilIcon peril="rain" size={16} /></span>
                      <span className={s.ifTxt}>If it rains<small>28% chance · Kalshi</small></span>
                      <span className={s.leader} aria-hidden="true" />
                      <b>$550</b>
                    </li>
                    <li>
                      <span className={s.ifIc} aria-hidden="true"><PerilIcon peril="cold" size={16} /></span>
                      <span className={s.ifTxt}>If a cold snap hits<small>12% chance · Gemini</small></span>
                      <span className={s.leader} aria-hidden="true" />
                      <b>$400</b>
                    </li>
                  </ul>
                  {/* worst case (rain and cold): −$1,900 uncovered vs −$952 covered = 49.9% less */}
                  <div className={s.worst}>
                    <b className={s.worstPct}>50%</b>
                    <span className={s.worstLab}>smaller loss on your worst Saturday</span>
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
          </div>
          <PresetGrid />
        </div>
      </section>

      <section className="sec">
        <div className="container">
          <div className="sec-head">
            <div><span className="eyebrow">The terms, in three clauses</span><h2>From your worst day <em>to a payout</em></h2></div>
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
