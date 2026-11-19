// Plain-English explanation layer for business owners (not traders).
// Pure + deterministic: everything is derived from Quote / QuoteLine / Risk / Position data. No LLM calls.
// Optional fields from the AI advisor (Risk.kind/correlation/causalStory/worthIt/evidence, QuoteLine.tier/crossCheck)
// are used when present and simply skipped when absent.
import type { BusinessProfile, MarketContract, Peril, Position, QuoteLine, Risk } from "@/lib/types";
import { shortDate, usd } from "./format";

// ---------- odds ----------

/** "about 1 in 4", "about a coin flip", "about 7 in 10". */
export function oddsPhrase(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "unknown odds";
  const x = Math.max(0, Math.min(1, p));
  if (x < 0.015) return "less than 1 in 50";
  if (x > 0.97) return "almost certain";
  if (x >= 0.44 && x <= 0.56) return "about a coin flip";
  if (x < 0.44) {
    const n = Math.round(1 / x);
    return `about 1 in ${n}`;
  }
  const k = Math.round(x * 10);
  return k >= 10 ? "almost certain" : `about ${k} in 10`;
}

/** History parsed from a free-text evidence line, e.g. "Austin hit >= 85°F on 3 of the last 29 days". */
export interface History { hits: number; total: number; unit: string; rate: number; text: string }

export function parseHistory(evidence?: string | null): History | null {
  if (!evidence) return null;
  const m = evidence.match(/(\d+)\s*(?:of|out of|\/)\s*(?:the\s+)?(?:last|past|previous)?\s*(\d+)\s*([a-z]+)?/i);
  if (!m) return null;
  const hits = Number(m[1]), total = Number(m[2]);
  if (!Number.isFinite(hits) || !Number.isFinite(total) || total <= 0 || hits > total) return null;
  const unit = (m[3] ?? "times").toLowerCase().replace(/s$/, "");
  return { hits, total, unit: ["day", "game", "week", "month", "weekend", "saturday", "friday", "sunday"].includes(unit) ? unit : "time", rate: hits / total, text: evidence };
}

// ---------- event phrasing ----------

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(Spurs|Lakers|Texans|Longhorns|Austin|Fed|WTI|CPI|Brent|Gemini|Kalshi|US)\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

const PERIL_EVENT: Record<Peril, string> = {
  rain: "it rains",
  heat: "a heat wave hits",
  cold: "a cold snap hits",
  game: "the game goes the wrong way",
  oil: "oil prices spike",
  gas: "gas prices climb",
  fed: "interest rates move against you",
  cpi: "inflation runs hot",
  crypto: "crypto prices swing",
  other: "it happens",
};
const PERIL_EVENT_PAST: Record<Peril, string> = {
  rain: "it rained", heat: "the heat wave hit", cold: "the cold snap hit", game: "the game went the wrong way",
  oil: "oil prices spiked", gas: "gas prices climbed", fed: "rates moved", cpi: "inflation ran hot", crypto: "crypto prices swung", other: "it happened",
};
const PERIL_NOUN: Record<Peril, string> = {
  rain: "rain", heat: "the heat", cold: "the cold snap", game: "the game result", oil: "an oil-price spike", gas: "a gas-price jump",
  fed: "a rate move", cpi: "hot inflation", crypto: "a crypto swing", other: "this event",
};

/** " on Sat Nov 21" / " through Dec 31" / "" */
export function whenPhrase(risk?: Pick<Risk, "window"> | null, contract?: Pick<MarketContract, "expiry"> | null): string {
  const w = risk?.window?.trim();
  if (w) {
    if (/^\d{4}-\d{2}-\d{2}/.test(w)) return ` on ${shortDate(w)}`;
    if (/^(next|this|through|by|before|until|in|during|over|within|each|every)\b/i.test(w)) return ` ${w.charAt(0).toLowerCase()}${w.slice(1)}`;
    const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s*\\d{4})?";
    if (new RegExp(`^((mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s*)?(${MON})?$`, "i").test(w)) return ` on ${w}`;
    return ` (${w})`;
  }
  return contract?.expiry ? ` by ${shortDate(contract.expiry)}` : "";
}

