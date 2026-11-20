// The plan the owner first sees IS Plan B ("Balanced", the AI pick), sized exactly as the plan switcher sizes it
// (QA #4/#5/(A): the default matched no package and paid less than A and B for the same money). Lines the risk card would
// call "Probably skip" stay out of it (QA (B)), and the natural-hedge list never says "don't hedge" a weather risk the
// owner named as a loss.
import type { Coverage } from "../client/quote";
import { applyPicks, type Picks } from "../client/choices";
import type { NaturalHedge, Quote, QuoteLine, QuotePackage, Risk } from "../types";
import { ownTeamsIn } from "./horizon";

const BALANCED_BLURB = "The AI's pick for each direct risk, plus creative hedges with a strong or medium link.";

/** Same rule as the risk card's "Probably skip" verdict (lib/client/explain.ts) for the price alone. */
export function skipReason(l: QuoteLine, r?: Risk): string | null {
  const p = l.pricePerContract;
  if (p >= 0.6) return `Priced at ${Math.round(p * 100)}¢ per $1: it's likely to happen anyway, so setting cash aside works about as well.`;
  if (r?.correlation === "weak" && p > 0.3) return "Loose link to your sales and the price isn't low: left out of the plan.";
  return null;
}

const buyable = (l: QuoteLine) => l.action !== "read-only";

/** Mutates `q`: lines + totals = Plan B, packages re-built around it, uncovered reasons kept true, natural hedges cleaned. */
export function settleDefaultPlan(q: Quote, cov: Coverage, defaultPicks: Map<string, string>): void {
  const opts = q.options ?? [];
  const risk = new Map(q.risks.map((r) => [r.id, r]));
  const skipped = new Map<string, string>();
  const picks: Picks = {};
  for (const o of opts) {
    const c = o.choices.find((x) => x.contractId === defaultPicks.get(o.riskId));
    const why = c ? skipReason(c, risk.get(o.riskId)) : null;
    if (c && why) skipped.set(o.riskId, why);
    picks[o.riskId] = c && !why && buyable(c) ? c.contractId : null;
  }
  let plan = applyPicks(q, picks, cov);
  for (let i = 0; i < 3; i++) { // unfunded picks leave the plan (the package lists only funded legs)
    const zero = opts.filter((o) => picks[o.riskId] && !plan.lines.some((l) => l.riskId === o.riskId && l.contracts > 0));
    if (!zero.length) break;
    for (const o of zero) picks[o.riskId] = null;
    plan = applyPicks(q, picks, cov);
  }
  const optionIds = new Set(opts.map((o) => o.riskId));
  const hasOptions = opts.length > 0;
  if (hasOptions) {
    q.lines = plan.lines;
    q.totalPremiumUsd = plan.totalPremiumUsd;
    q.totalPayoutUsd = plan.totalPayoutUsd;
    const funded = q.lines.filter((l) => optionIds.has(l.riskId) && l.contracts > 0);
    const others = (q.packages ?? []).filter((p) => p.id !== "balanced");
    const old = (q.packages ?? []).find((p) => p.id === "balanced");
    const bal: QuotePackage = { id: "balanced", name: old?.name ?? "Balanced", blurb: BALANCED_BLURB,
      picks: funded.map((l) => ({ riskId: l.riskId, contractId: l.contractId })), totalPremiumUsd: q.totalPremiumUsd, totalPayoutUsd: q.totalPayoutUsd };
    const sig = (p: QuotePackage) => p.picks.map((x) => `${x.riskId}:${x.contractId}`).sort().join("|");
    // never offer a plan that costs about as much as the AI pick (within 3%) and pays no more
    const keep = others.filter((p) => sig(p) !== sig(bal) && !(p.totalPremiumUsd >= bal.totalPremiumUsd * 0.97 && p.totalPayoutUsd <= bal.totalPayoutUsd));
    q.packages = funded.length ? [...keep.filter((p) => p.id === "essentials"), bal, ...keep.filter((p) => p.id === "max")] : keep;
  }
  // uncovered: a funded risk is not "uncovered"; an option risk left out says why
  const inPlan = new Set(q.lines.filter((l) => l.contracts > 0 || l.action === "read-only").map((l) => l.riskId));
  q.uncovered = q.uncovered.filter((u) => !inPlan.has(u.riskId));
  for (const o of opts) {
    if (inPlan.has(o.riskId) || q.uncovered.some((u) => u.riskId === o.riskId)) continue;
    // every risk is either in the plan or says why not (QA cycle 4: two option-only risks appeared in neither list)
    const r = risk.get(o.riskId);
    const why = skipped.get(o.riskId) ?? (defaultPicks.has(o.riskId) ? "Didn't fit your monthly budget at this coverage."
      : r?.kind === "proxy" && r.correlation === "weak" ? "Loose link to your loss: shown as an option, not put in the plan." : "Shown as an option, not put in the plan.");
    q.uncovered.push({ riskId: o.riskId, reason: why });
  }
  q.naturalHedges = (q.naturalHedges ?? []).filter((n) => !contradictsLoss(saysDont(n), `${n.title} ${n.explanation}`, q.risks) && !contradictsPlan(n, q) && !citesMissingCover(n, q));
}

