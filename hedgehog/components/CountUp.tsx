"use client";
// Counts a dollar figure up from 0 once, when motion is allowed (<html class="fx">). Renders the final value on the
// server and without motion, so the number is always correct and readable.
import { useEffect, useRef, useState } from "react";

export function CountUp({ to, prefix = "$", delayMs = 0, ms = 1100 }: { to: number; prefix?: string; delayMs?: number; ms?: number }) {
  const [v, setV] = useState(to);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !document.documentElement.classList.contains("fx")) return;
    started.current = true;
    setV(0);
    let raf = 0;
    const t = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        setV(Math.round(to * (1 - Math.pow(1 - k, 4))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
  }, [to, delayMs, ms]);
  return <>{prefix}{v.toLocaleString()}</>;
}
