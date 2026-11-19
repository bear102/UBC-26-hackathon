// "Heads-up" banner lines (pure; client + tests): 1-3 short lines from the forecast signals, each linked to the quote
// line that covers it when one exists. "Rain likely Sat (70%), your busy day. Weekend rain cover: 24¢ per $1."
import type { ForecastSignal, ForecastSummary } from "@/lib/ai/forecast";
import type { Quote, QuoteLine } from "@/lib/types";

export interface HeadsUpItem { key: string; text: string; tone: "warn" | "calm" | "info"; line?: QuoteLine; cover?: string }

const WEATHER = new Set(["rain", "heat", "cold", "snow", "storm"]);
const cents = (n: number) => `${Math.round(n * 100)}¢`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Does this plan care about the weather at all? (a mortgage broker's plan gets no weather banner) */
export const weatherPlan = (q: Quote | null | undefined) => !!q && (q.risks.some((r) => WEATHER.has(r.peril)) || q.lines.some((l) => WEATHER.has(l.contract.peril)));

function allLines(q: Quote | null | undefined): QuoteLine[] {
  if (!q) return [];
  const seen = new Set<string>(); const out: QuoteLine[] = [];
  for (const l of [...q.lines, ...(q.options ?? []).flatMap((o) => o.choices)]) { if (!seen.has(l.contractId)) { seen.add(l.contractId); out.push(l); } }
  return out;
}

/** Cover name for a line: "Weekend rain cover", "Sat rain cover", "Fri heat cover". */
export function coverName(l: QuoteLine): string {
  const what = l.contract.peril === "rain" ? "rain" : l.contract.peril === "heat" ? "heat" : l.contract.peril === "cold" ? "cold" : "weather";
  if (/weekend/i.test(l.contract.eventTitle)) return `Weekend ${what} cover`;
  const d = l.forecast?.date;
  const dow = d ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${d}T12:00:00Z`).getUTCDay()] : "";
  return `${dow ? `${dow} ` : ""}${what} cover`.replace(/^./, (c) => c.toUpperCase());
}

/** The quote line that pays on this signal: same peril, a forecast date on (or a weekend market spanning) its day. */
export function lineFor(sig: ForecastSignal, q: Quote | null | undefined): QuoteLine | undefined {
  if (!sig.date) return undefined;
  const peril = sig.peril === "snow" ? "cold" : sig.peril;
  const fits = (l: QuoteLine) => l.contract.peril === peril && !!l.forecast && (l.forecast.date === sig.date || (/weekend/i.test(l.contract.eventTitle) && dayDiff(l.forecast.date, sig.date!) === 1));
  const lines = allLines(q).filter(fits);
  // the side that pays when the bad weather comes (rain: YES; heat: YES on an "or above"; cold: YES on "or below")
  return lines.find((l) => q?.lines.includes(l)) ?? lines[0];
}

/** 1-3 banner lines. `weatherOnly` hides the calm line for plans with no weather exposure. */
export function headsUpItems(s: ForecastSummary | null | undefined, q?: Quote | null, opts: { max?: number } = {}): HeadsUpItem[] {
  if (!s?.days.length) return [];
  const max = opts.max ?? 3;
  const out: HeadsUpItem[] = [];
  const used = new Set<string>();
  for (const sig of s.signals.slice(0, 2)) {
    const l = lineFor(sig, q);
    const busy = sig.busy ? ", your busy day" : "";
    const cover = l ? `${coverName(l)}: ${cents(l.pricePerContract)} per $1.` : undefined;
    if (l) used.add(l.contractId);
    out.push({ key: `${sig.kind}:${sig.date ?? sig.alert}`, text: `${sig.text}${busy}.`, tone: "warn", line: l, cover });
  }
  if (!out.length) {
    const highs = s.days.map((d) => d.high).filter((x): x is number => x != null);
    const pops = s.days.map((d) => d.pop).filter((x): x is number => x != null);
    const maxPop = pops.length ? Math.max(...pops) : null;
    out.push({ key: "calm", tone: "calm",
      text: `${maxPop != null && maxPop < 30 ? "Dry" : "Quiet"} week ahead${highs.length ? `: highs ${Math.min(...highs)}–${Math.max(...highs)}°F` : ""}${maxPop != null ? `, rain chance ${maxPop < 30 ? "under " : "up to "}${Math.max(10, Math.ceil(maxPop / 10) * 10)}%` : ""}.` });
  }
  // a forecast that disagrees with a market's price (only lines with a note: >= 15 pts apart)
  const odd = allLines(q).find((l) => l.forecast?.note && !used.has(l.contractId) && (q?.lines.includes(l) ?? false))
    ?? allLines(q).find((l) => l.forecast?.note && !used.has(l.contractId));
  if (odd && out.length < max) out.push({ key: `fx:${odd.contractId}`, tone: "info", text: `${coverName(odd)}: ${odd.forecast!.note}.`, line: odd, cover: `${cents(odd.pricePerContract)} per $1.` });
  return out.slice(0, max);
}
