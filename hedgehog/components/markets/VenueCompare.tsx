"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { QuoteLine } from "@/lib/types";
import { fmtChance, fmtDepth, fmtPer1, getComparison, localComparison, marketsHref, venueName, type Comparison } from "@/lib/client/venues";
import { VenueBadge } from "./VenueBadge";
import { When } from "./When";
import { IconChevronDown, IconChevronUp, IconExternal, IconWarning, IconArrowRight } from "@/components/Icons";
import s from "./markets.module.css";

const TONE: Record<Comparison["verdict"], string> = { agree: s.agree, close: s.close, differ: s.differ, single: s.single, "similar-only": s.single };

/**
 * "Where this price comes from": the hedge's market on Gemini / Kalshi / Polymarket, side by side.
 * Compact by default (one line + any disagreement flag); expands into a table with chance, cost per $1,
 * depth and expiry, marking the best price and the venue we use (and why).
 */
export function VenueCompare({ line, location }: { line: QuoteLine; location?: string }) {
  const [cmp, setCmp] = useState<Comparison>(() => localComparison(line));
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    getComparison(line).then((c) => { if (live) { setCmp(c); setLoading(false); } });
    return () => { live = false; };
  }, [line]);

  const c = line.contract;
  const used = cmp.rows.find((r) => r.used) ?? cmp.rows[0];
  const what = `${line.side === "yes" ? "Yes" : "No"} on “${c.label}”`;
  const tail = cmp.verdict === "agree" ? "markets agree" : cmp.verdict === "close" ? "markets roughly agree"
    : cmp.verdict === "differ" ? `markets disagree by ${cmp.spreadPts} pts` : cmp.verdict === "single" ? `only ${venueName(c.venue)} lists this` : "only similar questions elsewhere";

  return (
    <div className={s.cmp}>
      <div className={s.cmpHead}>
        <span className="eyebrow">Where the price comes from</span>
        <VenueBadge venue={c.venue} role={false} />
      </div>
      <p className={s.buy}>You hold <b>{what}</b>{c.eventTitle ? <span className="muted"> · {c.eventTitle}</span> : null}</p>

      <button type="button" className={s.line} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={s.vals}>
          {cmp.rows.map((r, i) => (
            <span key={r.venue} className={s.val}>
              {i > 0 && <span className={s.dot} aria-hidden="true">·</span>}
              <span className={s[`v_${r.venue}`]}>{venueName(r.venue)}</span> <b className="num">{fmtChance(r.prob)}</b>
              {r.match === "similar" && <sup title={r.matchNote ? `Similar question: ${r.matchNote}` : "Similar question, not identical"}>≈</sup>}
            </span>
          ))}
          <span className={`${s.verdict} ${TONE[cmp.verdict]}`}>— {tail}</span>
          {loading && <span className="spinner" style={{ width: 11, height: 11, marginLeft: 6 }} aria-label="checking other markets" />}
        </span>
        <span className={s.more}>{open ? "Hide" : "Compare"} {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}</span>
      </button>
      {cmp.flags.length > 0 && <p className={s.flag}><IconWarning size={15} className={s.flagIc} /><span>{cmp.flags.join(" · ")}. We use the {venueName(used.venue)} price.</span></p>}

      {open && (
        <div className={s.detail}>
          <div className={s.tableWrap}>
            <table className={`table ${s.table}`}>
              <thead>
                <tr><th>Market</th><th>Chance it happens</th><th>Cost per $1 of cover</th><th>For sale now</th><th>Closes</th></tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.venue} className={[r.used ? s.usedRow : "", r.role === "reference" && !r.used ? "ref" : ""].filter(Boolean).join(" ") || undefined}>
                    <td>
                      <VenueBadge venue={r.venue} role={false} />
                      <div className="xs muted" style={{ marginTop: 3 }}>
                        {r.side === "yes" ? "Yes" : "No"} on “{r.label}”{r.match === "similar" && <> · <i>similar{r.matchNote ? `: ${r.matchNote}` : ""}</i></>}
                        {r.match === "same" && r.matchNote && <> · {r.matchNote}</>}
                      </div>
                      <div className={s.tags}>
                        {r.used && <span className="badge badge-brand">What we use</span>}
                        {r.best && cmp.rows.filter((x) => x.ask != null).length > 1 && <span className="badge badge-good">Best price</span>}
                      </div>
                    </td>
                    <td className="num">{fmtChance(r.prob)}</td>
                    <td className="num">{r.role === "reference" ? <span className="muted" title="Polymarket is reference only: we can't buy there">{fmtPer1(r.ask)} <span className="xs">(can&apos;t buy)</span></span> : fmtPer1(r.ask)}</td>
                    <td className="num">{fmtDepth(r.depth)}</td>
                    <td className="xs"><When iso={r.expiry} />{r.url && <> · <a href={r.url} target="_blank" rel="noreferrer">view <IconExternal size={11} /></a></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="xs" style={{ margin: "8px 0 0", color: "var(--ink-2)" }}><b>Why {venueName(used.venue)}:</b> {cmp.why}</p>
          <p className="xs muted" style={{ margin: "4px 0 0" }}>
            <Link href={marketsHref(c.peril, location ?? c.location)}>See all markets for this risk <IconArrowRight size={12} /></Link>
          </p>
        </div>
      )}
    </div>
  );
}
