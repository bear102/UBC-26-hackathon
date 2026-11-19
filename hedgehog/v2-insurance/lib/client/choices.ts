// Client-side plan editing: swap a risk's strike/window choice, add/remove creative hedges, switch packages.
// Choices come pre-sized from the advisor (Quote.options); we re-fit them to the coverage + budget with rescaleQuote.
import type { Quote, QuoteLine, QuotePackage } from "@/lib/types";
import { rescaleQuote, type Coverage } from "./quote";

/** riskId -> chosen contractId (null = not in the plan). Only risks that have options. */
export type Picks = Record<string, string | null>;

export function currentPicks(q: Quote): Picks {
  const p: Picks = {};
  for (const o of q.options ?? []) p[o.riskId] = q.lines.find((l) => l.riskId === o.riskId)?.contractId ?? null;
  return p;
}

export function packagePicks(q: Quote, pkg: QuotePackage): Picks {
  const p: Picks = {};
  for (const o of q.options ?? []) p[o.riskId] = pkg.picks.find((x) => x.riskId === o.riskId)?.contractId ?? null;
  return p;
}

export const samePicks = (a: Picks, b: Picks) => Object.keys({ ...a, ...b }).every((k) => (a[k] ?? null) === (b[k] ?? null));

/** New quote with `picks` applied, re-sized at `cov` inside the budget. Risks without options keep their lines. */
export function applyPicks(q: Quote, picks: Picks, cov: Coverage): Quote {
  const withOptions = new Set((q.options ?? []).map((o) => o.riskId));
  const lines: QuoteLine[] = q.lines.filter((l) => !withOptions.has(l.riskId));
  for (const o of q.options ?? []) {
    const id = picks[o.riskId];
    const c = id ? o.choices.find((x) => x.contractId === id) : undefined;
    if (c) lines.push(c);
  }
  const order = new Map(q.risks.map((r, i) => [r.id, i]));
  lines.sort((a, b) => (order.get(a.riskId) ?? 99) - (order.get(b.riskId) ?? 99));
  return rescaleQuote({ ...q, lines }, cov);
}
