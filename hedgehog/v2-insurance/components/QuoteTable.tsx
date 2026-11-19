import type { Quote } from "@/lib/types";
import { cents, pct, usd } from "@/lib/client/format";
import { VenueBadge } from "./markets/VenueBadge";

export function QuoteTable({ quote }: { quote: Quote }) {
  const risk = new Map(quote.risks.map((r) => [r.id, r]));
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Risk</th><th>Venue</th><th className="right">Est. loss</th><th className="right">Odds</th>
              <th className="right">Contracts</th><th className="right">Cover (payout)</th><th className="right">Premium</th><th className="right">Payout / premium</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => {
              const r = risk.get(l.riskId);
              return (
                <tr key={l.contractId} style={l.action === "read-only" ? { opacity: 0.6 } : undefined}>
                  <td><b>{r?.title ?? l.riskId}</b><div className="xs muted">{l.contract.label} · {l.side.toUpperCase()}{l.action === "read-only" ? " · context only" : ""}</div></td>
                  <td className="small"><VenueBadge venue={l.contract.venue} role={false} /></td>
                  <td className="right num bad">{usd(r?.lossUsd)}</td>
                  <td className="right num">{pct(l.impliedProb)}</td>
                  <td className="right num">{l.contracts.toLocaleString()} <span className="xs muted">@ {cents(l.pricePerContract)}</span></td>
                  <td className="right num pay">{usd(l.payoutUsd)}</td>
                  <td className="right num cost">{usd(l.premiumUsd, 2)}</td>
                  <td className="right num">{l.premiumUsd > 0 ? `${(l.payoutUsd / l.premiumUsd).toFixed(1)}×` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total <span className="xs muted" style={{ fontWeight: 400 }}>· budget {usd(quote.budgetUsd)}/mo</span></td>
              <td className="right num pay">{usd(quote.totalPayoutUsd)}</td>
              <td className="right num cost">{usd(quote.totalPremiumUsd, 2)}</td>
              <td className="right num">{quote.totalPremiumUsd > 0 ? `${(quote.totalPayoutUsd / quote.totalPremiumUsd).toFixed(1)}×` : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
