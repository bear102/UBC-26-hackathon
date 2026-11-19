import Link from "next/link";
import { PresetGrid } from "@/components/PresetGrid";
import { GuillocheBand, Rosette, Seal, Swash } from "@/components/Engraving";
import { IconArrowRight } from "@/components/Icons";
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
              <span className={s.q}>What&apos;s your worst business day?</span>{" "}
              <em className={s.hedge}>Hedge it.<Swash /></em>
            </h1>
            <p className={`lede ${s.lede}`}>
              Hedgehog&apos;s AI reads your business, finds the days that hurt, and builds cover from live prediction markets.
              You see it like an insurance quote: <b>what it pays if the bad day happens, what it costs if it doesn&apos;t.</b>
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
          <div className="sec-head">
            <div><span className="eyebrow">Step 1</span><h2>Pick a business, <em>or describe yours</em></h2></div>
            <span className="muted small">Three Austin examples · about 30 seconds to a quote</span>
          </div>
          <PresetGrid />
        </div>
      </section>

      <section className="sec">
        <div className="container">
          <div className="sec-head">
            <div><span className="eyebrow">The terms, in three clauses</span><h2>From your worst day <em>to a payout</em></h2></div>
            <Link href="/how-it-works" className="btn btn-sm">Read how it works <IconArrowRight size={14} /></Link>
          </div>
          <ol className={s.clauses}>
            <li className={s.clause}>
              <span className={s.cno}>§ 1</span>
              <h3>AI maps your risks</h3>
              <p>Rain, cold fronts, game nights, fuel spikes. Each with a trigger, a dollar loss and the reasoning behind it.</p>
            </li>
            <li className={s.clause}>
              <span className={s.cno}>§ 2</span>
              <h3>Matched to live markets</h3>
              <p>Gemini and Kalshi contracts that pay when that bad day happens, with the odds, the price and an honest basis-risk note.</p>
            </li>
            <li className={s.clause}>
              <span className={s.cno}>§ 3</span>
              <h3>One signature on Solana</h3>
              <p>Buy the hedge as outcome tokens, or take a Hedgehog Cover policy from the onchain underwriter. Payouts land in your wallet.</p>
            </li>
          </ol>
        </div>
      </section>
    </>
  );
}