/**
 * A "don't hedge" / "watch" note about what the plan buys contradicts it (QA cycle 4: "insuring a Pistons miss is costly -
 * watch" next to the plan's 7c Pistons NO line; "rain hedges work against you" next to a rain line). Games: the same team.
 */
/** The note's real advice: a "watch" note whose text says "don't buy rain cover" is a don't-hedge (QA cycle 5). */
export function saysDont(n: Pick<NaturalHedge, "advice" | "explanation">): NaturalHedge["advice"] {
  return n.advice === "watch" && /\b(don'?t|do not|no need to|never)\s+(buy|hedge|add|insure)\b/i.test(n.explanation) ? "dont-hedge" : n.advice;
}

/** A note may not lean on cover the quote does not have (QA cycle 5: "the playbook rain cover already protects the downside" with
 *  no rain line), nor talk about Hedgehog's internal analysts. */
export function citesMissingCover(n: NaturalHedge, q: Pick<Quote, "lines" | "risks">): boolean {
  const text = `${n.title} ${n.explanation}`;
  if (/\b(analyst|playbook)\b/i.test(text)) return true;
  const m = text.match(/\b(rain|snow|cold|heat|fuel|diesel|gas)\s+(cover|hedge|line)\s+(already|covers|protects)/i);
  if (!m) return false;
  const p = m[1].toLowerCase() === "diesel" || m[1].toLowerCase() === "fuel" ? "gas" : m[1].toLowerCase();
  return !q.lines.some((l) => l.contracts > 0 && q.risks.find((r) => r.id === l.riskId)?.peril === p);
}

export function contradictsPlan(n: NaturalHedge, q: Pick<Quote, "lines" | "risks">): boolean {
  // games: only "watch" (a "don't hedge: wins already pay you" note is about the win side, not the loss the plan buys)
  if (n.advice === "hedge-opposite" || (n.peril === "game" && n.advice !== "watch")) return false;
  const text = `${n.title} ${n.explanation}`;
  return q.lines.some((l) => {
    if (l.contracts <= 0 || l.action === "read-only") return false;
    const r = q.risks.find((x) => x.id === l.riskId);
    // a note filed under another peril that says "don't buy rain cover" next to a rain line (QA cycle 5: a fuel idea's note)
    if (r && r.peril !== n.peril && n.peril !== "game" && saysDont(n) === "dont-hedge" && WEATHER[r.peril]?.test(n.explanation)) return true;
    if (!r || r.peril !== n.peril) return false;
    if (n.peril !== "game") return saysDont(n) === "dont-hedge"; // "watch: size rain cover to the walk-up share" fits a rain line
    const names = ownTeamsIn(`${r.title} ${r.trigger}`).flatMap((t) => [t.nick, ...t.names]);
    return names.some((w) => w.length > 3 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  });
}

const WEATHER: Record<string, RegExp> = {
  rain: /\b(rain\w*|wet|storm\w*|downpour\w*)\b/i,
  heat: /\b(heat|hot|scorch\w*|warm)\b/i,
  cold: /\b(cold|freez\w*|frost\w*|chill\w*)\b/i,
  snow: /\b(snow\w*|ice|icy)\b/i,
};

/** A "don't hedge" note that names a weather peril the owner listed as a direct loss contradicts the plan. */
export function contradictsLoss(advice: string, text: string, risks: Risk[]): boolean {
  if (advice !== "dont-hedge") return false;
  return risks.some((r) => r.kind !== "proxy" && WEATHER[r.peril]?.test(text));
}
