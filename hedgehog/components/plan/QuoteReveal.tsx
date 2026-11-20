"use client";
// "Your quote is ready": a formal issuing moment when the AI finishes a quote. The certificate is lifted from flat
// to upright (CSS 3D), its title rules draw, the amount counts up, each risk is entered as a ledger line, the
// underwriter signs and the seal is pressed, then it hands over to the plan. Click / Enter / Esc skips.
// prefers-reduced-motion: no 3D, everything shown at once, short hold.
import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/client/format";
import { Rosette, Seal } from "../Engraving";
import { IconArrowRight } from "../Icons";
import s from "./QuoteReveal.module.css";

export type RevealLine = { title: string; payoutUsd: number };

function useCount(to: number, start: boolean, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(to * (1 - Math.pow(1 - k, 4))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, start, ms]);
  return v;
}

export function QuoteReveal({ name, payoutUsd, lines, onDone }: {
  name: string; payoutUsd: number; lines: RevealLine[]; onDone: () => void;
  /** kept for callers that still pass them */ premiumUsd?: number; risks?: number;
}) {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [out, setOut] = useState(false);
  const [counting, setCounting] = useState(false);
  const done = useRef(false);
  const shown = lines.slice(0, 4);
  const issued = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setOut(true);
    setTimeout(onDone, reduced ? 150 : 700);
  };
  useEffect(() => {
    const ts = reduced
      ? [setTimeout(finish, 1800)]
      : [setTimeout(() => setCounting(true), 1500), setTimeout(finish, 6200)];
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); } };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { ts.forEach(clearTimeout); window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const amount = useCount(payoutUsd, counting && !reduced);

  return (
    <div className={`${s.overlay} ${out ? s.out : ""} ${reduced ? s.reduced : ""}`} role="dialog" aria-modal="true" aria-label="Your quote is ready" onClick={finish}>
      <div className={s.lines} aria-hidden="true" />
      <Rosette className={s.watermark} density={22} steps={360} />
      <div className={s.stage}>
        <p className={s.issuing} aria-hidden="true">Your quote is ready</p>
        <div className={s.card3d}>
          <div className={s.paper}>
            <div className={s.border} aria-hidden="true" />
            <div className={s.sheen} aria-hidden="true" />
            <div className={s.head}><span className={s.rule} /><span>Proposed cover</span><span className={s.rule} /></div>
            <p className={s.issued}>Prepared for</p>
            <h2 className={s.name}>{name}</h2>
            <div className={s.amountBox}>
              <span>Pays you up to</span>
              <b>{usd(reduced || !counting ? (reduced ? payoutUsd : 0) : amount)}</b>
            </div>
            <ul className={s.ledger}>
              {shown.map((l, i) => (
                <li key={l.title} style={{ animationDelay: reduced ? "0s" : `${2.3 + i * 0.22}s` }}>
                  <span>{l.title}</span><i aria-hidden="true" /><b>{usd(l.payoutUsd)}</b>
                </li>
              ))}
              {lines.length > shown.length && <li className={s.more} style={{ animationDelay: reduced ? "0s" : `${2.3 + shown.length * 0.22}s` }}>+ {lines.length - shown.length} more</li>}
            </ul>
            <div className={s.foot}>
              <div className={s.sign}>
                <svg viewBox="0 0 220 44" aria-hidden="true">
                  <path d="M6 30 C 22 8, 34 8, 30 26 S 46 38, 58 20 S 74 6, 76 24 S 92 36, 104 18 C 112 8, 120 30, 128 22 S 146 10, 156 24 S 176 32, 190 16 L 212 14" />
                </svg>
                <span>Underwriter</span>
              </div>
              <div className={s.date}><b>{issued}</b><span>Settles on Solana</span></div>
            </div>
          </div>
          <div className={s.seal} aria-hidden="true"><Seal /></div>
        </div>
        <button type="button" className={`btn ${s.go}`} onClick={(e) => { e.stopPropagation(); finish(); }}>
          See my quote <IconArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
