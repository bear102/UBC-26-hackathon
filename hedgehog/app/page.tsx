import Link from "next/link";
import { PresetGrid } from "@/components/PresetGrid";
import { GuillocheBand, Rosette, Seal, Swash } from "@/components/Engraving";
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
              Insure your business against{" "}
              <em className={s.hedge}>anything<Swash /></em>
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
                    <div><div className="cert-kicker">Example cover</div><div className="cert-title">Certificate of Cover</div></div>
                    <div className="serial">No. SPECIMEN<small>Example · not issued</small></div>
                  </div>
                  <h3>Rain washes out Saturday on the patio</h3>
                  <p className="insured">Insured: <b>Rainey St patio bar</b> · 50% coverage · Trigger: measurable rain at Austin-Bergstrom, <b>Sat Nov 21</b></p>
                  <div className="terms">
                    <div className="term pay"><span className="lab">If it rains, you get</span><span className="amt">$550</span><div className="sub">Paid to your wallet automatically</div></div>
                    <div className="term cost"><span className="lab">If it doesn&apos;t, you paid</span><span className="amt">$154</span><div className="sub">Your premium. Nothing more.</div></div>
                  </div>
                  <div className="cert-foot">
                    <div className="facts">
                      <div>Market odds<b>28%</b></div>
                      <div>Expected loss<b>~$1,100</b></div>
                                            <div>Venue<b className={s.venue}><span className="badge badge-kalshi">Kalshi · DFlow</span></b></div>
                    </div>
                    <div className="sig"><div className="line">one signature</div><small>Signed on Solana</small></div>
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
              <h3>One signature on Solana</h3>
              <p>One signature buys a Hedgehog Cover policy on Solana, sold only if its vault can pay. Payouts land in your wallet.</p>
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
