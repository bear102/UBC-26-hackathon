"use client";
// Dashboard "Tax record": premiums, payouts and refunds for this wallet, read from Solana devnet (/api/tax/record).
import { useEffect, useState } from "react";
import { explorerTx, usd } from "@/lib/client/format";
import { IconExternal } from "./Icons";
import s from "./TaxRecord.module.css";

type Row = { date: string; type: "premium" | "payout" | "refund"; amountUsd: number; policyId: number | null; marketRef: string; signature: string; policyPda: string };
type Totals = { year: number; premiumsPaid: number; payoutsReceived: number; refunds: number; net: number; count: number };
type Rec = { rows: Row[]; totals: Totals[]; years: number[]; asOfSlot: number; rpcHost: string };

const TYPE: Record<Row["type"], string> = { premium: "Premium", payout: "Payout", refund: "Refund" };
const SHOW = 6;
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"; } catch { return "America/Chicago"; } };
const market = (ref: string) => ref.replace(/^[a-z]+:/, "");

export function TaxRecord({ owner }: { owner: string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [rec, setRec] = useState<Rec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const q = `owner=${encodeURIComponent(owner)}&year=${year}&tz=${encodeURIComponent(tz())}`;

  useEffect(() => {
    let live = true;
    setRec(null); setErr(null); setAll(false);
    fetch(`/api/tax/record?${q}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j as Rec; })
      .then((j) => live && setRec(j))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [q]);

  const years = [...new Set([thisYear, ...(rec?.years ?? [])])].sort((a, b) => b - a);
  const t = rec?.totals.find((x) => x.year === year);
  const rows = rec ? [...rec.rows].reverse() : [];

  return (
    <section className={s.wrap} aria-label="Tax record">
      <div className={s.head}>
        <h2>Tax record</h2>
        <div className={s.tools}>
          {years.length > 1 ? (
            <select className={s.year} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          ) : <span className={s.yearOne}>{year}</span>}
          <a className="btn btn-sm" href={`/api/tax/record?${q}&format=csv`} download>Download CSV</a>
        </div>
      </div>

      {err ? <div className="empty">Couldn&apos;t read the chain: {err}</div>
        : !rec ? <div className="empty"><span className="spinner" /> Reading Solana devnet…</div>
        : (
          <>
            <div className={s.totals}>
              <div><span className="label">Premiums paid</span><b className="fig cost">{usd(t?.premiumsPaid ?? 0, 2)}</b></div>
              <div><span className="label">Payouts received</span><b className="fig pay">{usd(t?.payoutsReceived ?? 0, 2)}</b></div>
              {t && t.refunds > 0 && <div><span className="label">Refunds</span><b className="fig">{usd(t.refunds, 2)}</b></div>}
              <div><span className="label">Net</span><b className={`fig ${(t?.net ?? 0) >= 0 ? "pay" : "cost"}`}>{(t?.net ?? 0) >= 0 ? "+" : "−"}{usd(Math.abs(t?.net ?? 0), 2)}</b></div>
            </div>

            {rows.length === 0 ? <div className="empty">No Cover activity in {year}.</div> : (
              <div className="table-wrap">
                <table className={`table ${s.table}`}>
                  <thead><tr><th>Date</th><th>Type</th><th>Policy</th><th className={s.r}>Amount</th><th>Tx</th></tr></thead>
                  <tbody>
                    {(all ? rows : rows.slice(0, SHOW)).map((r) => (
                      <tr key={`${r.signature}:${r.policyPda}:${r.type}`}>
                        <td className="num">{r.date}</td>
                        <td>{TYPE[r.type]}</td>
                        <td className={s.pol}><span>#{r.policyId ?? "?"}</span> <i className={s.mkt}>{market(r.marketRef)}</i></td>
                        <td className={`num ${s.r} ${r.amountUsd < 0 ? "cost" : "pay"}`}>{r.amountUsd < 0 ? "−" : "+"}{usd(Math.abs(r.amountUsd), 2)}</td>
                        <td><a className="mono" href={explorerTx(r.signature)} target="_blank" rel="noreferrer">{r.signature.slice(0, 6)}<IconExternal size={11} className={s.ext} /></a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > SHOW && <button type="button" className={`btn btn-sm ${s.more}`} onClick={() => setAll((v) => !v)}>{all ? "Show less" : `Show all ${rows.length}`}</button>}
            <p className={s.note}>Read from Solana devnet · slot {rec.asOfSlot.toLocaleString()}</p>
          </>
        )}
      <p className={s.note}>Not tax advice. Premiums are often a deductible business expense and payouts taxable income; ask your accountant.</p>
    </section>
  );
}
