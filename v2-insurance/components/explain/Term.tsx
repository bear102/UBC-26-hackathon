"use client";
import { useId, useState, type ReactNode } from "react";
import { GLOSSARY } from "@/lib/client/explain";
import s from "./explain.module.css";

/** Glossary tooltip for an unavoidable term. Hover, focus or tap to read; Escape closes. */
export function Term({ k, children, def }: { k?: keyof typeof GLOSSARY | string; children: ReactNode; def?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = def ?? (k ? GLOSSARY[k] : undefined);
  if (!text) return <>{children}</>;
  return (
    <span className={s.term} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={s.termBtn} aria-describedby={id} aria-expanded={open}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
        {children}
      </button>
      <span role="tooltip" id={id} className={`${s.tip} ${open ? s.open : ""}`}>{text}</span>
    </span>
  );
}
