"use client";
// Fades sections and cards up as they scroll into view. Purely additive: content is visible by default, and only
// runs when <html> has the "fx" class (set before first paint by the inline script in app/layout.tsx: motion allowed,
// i.e. not prefers-reduced-motion and not browser automation unless ?fx=1 / localStorage hh.fx). Only elements still
// below the fold when the page loads get the "pending" state, so nothing already on screen ever flickers.
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const SELECTOR = "main .sec-head, main .card, main .form, main [data-reveal], main #risks article, main .stub";

export function ScrollReveal() {
  const path = usePathname();
  useEffect(() => {
    if (!document.documentElement.classList.contains("fx") || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const t = setTimeout(() => {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).classList.add("rv-in");
          io?.unobserve(e.target);
        }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      const vh = window.innerHeight;
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el, i) => {
        if (el.dataset.rv || el.closest(".modal, [role=dialog]")) return;
        el.dataset.rv = "1";
        if (el.getBoundingClientRect().top < vh * 0.92) return; // already visible: leave it alone
        el.classList.add("rv");
        el.style.setProperty("--rv-delay", `${(i % 4) * 60}ms`);
        io!.observe(el);
      });
    }, 150); // after the page has laid out
    return () => { clearTimeout(t); io?.disconnect(); };
  }, [path]);
  return null;
}
