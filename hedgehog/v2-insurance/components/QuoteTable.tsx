import type { Quote } from "@/lib/types";
import { cents, pct, usd } from "@/lib/client/format";
import { VenueBadge } from "./markets/VenueBadge";
import s from "./QuoteTable.module.css";

/** "Schedule of cover": the quote typeset like a printed policy schedule. Plain on purpose: no ornament behind numbers. */
export function QuoteTable({ quote }: { quote: Quote }) {
  const risk = new Map(quote.risks.map((r) => [r.id, r]));
  const t = new Date(quote.createdAt);
  const quoted = isNaN(t.getTime()) ? null : t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ratio = (pay: number, prem: number) => (prem > 0 ? `${(pay / prem).toFixed(1)}×` : "—");
  return (
    <div className={s.schedule}>
      <div className={s.top}>
        <span className="caps-title">Schedule of cover</span>
        <span className={s.meta}>
          REF {quote.businessId}
          {quoted && <> · QUOTED {quoted}</>}
          {quote.model && <> · MODEL {quote.model}</>}
        </span>
      </div>
      <table className={`table ${s.sch}`}>
        <thead>
          <tr>
            <th className={s.ix} aria-label="Line" />
            <th>Risk &amp; trigger · venue</th><th className="right">Est. loss</th><th className="right">Odds</th>
            <th className="right">Pays</th><th className="right">Premium</th><th className="right" title="Payout / premium">Pays / prem.</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l, i) => {
            const r = risk.get(l.riskId);
            const ref = l.action === "read-only";
            return (
              <tr key={l.contractId} className={ref ? "ref" : undefined}>
                <td className={s.ix}>{String(i + 1).padStart(2, "0")}</td>
                <td className={s.risk}>
                  <b>{r?.title ?? l.riskId}</b>
                  <span>{l.contract.label} · {l.side.toUpperCase()}{ref ? " · reference only" : ""}</span>
                  <div className={s.ven}><VenueBadge venue={l.contract.venue} role={false} /></div>
                </td>
                <td className="right num bad" data-l="Est. loss">{usd(r?.lossUsd)}</td>
                <td className="right" data-l="Odds"><span className={s.odds}>{pct(l.impliedProb)}</span><span className="oddbar"><i style={{ width: `${Math.round(Math.max(0, Math.min(1, l.impliedProb)) * 100)}%` }} /></span></td>
                <td className={`right num pay ${s.payc}`} data-l="Pays">{usd(l.payoutUsd)}<span className={s.sub}>{l.contracts.toLocaleString()} @ {cents(l.pricePerContract)}</span></td>
                <td className={`right num cost ${s.costc}`} data-l="Premium">{usd(l.premiumUsd, 2)}</td>
                <td className="right num" data-l="Pays / prem.">{ratio(l.payoutUsd, l.premiumUsd)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={s.sp} />
            <td colSpan={3} className={s.lbl}>Total <span className="xs muted">· budget {usd(quote.budgetUsd)}/mo</span></td>
            <td className={`right num pay ${s.payc}`} data-l="Pays up to">{usd(quote.totalPayoutUsd)}</td>
            <td className={`right num cost ${s.costc}`} data-l="Premium">{usd(quote.totalPremiumUsd, 2)}</td>
            <td className="right num" data-l="Pays / prem.">{ratio(quote.totalPayoutUsd, quote.totalPremiumUsd)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
