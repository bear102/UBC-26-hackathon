"use client";
// Full-screen "your cover is ready" moment when the AI finishes a quote: a certificate flies in through a turning
// engraved-rosette tunnel (CSS 3D), the totals count up, the seal stamps it, then it hands over to the plan.
// Click / Enter / Esc skips. prefers-reduced-motion: no 3D, short fade.
import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/client/format";
import { Rosette, Seal } from "../Engraving";
import { IconArrowRight } from "../Icons";
import s from "./QuoteReveal.module.css";

function useCount(to: number, start: boolean, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, start, ms]);
  return v;
}

export function QuoteReveal({ name, payoutUsd, premiumUsd, risks, onDone }: {
  name: string; payoutUsd: number; premiumUsd: number; risks: number; onDone: () => void;
}) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<"in" | "count" | "stamp" | "out">("in");
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    setPhase("out");
    setTimeout(onDone, reduced ? 150 : 650);
  };
  useEffect(() => {
    const ts = reduced
      ? [setTimeout(() => setPhase("stamp"), 50), setTimeout(finish, 1600)]
      : [setTimeout(() => setPhase("count"), 900), setTimeout(() => setPhase("stamp"), 1900), setTimeout(finish, 4200)];
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); } };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { ts.forEach(clearTimeout); window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const counting = phase !== "in";
  const pay = useCount(payoutUsd, counting && !reduced);
  const prem = useCount(premiumUsd, counting && !reduced);
  const show = (v: number, real: number, d = 0) => usd(reduced || phase === "stamp" || phase === "out" ? real : v, d);

  return (
    <div className={`${s.overlay} ${s[phase]} ${reduced ? s.reduced : ""}`} role="dialog" aria-modal="true" aria-label="Your cover is ready" onClick={finish}>
      <div className={s.tunnel} aria-hidden="true">
        <Rosette className={`${s.ring} ${s.r1}`} density={18} steps={320} />
        <Rosette className={`${s.ring} ${s.r2}`} density={14} steps={280} />
        <Rosette className={`${s.ring} ${s.r3}`} density={10} steps={240} />
      </div>
      <div className={s.stage}>
        <div className={s.card3d}>
          <div className={`${s.sheet} ${s.back2}`} aria-hidden="true" />
          <div className={`${s.sheet} ${s.back1}`} aria-hidden="true" />
          <div className={`${s.sheet} ${s.front}`}>
            <div className={s.head}><span className={s.rule} /><span>Certificate of Cover</span><span className={s.rule} /></div>
            <p className={s.kicker}>Your cover is ready</p>
            <h2 className={s.name}>{name}</h2>
            <div className={s.terms}>
              <div><span>Pays you up to</span><b className={s.pay}>{show(pay, payoutUsd)}</b></div>
              <div><span>You pay</span><b>{show(prem, premiumUsd, 2)}</b></div>
            </div>
            <p className={s.sub}>{risks} risk{risks === 1 ? "" : "s"} matched to live markets</p>
            <div className={s.seal} aria-hidden="true"><Seal /></div>
          </div>
        </div>
        <button type="button" className={`btn ${s.go}`} onClick={(e) => { e.stopPropagation(); finish(); }}>
          See my quote <IconArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