/** The bad thing, as a clause after "If …": "it rains", "Spurs lose to the Lakers". */
export function eventClause(risk?: Risk | null, contract?: MarketContract | null): string {
  const peril = (risk?.peril ?? contract?.peril ?? "other") as Peril;
  if (peril === "game") {
    const t = (risk?.trigger ?? "").split(/[,(;]/)[0].trim();
    if (t && t.length <= 60) return lowerFirst(t);
    if (contract?.label) return `${contract.label.replace(/\s+win$/i, "")} win${/s$/i.test(contract.label) ? "" : "s"}`;
  }
  if (peril === "other" && risk?.title) return lowerFirst(risk.title);
  return PERIL_EVENT[peril] ?? "it happens";
}
export const eventClausePast = (peril?: Peril | string) => PERIL_EVENT_PAST[(peril ?? "other") as Peril] ?? "it happened";
export const perilNoun = (peril?: Peril | string) => PERIL_NOUN[(peril ?? "other") as Peril] ?? "this event";

/** Best-effort peril guess for positions we have no context for (ticker text). */
export function guessPeril(text: string): Peril {
  if (/RAIN/i.test(text)) return "rain";
  if (/GAME|NBA|NFL|NCAA|MLB|NHL/i.test(text)) return "game";
  if (/WTI|BRENT|OIL/i.test(text)) return "oil";
  if (/GAS/i.test(text)) return "gas";
  if (/CPI/i.test(text)) return "cpi";
  if (/FED|FOMC/i.test(text)) return "fed";
  if (/LT\d|BELOW|COLD/i.test(text)) return "cold";
  if (/TEMP|HIGH|GT\d/i.test(text)) return "heat";
  return "other";
}

// ---------- per-line explanation ----------

export type Tone = "good" | "ok" | "warn" | "bad";
export interface Check { tone: Tone; text: string; strong?: string }
export interface Verdict { tone: "good" | "ok" | "skip" | "info"; label: string; reason: string }

export interface LineExplain {
  ifClause: string;              // "it rains"
  when: string;                  // " on Sat Nov 21"
  lossUsd: number;
  premiumUsd: number;
  payoutUsd: number;
  prob: number;                  // market's chance the hedge pays (0..1)
  odds: string;                  // "about 1 in 4"
  multiple: number | null;       // payout / premium
  coverShare: number | null;     // payout / loss
  dayShare: number | null;       // premium / normal day's revenue
  history: History | null;
  scenario: { happens: { without: number; withHedge: number }; doesnt: { without: number; withHedge: number } };
  verdict: Verdict;
  checks: Check[];
  pitfalls: string[];
  payment: string;
  sideExplain: string;           // what the owner actually holds, in plain words
  inPlan: boolean;               // false when the budget cut it to 0 or it is context-only
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function explainLine(line: QuoteLine, risk?: Risk | null, profile?: Pick<BusinessProfile, "avgDailyRevenueUsd"> | null): LineExplain {
  const c = line.contract;
  const lossUsd = Math.max(0, risk?.lossUsd ?? line.payoutUsd);
  const premiumUsd = Math.max(0, line.premiumUsd);
  const payoutUsd = Math.max(0, line.payoutUsd);
  const price = line.pricePerContract > 0 ? line.pricePerContract : (line.side === "yes" ? c.yesAsk : c.noAsk) ?? line.impliedProb;
  const prob = clamp01(Number.isFinite(line.impliedProb) && line.impliedProb > 0 ? line.impliedProb : price);
  const multiple = premiumUsd > 0 ? payoutUsd / premiumUsd : price > 0 ? 1 / price : null;
  const coverShare = lossUsd > 0 ? payoutUsd / lossUsd : null;
  const day = profile?.avgDailyRevenueUsd ?? 0;
  const dayShare = day > 0 && premiumUsd > 0 ? premiumUsd / day : null;
  const history = parseHistory(risk?.evidence);
  const readOnly = line.action === "read-only";
  const inPlan = !readOnly && line.contracts > 0;
  const ifClause = eventClause(risk, c);
  const when = whenPhrase(risk, c);

  const scenario = {
    happens: { without: -lossUsd, withHedge: -lossUsd + payoutUsd - premiumUsd },
    doesnt: { without: 0, withHedge: -premiumUsd },
  };

  // ---- "is it worth it?" checks ----
  const checks: Check[] = [];
  if (dayShare != null && !readOnly) {
    const tone: Tone = dayShare <= 0.05 ? "good" : dayShare <= 0.15 ? "ok" : "warn";
    checks.push({ tone, strong: `${fmtPct(dayShare)} of a normal day`, text: `Costs ${fmtPct(dayShare)} of a normal day's sales (${usd(day)}).` });
  }
  if (coverShare != null && inPlan) {
    const tone: Tone = coverShare >= 0.45 ? "good" : coverShare >= 0.2 ? "ok" : "warn";
    checks.push({ tone, text: coverShare >= 0.98 ? "Covers the whole estimated loss." : `Covers about ${fmtPct(Math.min(1, coverShare))} of the loss.` });
  }
  if (multiple != null && Number.isFinite(multiple)) {
    const tone: Tone = multiple >= 3 ? "good" : multiple >= 1.8 ? "ok" : "bad";
    checks.push({ tone, text: `Pays back ${multiple.toFixed(1)}× what it costs if it happens.` });
  }
  // Is the price fair? History first, then the Polymarket cross-check.
  let fair: "cheap" | "fair" | "pricey" | null = null;
  if (history && history.total >= 8) {
    const gap = history.rate - price;
    fair = gap >= 0.08 ? "cheap" : gap <= -0.12 ? "pricey" : "fair";
    checks.push({
      tone: fair === "cheap" ? "good" : fair === "fair" ? "ok" : "warn",
      text: fair === "cheap" ? `Looks cheap: it happened ${history.hits} of the last ${history.total} ${history.unit}s (${fmtPct(history.rate)}), but you pay ${fmtPct(price)}.`
        : fair === "pricey" ? `Looks pricey: it happened only ${history.hits} of the last ${history.total} ${history.unit}s (${fmtPct(history.rate)}), and you pay ${fmtPct(price)}.`
        : `Fair price: in line with recent history (${history.hits} of ${history.total} ${history.unit}s).`,
    });
  }
  const cc = line.crossCheck;
  if (cc && Number.isFinite(cc.prob)) {
    const gap = cc.prob - price;
    const ccFair = gap >= 0.04 ? "cheap" : gap <= -0.06 ? "pricey" : "fair";
    if (!fair || fair === "fair") fair = ccFair;
    checks.push({
      tone: ccFair === "pricey" ? "warn" : ccFair === "cheap" ? "good" : "ok",
      text: ccFair === "fair" ? `A second market (Polymarket) agrees: ${fmtPct(cc.prob)} chance.`
        : ccFair === "cheap" ? `A second market (Polymarket) thinks it's more likely (${fmtPct(cc.prob)}), so this price looks good.`
        : `A second market (Polymarket) says only ${fmtPct(cc.prob)}, so you may be overpaying a little.`,
    });
  }
  if (risk?.correlation) {
    checks.push({
      tone: risk.correlation === "strong" ? "good" : risk.correlation === "medium" ? "ok" : "warn",
      text: risk.correlation === "strong" ? `Tight link: when ${ifClause}, your sales really do drop.`
        : risk.correlation === "medium" ? "Decent link: it usually moves with your loss, not always."
        : "Loose link: it can pay when you're fine, or miss when you're hurt.",
    });
  }

  // ---- verdict ----
  let verdict: Verdict;
  if (readOnly) verdict = { tone: "info", label: "For context", reason: "You can't buy this one here. It shows what the market expects." };
  else if (line.contracts <= 0) verdict = { tone: "skip", label: "Not in this plan", reason: "It didn't fit your monthly budget. Raise the budget or lower the coverage to add it." };
  else if (price >= 0.6) verdict = { tone: "skip", label: "Probably skip", reason: `It's ${prob >= 0.6 ? "more likely than not" : "likely"} to happen anyway, so the hedge costs nearly as much as it pays. Setting cash aside works about as well.` };
  else if (risk?.correlation === "weak" && price > 0.3) verdict = { tone: "skip", label: "Probably skip", reason: "The link to your sales is loose and the price isn't low. Your money works harder elsewhere." };
  else if (fair === "pricey" && (multiple ?? 0) < 3) verdict = { tone: "skip", label: "Probably skip", reason: "The price looks high compared with how often this actually happens." };
  else if (price <= 0.35 && risk?.correlation !== "weak" && (coverShare ?? 0) >= 0.2 && fair !== "pricey" && (dayShare ?? 0) <= 0.15)
    verdict = { tone: "good", label: "Worth it", reason: `Cheap relative to the hit: ${money(premiumUsd)} gets you ${usd(payoutUsd)} back on a ~${usd(lossUsd)} loss.` };
  else verdict = { tone: "ok", label: "Optional", reason: (dayShare ?? 0) > 0.15 ? "Reasonable, but it's a noticeable cost. Buy it if this day would really hurt cash flow." : "A fair deal, not a bargain. Buy it if this bad day would really hurt." };

  // ---- what could go wrong ----
  const pitfalls: string[] = [];
  if (line.basisRisk) pitfalls.push(line.basisRisk);
  if (risk?.kind === "proxy") pitfalls.push("This is an indirect hedge: it tracks something linked to your costs, not your sales themselves.");
  if (risk?.correlation === "weak" && !pitfalls.some((p) => /loose/i.test(p))) pitfalls.push("The link is loose, so a payout and your actual loss may not line up.");
  if (cc && Math.abs(cc.diffPts) >= 8) pitfalls.push(`Markets disagree by ${Math.abs(cc.diffPts)} points on the odds, so the price may move before it settles.`);
  if (line.maxCoverable != null && line.contracts > 0 && line.contracts >= Math.floor(line.maxCoverable)) pitfalls.push(`Only ${usd(line.maxCoverable)} of cover was for sale at this price, so it can't grow bigger.`);
  if (inPlan) pitfalls.push(`If it doesn't happen, the ${money(premiumUsd)} is spent, just like an insurance premium.`);

  // ---- how / when you get paid ----
  const settle = c.expiry ? shortDate(c.expiry) : "the event";
  let payment: string;
  if (readOnly) payment = "Not sold here. Use it as a read on the odds.";
  else if (line.action === "open-on-gemini") payment = `You buy it in your Gemini account. If ${ifClause}, Gemini credits ${usd(payoutUsd)} there after it settles (${settle}).`;
  else payment = `If ${ifClause}, ${usd(payoutUsd)} lands in your wallet automatically after the official result is in (around ${settle}). Nothing to file, no claim forms.`;

  const sideExplain = `You hold ${line.contracts.toLocaleString()} ${line.side.toUpperCase()} tokens on “${c.label}”. Each is worth $1 if ${ifClause}${when}, and $0 if not.`;

  return { ifClause, when, lossUsd, premiumUsd, payoutUsd, prob, odds: oddsPhrase(prob), multiple, coverShare, dayShare, history, scenario, verdict, checks, pitfalls, payment, sideExplain, inPlan };
}

/** "$48", "$97.98", "$1,100": cents only when they matter. */
export function money(n: number): string {
  return usd(n, Math.abs(n) < 100 && Math.round(n * 100) % 100 !== 0 ? 2 : 0);
}

export function fmtPct(x: number): string {
  const v = x * 100;
  if (v > 0 && v < 1) return "<1%";
  return `${v < 10 && v % 1 !== 0 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)}%`;
}

/** Signed money, "−$704" / "+$120" / "$0". */
export function signedUsd(n: number): string {
  const r = Math.round(n);
  if (r === 0) return "$0";
  return `${r < 0 ? "−" : "+"}${usd(Math.abs(r))}`;
}

// ---------- plan-level summary ----------

export interface PlanExplain {
  premiumUsd: number;
  payoutUsd: number;
  dayShare: number | null;
  worst: { risk: Risk; line?: QuoteLine; ex?: LineExplain } | null;
  counts: { good: number; ok: number; skip: number };
}

export function explainPlan(lines: QuoteLine[], risks: Risk[], profile?: Pick<BusinessProfile, "avgDailyRevenueUsd"> | null): PlanExplain {
  const byRisk = new Map(risks.map((r) => [r.id, r]));
  const live = lines.filter((l) => l.action !== "read-only" && l.contracts > 0);
  const premiumUsd = live.reduce((a, l) => a + l.premiumUsd, 0);
  const payoutUsd = live.reduce((a, l) => a + l.payoutUsd, 0);
  const day = profile?.avgDailyRevenueUsd ?? 0;
  const counts = { good: 0, ok: 0, skip: 0 };
  let worst: PlanExplain["worst"] = null;
  for (const l of lines) {
    const r = byRisk.get(l.riskId);
    const ex = explainLine(l, r, profile);
    if (ex.verdict.tone === "good") counts.good++;
    else if (ex.verdict.tone === "ok") counts.ok++;
    else if (ex.verdict.tone === "skip") counts.skip++;
    if (r && ex.inPlan && (!worst || r.lossUsd > worst.risk.lossUsd)) worst = { risk: r, line: l, ex };
  }
  return { premiumUsd, payoutUsd, dayShare: day > 0 && premiumUsd > 0 ? premiumUsd / day : null, worst, counts };
}

// ---------- positions (dashboard) ----------

export interface PositionExplain {
  tone: "open" | "paid" | "pending" | "expired";
  headline: string;            // bold first sentence
  lines: string[];             // short follow-ups
  odds?: string;               // live odds phrase for open positions
  coveredShare?: number;       // payout / loss for paid ones
}

export function explainPosition(p: Position, opts: { risk?: Risk | null; contract?: Partial<MarketContract> | null; mark?: number | null } = {}): PositionExplain {
  const { risk, contract, mark } = opts;
  const peril = (risk?.peril ?? contract?.peril ?? guessPeril(`${p.contractId} ${contract?.eventTitle ?? ""}`)) as Peril;
  const payout = p.payoutUsd ?? p.contracts;
  const loss = risk?.lossUsd;
  const what = risk?.title ?? contract?.eventTitle ?? "this event";
  const cost = money(p.costUsd);
  if (p.status === "open") {
    const until = contract?.expiry ? untilPhrase(contract.expiry) : "until the result is in";
    const clause = risk ? eventClause(risk, (contract as MarketContract) ?? null) : PERIL_EVENT[peril];
    const out: PositionExplain = {
      tone: "open",
      headline: `You're covered for ${perilNoun(peril)}${risk?.window ? ` ${whenPhrase(risk).trim()}` : ""} ${until}.`,
      lines: [
        `If ${clause}, ${usd(p.contracts)} lands in your wallet automatically.`,
        `If not, the ${cost} you paid was the price of that peace of mind.`,
      ],
    };
    if (typeof mark === "number" && mark > 0 && mark < 1) out.odds = `Right now the market gives it ${fmtPct(mark)}, ${oddsPhrase(mark)}.`;
    return out;
  }
  if (p.status === "won" || p.status === "redeemed") {
    const share = loss && loss > 0 ? payout / loss : undefined;
    return {
      tone: p.status === "redeemed" ? "paid" : "pending",
      headline: p.status === "redeemed" ? `${capFirst(eventClausePast(peril))}, and you got paid ${usd(payout)}.` : `${capFirst(eventClausePast(peril))}. Your ${usd(payout)} payout is on its way.`,
      lines: [
        `You paid ${cost} for it.${share != null ? ` That softened the ~${usd(loss)} hit by about ${fmtPct(Math.min(1, share))}.` : ""}`,
        p.status === "redeemed" ? "The money is already in your wallet. Nothing to file." : "Winning tokens are redeemed for dollars automatically.",
      ],
      coveredShare: share,
    };
  }
  return {
    tone: "expired",
    headline: `${capFirst(negatePast(peril, what))}: a good day for the business.`,
    lines: [`The ${cost} premium was the cost of being covered. No payout needed.`],
  };
}

function negatePast(peril: Peril, what: string): string {
  switch (peril) {
    case "rain": return "it stayed dry";
    case "heat": return "the heat wave didn't come";
    case "cold": return "the cold snap didn't come";
    case "game": return "the game went your way";
    case "oil": case "gas": return "prices stayed calm";
    default: return `${lowerFirst(what)} didn't happen`;
  }
}

const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "until 11:59 PM Sat, Nov 21" (local time of the viewer). */
export function untilPhrase(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "until the result is in";
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `until ${t} ${shortDate(iso)}`;
}

// ---------- glossary ----------

export const GLOSSARY: Record<string, string> = {
  "market odds": "What traders, betting real money, think the chance is. A 28% price means they think it happens about 28 times in 100.",
  premium: "What you pay up front for the hedge. If the bad thing doesn't happen, that's the whole cost.",
  payout: "What you receive if the bad thing happens. It's paid automatically from the market, not by a claims adjuster.",
  "prediction market": "An exchange where people trade on yes/no questions like “Will it rain in Austin Saturday?”. Prices are the crowd's odds.",
  token: "Your receipt for the hedge, held in your wallet. It turns into $1 each if the event happens, $0 if not.",
  "basis risk": "The gap between what the market measures and what actually hurts you (e.g. rain at the airport vs. on your patio).",
  settles: "When the official result is published (weather station reading, final score, price index) and winners get paid.",
  "Hedgehog Cover": "The same protection as a simple policy: you pay Hedgehog the premium and Hedgehog pays you if the trigger hits. No tokens to hold.",
  devnet: "Solana's test network. Everything here uses test dollars, so you can try it without real money.",
  "cross-check": "We look up the same event on a second market (Polymarket). If both agree on the odds, the price is probably fair.",
};
