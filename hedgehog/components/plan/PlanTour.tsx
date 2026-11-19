"use client";
// First-visit guide through a finished plan: spotlights each part (what the AI found, the schedule, coverage,
// Cover all, a risk card, My cover) with Back / Next / Skip. Shown once per browser (hh.tourDone); can be replayed.
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import s from "./PlanTour.module.css";

const KEY = "hh.tourDone";
type Step = { sel: string; title: string; body: string }; // sel may list fallbacks with " || "
const STEPS: Step[] = [
  { sel: '[data-tour="note"]', title: "What the AI found", body: "Your biggest risks and the plan, in a few sentences." },
  { sel: '[data-tour="schedule"]', title: "Your schedule of cover", body: "One line per bad day: what it pays if it happens, and what it costs now." },
  { sel: '[data-tour="coverage"]', title: "Choose how much to cover", body: "Cover 25%, 50% or 100% of each loss. Prices update instantly." },
  { sel: "aside.bind .btn-buy", title: "Get covered", body: "Cover everything with one wallet approval, or pick risks one by one below." },
  { sel: '#risks [data-tour="loss"] || #risks article', title: "Each risk in detail", body: "Why it's priced this way and how you get paid. Think the loss is off? Edit it and the cover resizes." },
  { sel: 'header a[href="/dashboard"]', title: "After you buy", body: "Your policies and payouts live in My cover." },
];

export const tourDone = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
const markDone = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };

function visible(sel: string): HTMLElement | null {
  for (const one of sel.split(" || ")) {
    const hit = Array.from(document.querySelectorAll<HTMLElement>(one)).find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (hit) return hit;
  }
  return null;
}

export function PlanTour({ onClose }: { onClose: () => void }) {
  const steps = STEPS.filter((st) => visible(st.sel));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  const measure = useCallback(() => { const el = step && visible(step.sel); setRect(el ? el.getBoundingClientRect() : null); }, [step]);
  useLayoutEffect(() => {
    const el = step && visible(step.sel);
    if (!el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = el.getBoundingClientRect();
    const fits = r.height < window.innerHeight - 260;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: fits ? "center" : "start" });
    const t = setTimeout(measure, smooth ? 450 : 30);
    return () => clearTimeout(t);
  }, [step, measure]);
  useEffect(() => {
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, { passive: true });
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); };
  }, [measure]);

  const close = useCallback(() => { markDone(); onClose(); }, [onClose]);
  const next = useCallback(() => (i + 1 < steps.length ? setI(i + 1) : close()), [i, steps.length, close]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [close, next]);

  if (!step) return null;
  const pad = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const box = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: Math.min(rect.height + pad * 2, vh - 40) } : null;
  // tooltip below the spotlight if there's room, else above; clamp to the viewport
  const tipW = Math.min(340, vw - 32);
  const below = box ? box.top + box.height + 190 < vh : true;
  const tipTop = box ? (below ? box.top + box.height + 12 : Math.max(12, box.top - 12 - 170)) : vh / 2 - 80;
  const tipLeft = box ? Math.min(Math.max(16, box.left), vw - tipW - 16) : (vw - tipW) / 2;

  return (
    <div className={s.layer} role="dialog" aria-modal="true" aria-label="Guide to your plan">
      {box ? <div className={s.spot} style={box} /> : <div className={s.dim} />}
      <div className={s.tip} style={{ top: tipTop, left: tipLeft, width: tipW }}>
        <div className={s.count}>{i + 1} of {steps.length}</div>
        <h3 className={s.title}>{step.title}</h3>
        <p className={s.body}>{step.body}</p>
        <div className={s.row}>
          <button type="button" className={s.skip} onClick={close}>Skip tour</button>
          <span className={s.btns}>
            {i > 0 && <button type="button" className="btn btn-sm" onClick={() => setI(i - 1)}>Back</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={next} autoFocus>{i + 1 < steps.length ? "Next" : "Done"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
