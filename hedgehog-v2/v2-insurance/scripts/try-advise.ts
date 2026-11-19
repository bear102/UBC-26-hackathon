// Runs advise() for each preset against the real LLM and live markets, prints the quote.
//   npx tsx scripts/try-advise.ts [presetId] [coveragePct]
// Uses lib/markets (findCandidates/sizeQuote) when it exists; otherwise a local stub built on
// live Gemini (+ Kalshi public) data with naive matching and sizing.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import "../lib/env";
import { advise, type AdvisorDeps, type SizeQuoteFn } from "../lib/ai/advisor";
import { PRESETS } from "../lib/ai/presets";
import type { MarketContract, QuoteLine } from "../lib/types";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function realDeps(): Promise<Partial<AdvisorDeps> | null> {
  if (!fs.existsSync(here("../lib/markets/index.ts")) || !fs.existsSync(here("../lib/markets/quote.ts"))) return null;
  return {}; // advisor loads lib/markets itself
}

async function stubDeps(): Promise<Partial<AdvisorDeps>> {
  const { activeEvents } = await import("../lib/markets/geminiPm");
  const { normalizeGeminiEvents } = await import("../lib/markets/normalize");
  const { listKalshiMarkets } = await import("../lib/markets/dflow");
  const [g, k] = await Promise.all([
    activeEvents().then((e) => normalizeGeminiEvents(e)).catch((e) => { console.warn("gemini load failed", e.message); return [] as MarketContract[]; }),
    listKalshiMarkets().catch((e) => { console.warn("kalshi load failed", e.message); return [] as MarketContract[]; }),
  ]);
  const all = [...g, ...k].filter((c) => c.status === "open");
  console.log(`[stub markets] ${g.length} gemini + ${k.length} kalshi contracts`);
  const horizon = Date.now() + 8 * 86_400_000;
  const findCandidates: AdvisorDeps["findCandidates"] = async (risk, profile, limit = 15) => {
    const words = `${risk.title} ${risk.trigger} ${risk.location ?? ""}`.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const peril = risk.peril === "cold" ? ["cold", "heat"] : [risk.peril];
    return all
      .filter((c) => peril.includes(c.peril) && Date.parse(c.expiry) < horizon)
      .filter((c) => risk.peril !== "game" || words.some((w) => `${c.eventTitle} ${c.label}`.toLowerCase().includes(w)))
      .filter((c) => !["heat", "cold", "rain"].includes(risk.peril) || /austin/i.test(`${c.eventTitle} ${c.location}`))
      .slice(0, limit);
  };
  const sizeQuote: SizeQuoteFn = async ({ legs, risks, contracts, coveragePct, budgetUsd }) => {
    let spent = 0; const lines: QuoteLine[] = []; const uncovered: { riskId: string; reason: string }[] = [];
    for (const l of legs) {
      const c = contracts.get(l.contractId)!; const r = risks.find((x) => x.id === l.riskId)!;
      const p = l.side === "yes" ? c.yesAsk : c.noAsk;
      if (p == null || p > 0.85) { uncovered.push({ riskId: l.riskId, reason: `ask ${p} too expensive` }); continue; }
      let n = Math.ceil((coveragePct / 100) * r.lossUsd);
      n = Math.min(n, Math.floor((budgetUsd - spent) / p));
      if (n <= 0) { uncovered.push({ riskId: l.riskId, reason: "over budget" }); continue; }
      spent += n * p;
      lines.push({ ...l, contract: c, coveragePct, contracts: n, pricePerContract: p, premiumUsd: +(n * p).toFixed(2), payoutUsd: n, impliedProb: p, action: c.tradable ? "buy-onchain" : c.venue === "gemini" ? "open-on-gemini" : "read-only" });
    }
    return { lines, uncovered, totalPremiumUsd: lines.reduce((s, l) => s + l.premiumUsd, 0), totalPayoutUsd: lines.reduce((s, l) => s + l.payoutUsd, 0) };
  };
  return { findCandidates, sizeQuote, listMarkets: async () => all };
}

const only = process.argv[2];
const coveragePct = Number(process.argv[3]) || 50;
const real = await realDeps();
const deps = real ?? (await stubDeps());
console.log(`markets: ${real ? "lib/markets (real)" : "local stub"}; coverage ${coveragePct}%\n`);

const pauseMs = Number(process.env.TRY_PAUSE_MS ?? 40_000); // free-tier Gemini is ~10 req/min; one advise() is at most 4 calls
let first = true;
for (const p of PRESETS.filter((x) => !only || x.id === only)) {
  if (!first && pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  first = false;
  const { fallbackRisks: _f, tagline: _t, ...profile } = p;
  const t = Date.now();
  const q = await advise(profile, { coveragePct, deps });
  console.log(`=== ${p.name}  (${((Date.now() - t) / 1000).toFixed(1)}s, ${q.model})`);
  for (const r of q.risks) console.log(`  ${r.id} [${r.peril}] ${r.title} | ${r.trigger} | ${r.window} | loss $${r.lossUsd} (conf ${r.confidence})\n      ${r.lossReasoning}`);
  for (const l of q.lines) console.log(`  HEDGE ${l.riskId}: ${l.side.toUpperCase()} ${l.contractId} "${l.contract.label}" x${l.contracts} @ ${l.pricePerContract} = $${l.premiumUsd} -> pays $${l.payoutUsd} [${l.action}]\n      why: ${l.rationale}\n      basis: ${l.basisRisk}`);
  for (const r of q.risks) if (r.kind === "proxy" || r.evidence) console.log(`  INSIGHT ${r.id} [${r.kind}/${r.correlation ?? "-"}] story: ${r.causalStory ?? "-"} | worth it: ${r.worthIt ?? "-"} | evidence: ${r.evidence ?? "-"}`);
  for (const l of q.lines) if (l.tier) console.log(`  TIER ${l.riskId}: ${l.tier}`);
  for (const o of q.options ?? []) console.log(`  OPTIONS ${o.riskId}: ${o.choices.map((c) => `${c.tier}: ${c.side.toUpperCase()} "${c.contract.label}" (${c.contract.eventTitle}) @${c.pricePerContract}`).join(" | ")}`);
  for (const p of q.packages ?? []) console.log(`  PACKAGE ${p.name}: $${p.totalPremiumUsd} premium -> $${p.totalPayoutUsd} payout (${p.picks.map((x) => x.riskId).join(",")})`);
  for (const n of q.naturalHedges ?? []) console.log(`  NATURAL [${n.advice}] ${n.title}: ${n.explanation}`);
  for (const u of q.uncovered) console.log(`  UNCOVERED ${u.riskId}: ${u.reason}`);
  console.log(`  TOTAL premium $${q.totalPremiumUsd} / budget $${q.budgetUsd}, payout $${q.totalPayoutUsd}\n  SUMMARY: ${q.summary}\n`);
}
