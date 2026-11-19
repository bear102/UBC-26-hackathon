// Creative hedging (market-first brainstorm, proxy exposures, natural hedges, strike ladders, packages).
// Pure helpers + prompts; advisor.ts wires them into advise(). Server and test safe (no network here).
import { z } from "zod/v4";
import type { BusinessProfile, HedgeLeg, MarketContract, NaturalHedge, Peril, Quote, QuoteLine, QuotePackage, Risk } from "../types";
import { rescaleQuote, type Coverage } from "../client/quote";

const PERILS = ["heat", "cold", "rain", "game", "oil", "gas", "fed", "cpi", "crypto", "other"] as const satisfies readonly Peril[];
const TZ = "America/Chicago";
const WEATHER: Peril[] = ["heat", "cold", "rain"];
const TX_CITIES = ["austin", "dallas", "houston", "san antonio"];

// ---------- market catalog (compact view of the whole live universe) ----------

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
/** "Oil (WTI) price on November 19?" -> "Oil (WTI) price on <date>?" (groups daily/monthly events of one series). */
export function seriesName(title: string): string {
  return title
    .replace(new RegExp(`\\b(${MONTHS})\\.?\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s+\\d{4})?`, "gi"), "<date>")
    .replace(new RegExp(`\\b(in|for)\\s+(${MONTHS})\\.?(\\s+\\d{4})?`, "gi"), "$1 <month>")
    .replace(/\s+/g, " ").trim();
}

export interface CatalogEntry {
  key: string;            // "M3" (what the LLM references)
  peril: Peril;
  series: string;         // "Oil (Brent) price on <date>?"
  hint: string;           // distinctive event-title text used to filter candidates ("Oil (Brent) price")
  location?: string;      // weather: city list is inside `series`
  ids: string[];          // contract ids in this group
  line: string;           // rendered catalog line
}

function shortDay(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
}
const numIn = (s: string) => { const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const hintOf = (series: string) => series.split("<")[0].replace(/\b(on|in|for)\s*$/i, "").replace(/[?:]+$/, "").trim() || series;

/**
 * Groups open, priced contracts into ~20-40 one-line "series" entries across every peril. Weather is one line per
 * peril with Texas cities named first; games only for teams the owner mentions or Texas teams (+ a count of the rest).
 */
export function buildCatalog(markets: MarketContract[], profile: BusinessProfile, teamWords: string[] = []): CatalogEntry[] {
  const now = Date.now();
  const live = markets.filter((m) => m.status === "open" && (m.yesAsk !== null || m.noAsk !== null) && !(Date.parse(m.expiry) <= now));
  const groups = new Map<string, { peril: Peril; series: string; cs: MarketContract[] }>();
  const city = profile.city.split(",")[0].trim().toLowerCase();
  const tw = teamWords.map((w) => w.toLowerCase());
  let otherGames = 0;
  for (const m of live) {
    if (/today at \d/i.test(m.eventTitle)) continue; // intraday crypto ticks: not insurance
    let series = seriesName(m.eventTitle);
    if (WEATHER.includes(m.peril) && m.location) series = series.replace(m.location, "<city>");
    if (m.peril === "game") {
      const t = `${m.eventTitle} ${m.label}`.toLowerCase();
      if (!tw.some((w) => t.includes(w)) && !/\btexas\b|san antonio|houston|dallas|austin/.test(t)) { otherGames++; continue; }
      series = m.eventTitle;
    }
    const key = `${m.peril}|${series}`;
    const g = groups.get(key) ?? { peril: m.peril, series, cs: [] };
    g.cs.push(m); groups.set(key, g);
  }
  const out: CatalogEntry[] = [];
  const sorted = [...groups.values()].sort((a, b) => PERILS.indexOf(a.peril as any) - PERILS.indexOf(b.peril as any) || a.series.localeCompare(b.series));
  for (const g of sorted) {
    const venues = [...new Set(g.cs.map((c) => c.venue))].join("+");
    const dates = [...new Set(g.cs.map((c) => shortDay(c.expiry)))].slice(0, 5);
    let detail: string;
    if (WEATHER.includes(g.peril)) {
      const cities = [...new Set(g.cs.map((c) => c.location).filter((x): x is string => !!x))];
      const rank = (c: string) => (c.toLowerCase() === city ? 0 : TX_CITIES.includes(c.toLowerCase()) ? 1 : 2);
      cities.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      const here = g.cs.filter((c) => (c.location ?? "").toLowerCase() === city).slice(0, 4).map((c) => `"${c.label}"`).join(", ");
      detail = `cities: ${cities.slice(0, 14).join(", ")}${cities.length > 14 ? ` +${cities.length - 14} more` : ""}${here ? ` | ${profile.city.split(",")[0]} labels e.g. ${here}` : ""}`;
    } else {
      const nums = g.cs.map((c) => numIn(c.label)).filter((n): n is number => n !== null);
      const priced = g.cs.filter((c) => c.yesAsk !== null && c.yesAsk >= 0.05 && c.yesAsk <= 0.9).sort((a, b) => Math.abs((a.yesAsk ?? 0) - 0.4) - Math.abs((b.yesAsk ?? 0) - 0.4));
      const ex = (priced.length ? priced : g.cs).slice(0, 3).map((c) => `"${c.label}" YES ${c.yesAsk?.toFixed(2) ?? "-"}`).join(", ");
      detail = `${nums.length >= 3 && g.peril !== "game" ? `strikes ${Math.min(...nums)}..${Math.max(...nums)} | ` : ""}e.g. ${ex}`;
    }
    const key = `M${out.length + 1}`;
    out.push({ key, peril: g.peril, series: g.series, hint: g.peril === "game" ? g.series : hintOf(g.series), ids: g.cs.map((c) => c.id),
      line: `${key} | ${g.peril} | ${g.series} | ${venues} | closes ${dates.join(", ")} | ${detail}` });
  }
  if (otherGames) out.push({ key: `M${out.length + 1}`, peril: "game", series: "other games", hint: "", ids: [], line: `M${out.length + 1} | game | ${otherGames} other games (NBA/NFL/NHL/college) not shown | ask about a specific team if it matters` });
  return out.slice(0, 45);
}

// ---------- brainstorm (LLM) ----------

export const brainstormSchema = z.object({
  ideas: z.array(z.object({
    catalogKey: z.string().describe("the M-key of the catalog line this hedge uses, e.g. 'M4'"),
    peril: z.enum(PERILS),
    title: z.string().min(3).describe("short, owner-friendly, e.g. 'Diesel spike via Brent crude'"),
    trigger: z.string().min(3).describe("the market condition that pays, plain English with a threshold, e.g. 'Brent closes >= $93 on Nov 30'"),
    location: z.string().describe("where measured: a city for weather, team city for games, else 'US'"),
    window: z.string().describe("date or range, e.g. 'Nov 30' or 'next 7 days'"),
    lossUsd: z.number().positive().describe("USD the business loses (or extra cost) when the trigger hits"),
    lossReasoning: z.string().min(10).describe("one-line arithmetic from the revenue/cost numbers"),
    causalStory: z.string().min(10).describe("the economic chain from the market to this business's P&L, 1-2 sentences"),
    correlation: z.enum(["strong", "medium", "weak"]),
    worthIt: z.string().min(5).describe("one honest sentence on whether this is worth the premium"),
    confidence: z.number().min(0).max(1),
  })).max(6),
  naturalHedges: z.array(z.object({
    peril: z.enum(PERILS),
    title: z.string().min(3),
    explanation: z.string().min(10),
    advice: z.enum(["dont-hedge", "hedge-opposite", "watch"]),
  })).max(3),
});
export type BrainstormOut = z.infer<typeof brainstormSchema>;

export const BRAINSTORM_SYSTEM = `You are Hedgehog's creative hedging strategist (second-order exposures) for small businesses in Austin, TX.
The owner's OBVIOUS risks (weather at their own site, their own named teams) are handled by another analyst. Your job: scan the LIVE MARKET CATALOG and find markets with a real but non-obvious economic link to this business that the owner would not think of. Think about:
- costs: fuel (WTI/Brent crude, US gas), natural gas (kitchen burners, propane, electricity), metals (silver/gold/copper for jewelers, contractors, electricians), food inflation (CPI);
- financing: variable-rate loans or credit lines (Fed decisions, funds rate);
- demand drivers: customers' disposable income (gas prices, CPI), crypto wealth for crypto-paid merchants (BTC/SOL), weather in feeder cities for tourism, cold snaps for outdoor trade, rival/neighbor team games (college football Saturdays, Texas teams) that pull crowds away or bring them in.
Rules:
- Return 2 to 4 ideas, strongest correlation first. Each MUST use one catalogKey from the catalog (copy it exactly), at most one idea per catalogKey, and describe a trigger that a contract in that line can settle (use the strikes/dates shown; prefer contracts priced 5-60 cents).
- Start from what the owner actually told you: every cost, input, loan or customer group they mention is a lead (fuel -> Brent/WTI/gas, kitchen or heating -> natural gas, metal -> silver/gold/copper, a credit line -> Fed, menu prices -> CPI). Cost-side proxies with a clear mechanism beat demand stories.
- Sports only when the business's own crowd or orders swing with that game (bars, venues, game-day retail), never as a generic "distraction". Never a game nobody in Austin cares about.
- Quantify lossUsd with arithmetic from the owner's numbers (keep it modest; a proxy rarely costs more than one day of revenue). Be honest: correlation "weak" if the link is loose.
- causalStory: the chain from market to P&L ("Brent leads diesel by ~2 weeks; 4 vans x 3,000 mi/week ...").
- worthIt: is it worth the premium? (e.g. "Cheap tail cover; only worth it if fuel is >5% of costs").
- naturalHedges (0-3): things that HELP this business, which the owner should NOT hedge (or should hedge the opposite tail), e.g. a hot-soup truck benefits from cold, a delivery caterer gets more orders when it rains. advice: dont-hedge | hedge-opposite | watch.
- Never invent markets. No venue names in titles.`;

export function brainstormPrompt(profileBlock: string, today: string, catalog: CatalogEntry[], seeds: Idea[] = []): string {
  return [
    profileBlock,
    seeds.length ? `\nINDUSTRY PLAYBOOK (researched hedges for businesses like this; already included, so propose DIFFERENT ideas):\n${seeds.slice(0, 6).map((x) => `- ${x.risk.title} (${x.risk.peril}, ${x.risk.correlation ?? "medium"}): ${x.risk.causalStory ?? ""}`).join("\n")}` : "",
    `\nToday is ${today}.`,
    catalog.length ? `\nLIVE MARKET CATALOG (key | peril | series | venue | closes | details):\n${catalog.map((c) => c.line).join("\n")}` : "\nLIVE MARKET CATALOG: unavailable; use perils oil, gas, other (commodities), fed, cpi, crypto, game, heat, cold, rain and set catalogKey to \"\".",
    `\nReturn {"ideas":[...],"naturalHedges":[...]}.`,
  ].join("\n");
}

/** Proxy risk + where its markets live (catalog hint / ids, or a fixed candidate list from the playbook). */
export interface Idea { risk: Risk; hint?: string; ids?: string[]; labelRe?: RegExp; fixed?: MarketContract[] }

/** Loose shape of lib/ai/playbook playbookIdeas() output (owned by the playbook module). */
export interface PlaybookSeed {
  idea: {
    industry?: string; problem?: string; title?: string; trigger?: string; causalStory?: string; peril: Peril;
    correlation?: "strong" | "medium" | "weak"; basisRisk?: string; naturalHedgeNote?: string; evidence?: string;
    marketQuery?: string; side?: "yes" | "no"; lossUsd?: number; lossReasoning?: string; worthIt?: string; location?: string; window?: string;
  };
  candidates: MarketContract[];
}

/** Playbook seeds -> proxy ideas whose candidates are exactly the seed's real contracts. */
export function ideasFromPlaybook(seeds: PlaybookSeed[], profile: BusinessProfile): { ideas: Idea[]; naturalHedges: NaturalHedge[] } {
  const ideas: Idea[] = []; const naturalHedges: NaturalHedge[] = [];
  for (const { idea: x, candidates } of seeds ?? []) {
    if (!x || !PERILS.includes(x.peril)) continue;
    if (x.naturalHedgeNote) naturalHedges.push({ peril: x.peril, title: x.title ?? x.problem ?? "Natural hedge", explanation: x.naturalHedgeNote, advice: "watch" });
    const cands = (candidates ?? []).filter((c) => c && c.status === "open");
    if (!cands.length) continue;
    const loss = x.lossUsd && x.lossUsd > 0 ? x.lossUsd : profile.avgDailyRevenueUsd * 0.1;
    ideas.push({
      fixed: cands, ids: cands.map((c) => c.id),
      risk: {
        id: "", kind: "proxy", peril: x.peril, title: (x.title ?? x.problem ?? x.marketQuery ?? "Industry hedge").slice(0, 90),
        trigger: x.trigger ?? x.marketQuery ?? cands[0].eventTitle, location: x.location ?? "US", window: x.window ?? "next 30 days",
        lossUsd: Math.max(10, Math.round(Math.min(loss, profile.avgDailyRevenueUsd * 3) / 10) * 10),
        lossReasoning: x.lossReasoning ?? `Industry playbook estimate (~10% of a ${usd(profile.avgDailyRevenueUsd)} day).`,
        confidence: 0.5, correlation: x.correlation ?? "medium", causalStory: x.causalStory ?? x.problem,
        worthIt: x.worthIt ?? x.basisRisk, evidence: x.evidence,
      },
    });
  }
  return { ideas, naturalHedges };
}

export function ideasFromBrainstorm(out: BrainstormOut, catalog: CatalogEntry[], profile: BusinessProfile): Idea[] {
  const byKey = new Map(catalog.map((c) => [c.key.toUpperCase(), c]));
  const cap = Math.max(50, profile.avgDailyRevenueUsd * 3);
  const ideas: Idea[] = [];
  for (const r of out.ideas) {
    const entry = byKey.get(r.catalogKey.trim().toUpperCase());
    if (catalog.length && (!entry || !entry.ids.length)) { console.warn(`[advise] brainstorm idea "${r.title}" dropped: unknown catalog key ${r.catalogKey}`); continue; } // anti-hallucination
    ideas.push({
      hint: entry?.hint || undefined, ids: entry?.ids,
      risk: {
        id: "", kind: "proxy", peril: entry?.peril ?? r.peril, title: r.title.trim(), trigger: r.trigger.trim(),
        location: r.location.trim() || undefined, window: r.window.trim() || undefined,
        lossUsd: Math.max(10, Math.round(Math.min(r.lossUsd, cap) / 10) * 10), lossReasoning: r.lossReasoning.trim(),
        confidence: Math.round(Math.min(1, Math.max(0, r.confidence)) * 100) / 100,
        correlation: r.correlation, causalStory: r.causalStory.trim(), worthIt: r.worthIt.trim(),
      },
    });
  }
  return ideas;
}

// ---------- deterministic fallbacks ----------

type FallbackIdea = Omit<Risk, "id"> & { hint: string; labelRe?: RegExp };
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const PRESET_IDEAS: Record<string, { ideas: FallbackIdea[]; natural: NaturalHedge[] }> = {
  "rainey-patio-bar": {
    ideas: [
      { kind: "proxy", peril: "cold", title: "Cold front empties the patio", trigger: "Austin daily high at or below the low end of this week's range", location: "Austin", window: "next 7 days",
        lossUsd: 900, lossReasoning: "80% outdoor seats; a 50s-high night cuts a ~$6,000 weekend night ~15% (~$900).", confidence: 0.45, hint: "Highest temperature in Austin",
        correlation: "medium", causalStory: "Late-November fronts drop Austin highs 20°F overnight; heaters only save part of an outdoor bar's crowd.", worthIt: "Cheap when the market thinks a front is unlikely; skip it if heaters are already booked." },
      { kind: "proxy", peril: "game", title: "Texas A&M beats TCU (rival game pulls the crowd)", trigger: "Texas A&M wins Saturday's game vs TCU", location: "Texas", window: "this weekend",
        lossUsd: 400, lossReasoning: "Big Saturday college games keep fans at watch parties elsewhere; ~6% of a $6,500 Saturday (~$400).", confidence: 0.3, hint: "Texas A&M",
        correlation: "weak", causalStory: "Rainey St crowds thin when big Texas college games run long or celebrations move to campus bars.", worthIt: "Coin-flip price, weak link: only for owners who see Saturday game-day swings." },
      { kind: "proxy", peril: "gas", title: "Pump prices squeeze bar tabs", trigger: "US average gas price above this week's top strike", location: "US", window: "this week",
        lossUsd: 300, lossReasoning: "A $0.25/gal jump trims discretionary spend ~1-2% across ~$29k/week (~$300/week).", confidence: 0.25, hint: "gas price",
        correlation: "weak", causalStory: "Higher pump prices come out of the same wallet as bar tabs, especially for suburban customers who drive in.", worthIt: "Macro, weak link: a small tail position at most." },
    ],
    natural: [
      { peril: "game", title: "Spurs wins already pay you", explanation: "A win keeps the crowd for post-game rounds, so you only hedge losses; never buy the Spurs-win side.", advice: "dont-hedge" },
      { peril: "heat", title: "Warm November evenings help", explanation: "A mild 75°F evening fills a patio; only extreme afternoon heat hurts, so hedge just the hot tail, not 'above normal'.", advice: "hedge-opposite" },
    ],
  },
  "east-austin-food-truck": {
    ideas: [
      { kind: "proxy", peril: "other", title: "Propane/natural gas cost spike", trigger: "Natural gas closes above the top of this week's range", location: "US", window: "Nov 30",
        lossUsd: 120, lossReasoning: "Griddles + consomé pots burn ~$600/month of propane; a 20% spike adds ~$120/month.", confidence: 0.4, hint: "Natural Gas price",
        correlation: "medium", causalStory: "Propane and natural gas move together through winter heating demand; the truck's burners run all day.", worthIt: "Small, cheap tail cover; worth it only if propane is a top-3 cost." },
      { kind: "proxy", peril: "gas", title: "Gas prices cut the lunch crowd's spending", trigger: "US average gas price above this week's top strike", location: "US", window: "this week",
        lossUsd: 150, lossReasoning: "A $0.25/gal rise trims ~2% of ~$9.8k/week walk-up sales (~$200), plus commissary trips.", confidence: 0.3, hint: "gas price",
        correlation: "weak", causalStory: "Lunch-truck customers are price sensitive; pump prices come out of the same budget, and the truck's generator and commissary runs cost more.", worthIt: "Weak link; a small position only." },
      { kind: "proxy", peril: "oil", title: "Crude spike lifts beef and delivery costs", trigger: "WTI crude above this week's range", location: "US", window: "next 7 days",
        lossUsd: 100, lossReasoning: "Beef (~35% of $40k/month food cost) carries freight surcharges; a crude spike adds ~1% (~$100).", confidence: 0.25, hint: "Oil (WTI)",
        correlation: "weak", causalStory: "Diesel surcharges from meat distributors follow crude within weeks.", worthIt: "Mostly a demo of proxy hedging; keep it tiny." },
    ],
    natural: [
      { peril: "cold", title: "Cool, dry days sell birria", explanation: "Consomé is a cold-weather dish: mild cold usually helps you. Only a freezing, windy snap hurts, so don't hedge 'below normal'.", advice: "hedge-opposite" },
      { peril: "rain", title: "Delivery apps soften rain", explanation: "If you're on delivery apps, part of the rainy-day loss comes back as orders; size rain cover to the walk-up share only.", advice: "watch" },
    ],
  },
  "austin-catering-delivery": {
    ideas: [
      { kind: "proxy", peril: "oil", title: "Diesel spike via Brent crude", trigger: "Brent crude at or above the month-end strike near today's price", location: "US", window: "Nov 30",
        lossUsd: 260, lossReasoning: "~1,300 gal/month; a $5/bbl Brent jump adds ~$0.15-0.20/gal diesel: ~$200-260/month.", confidence: 0.5, hint: "Oil (Brent)",
        correlation: "strong", causalStory: "US diesel and jet fuel price off Brent more than WTI; the vans' fuel bill moves with it inside 2 weeks.", worthIt: "Strong link and a fixed-price book: the best proxy hedge for this business." },
      { kind: "proxy", peril: "other", title: "Natural gas lifts kitchen energy bills", trigger: "Natural gas closes above this month's upper strike", location: "US", window: "Nov 30",
        lossUsd: 150, lossReasoning: "Commercial ranges/ovens ~$1,000/month of gas; a 15% spike adds ~$150.", confidence: 0.4, hint: "Natural Gas price",
        correlation: "medium", causalStory: "Commercial kitchen gas tariffs reset with Henry Hub prices, with a 1-2 month lag.", worthIt: "Worth a small tail position going into winter." },
      { kind: "proxy", peril: "fed", title: "Fed hikes and the credit line costs more", trigger: "The Fed hikes 25bps at the next meeting", location: "US", window: "next FOMC meeting",
        lossUsd: 60, lossReasoning: "$150k variable line: +0.25% is ~$31/month, ~$60 over two months.", confidence: 0.35, hint: "Fed decision", labelRe: /hike 25/i,
        correlation: "strong", causalStory: "The line of credit floats over prime, which moves 1:1 with the Fed's target rate.", worthIt: "Direct link but small dollars; only if the line is drawn." },
    ],
    natural: [
      { peril: "rain", title: "Rainy days boost delivered lunches", explanation: "Offices order in when it rains, so rain is a mild natural hedge for a delivery caterer. Don't buy rain cover.", advice: "dont-hedge" },
    ],
  },
};

const KEYWORD_IDEAS: { re: RegExp; idea: (p: BusinessProfile) => FallbackIdea }[] = [
  { re: /deliver|van|truck|drive|fleet|mile|uber|courier/i, idea: (p) => ({ kind: "proxy", peril: "gas", title: "Fuel price spike", trigger: "US average gas price above this week's top strike", location: "US", window: "this week",
      lossUsd: Math.max(20, Math.round(p.avgDailyRevenueUsd * 0.05 / 10) * 10), lossReasoning: `Assumes fuel is ~5% of a ${usd(p.avgDailyRevenueUsd)} day's costs that can't be passed on.`, confidence: 0.4, hint: "gas price",
      correlation: "strong", causalStory: "Every delivery mile costs more when pump prices rise; prices to customers lag by weeks.", worthIt: "Worth it if fuel is a top cost." }) },
  { re: /crypto|bitcoin|btc|solana|\bsol\b|web3/i, idea: (p) => ({ kind: "proxy", peril: "crypto", title: "Crypto drawdown cuts crypto-paid sales", trigger: "BTC below this month's lower strikes on Nov 30", location: "US", window: "Nov 30",
      lossUsd: Math.max(20, Math.round(p.avgDailyRevenueUsd * 0.2 / 10) * 10), lossReasoning: "Assumes ~20% of a day's sales come from crypto-rich customers who pull back after a drop.", confidence: 0.3, hint: "BTC price",
      correlation: "medium", causalStory: "Crypto-paying customers spend from crypto wealth; a drawdown hits both demand and coins held as revenue.", worthIt: "Only if a real share of revenue is paid or held in crypto." }) },
  { re: /jewel|silver|gold|metal|electric|wire|plumb|contractor/i, idea: (p) => ({ kind: "proxy", peril: "other", title: "Metal input costs spike", trigger: "Silver closes above this month's upper strike", location: "US", window: "Nov 30",
      lossUsd: Math.max(20, Math.round(p.avgDailyRevenueUsd * 0.1 / 10) * 10), lossReasoning: "Assumes metal is ~10% of a day's cost base.", confidence: 0.35, hint: /silver/i.test(p.description) ? "Silver price" : /gold|jewel/i.test(p.description) ? "Gold price" : "Copper price",
      correlation: "strong", causalStory: "Raw metal is priced off the same futures the market settles on.", worthIt: "Worth it when quotes to customers are fixed before you buy metal." }) },
  { re: /loan|credit|debt|mortgage|financ|lease/i, idea: () => ({ kind: "proxy", peril: "fed", title: "Rate hike on a variable loan", trigger: "The Fed hikes 25bps at the next meeting", location: "US", window: "next FOMC meeting",
      lossUsd: 50, lossReasoning: "A 0.25% move on a ~$100k variable balance is ~$21/month.", confidence: 0.35, hint: "Fed decision", labelRe: /hike 25/i,
      correlation: "strong", causalStory: "Variable loans reprice off prime, which moves with the Fed.", worthIt: "Small dollars; worth it on large balances." }) },
  { re: /patio|outdoor|park|trail|tour|boat|lake|garden|nursery|yoga|market/i, idea: (p) => ({ kind: "proxy", peril: "cold", title: "Cold front keeps customers home", trigger: "Austin daily high at or below the low end of this week's range", location: "Austin", window: "next 7 days",
      lossUsd: Math.max(20, Math.round(p.avgDailyRevenueUsd * 0.15 / 10) * 10), lossReasoning: `Assumes a cold day cuts ~15% of a ${usd(p.avgDailyRevenueUsd)} day.`, confidence: 0.35, hint: "Highest temperature in Austin",
      correlation: "medium", causalStory: "November fronts drop Austin highs fast; outdoor trade falls with the temperature.", worthIt: "Cheap tail cover when no front is forecast." }) },
];

const GENERIC_IDEA = (p: BusinessProfile): FallbackIdea => ({ kind: "proxy", peril: "gas", title: "Gas prices squeeze customer spending", trigger: "US average gas price above this week's top strike", location: "US", window: "this week",
  lossUsd: Math.max(20, Math.round(p.avgDailyRevenueUsd * 0.03 / 10) * 10), lossReasoning: `Assumes a pump-price jump trims ~3% of a ${usd(p.avgDailyRevenueUsd)} day of discretionary spend.`, confidence: 0.2, hint: "gas price",
  correlation: "weak", causalStory: "Pump prices come out of the same household budget as small discretionary purchases.", worthIt: "Weak link; a tiny tail position at most." });

/** Hand-written creative ideas + natural hedges, used when the brainstorm LLM fails or returns too few. */
export function fallbackIdeas(profile: BusinessProfile): { ideas: Idea[]; naturalHedges: NaturalHedge[] } {
  const preset = PRESET_IDEAS[profile.presetId ?? ""] ?? PRESET_IDEAS[profile.id];
  let raw: FallbackIdea[];
  let natural: NaturalHedge[] = [];
  if (preset) { raw = preset.ideas; natural = preset.natural; } else {
    raw = KEYWORD_IDEAS.filter((k) => k.re.test(profile.description)).map((k) => k.idea(profile)).slice(0, 3);
    if (raw.length < 2) raw.push(GENERIC_IDEA(profile));
  }
  return {
    ideas: raw.map(({ hint, labelRe, ...r }) => ({ hint, labelRe, risk: { ...r, id: "" } })),
    naturalHedges: natural.map((n) => ({ ...n })),
  };
}

/** Same exposure twice? (same peril + place, same teams/series). */
export function sameExposure(a: Risk, b: Risk, teamWords: (t: string) => string[]): boolean {
  if (a.peril !== b.peril) return false;
  const loc = (r: Risk) => (r.location ?? "").split(",")[0].trim().toLowerCase();
  if (a.peril === "game") {
    const ta = teamWords(`${a.title} ${a.trigger}`), tb = teamWords(`${b.title} ${b.trigger}`);
    return ta.length > 0 && ta.some((t) => tb.includes(t));
  }
  if (WEATHER.includes(a.peril)) return loc(a) === loc(b);
  if (a.peril === "other" || a.peril === "crypto" || a.peril === "oil") {
    const w = (r: Risk): string[] => [...(`${r.title} ${r.trigger}`.toLowerCase().match(/copper|silver|gold|natural gas|btc|bitcoin|eth|sol\b|xrp|wti|brent/g) ?? [])];
    const wa = w(a), wb = w(b);
    return wa.length > 0 && wa.some((x) => wb.includes(x));
  }
  return true; // oil, gas, fed, cpi: one of each is enough
}

/** Candidates for a proxy idea: filtered to its catalog series (hint) when we know it. */
export function filterIdeaCandidates(idea: Idea, cands: MarketContract[], universe: MarketContract[]): MarketContract[] {
  const now = Date.now();
  const ok = (c: MarketContract) => c.status === "open" && !(Date.parse(c.expiry) <= now) && (c.yesAsk !== null || c.noAsk !== null);
  const h = idea.hint?.toLowerCase();
  const city = WEATHER.includes(idea.risk.peril) ? (idea.risk.location ?? "").split(",")[0].trim().toLowerCase() : "";
  const match = (c: MarketContract) => (!h || c.eventTitle.toLowerCase().includes(h)) && (!idea.labelRe || idea.labelRe.test(c.label))
    && (!city || (c.location ?? "").toLowerCase() === city);
  let out = cands.filter((c) => ok(c) && match(c));
  if (out.length < 3 && (idea.ids?.length || h)) {
    const ids = new Set(idea.ids ?? []);
    const extra = universe.filter((c) => ok(c) && (ids.size ? ids.has(c.id) : true) && match(c) && !out.some((o) => o.id === c.id));
    // useful insurance prices first, nearest expiry next
    extra.sort((a, b) => insurancePrice(a) - insurancePrice(b) || Date.parse(a.expiry) - Date.parse(b.expiry));
    out = [...out, ...extra].slice(0, 12);
  }
  return out;
}
const insurancePrice = (c: MarketContract) => { const p = Math.min(c.yesAsk ?? 1, c.noAsk ?? 1); return p >= 0.05 && p <= 0.6 ? Math.abs(p - 0.25) : 1 + Math.abs(p - 0.25); };

// ---------- labels, direction, ladders ----------

export interface LabelBound { dir: "up" | "down" | "range" | null; v: number | null }
export function labelBound(label: string): LabelBound {
  const l = label.replace(/,/g, "");
  const v = numIn(l);
  if (/or above|or more|or higher|and above|^above\b|^over\b|^≥|^>|\+\s*$/i.test(l)) return { dir: "up", v };
  if (/or below|or less|or lower|and below|^below\b|^under\b|^≤|^</i.test(l)) return { dir: "down", v };
  if ((l.match(/-?\d+(?:\.\d+)?/g) ?? []).length >= 2) return { dir: "range", v };
  return { dir: null, v };
}

const askOf = (c: MarketContract, side: "yes" | "no") => (side === "yes" ? c.yesAsk : c.noAsk);
const okAsk = (a: number | null | undefined): a is number => a != null && a >= 0.03 && a <= 0.85;

/** Direction-aware pick for a proxy risk when the matcher LLM is unavailable. */
export function directionalPick(risk: Risk, cands: MarketContract[]): HedgeLeg | null {
  const note = "Heuristic pick (AI matcher unavailable); review before buying.";
  const down = risk.peril === "cold" || /\b(below|under|drops?|falls?|crash|lower|cut)\b/i.test(risk.trigger);
  const scored: { c: MarketContract; side: "yes" | "no"; a: number }[] = [];
  for (const c of cands) {
    const b = labelBound(c.label);
    if (b.dir === "range") continue;
    let side: "yes" | "no" | null = null;
    if (b.dir === "up") side = down ? "no" : "yes";
    else if (b.dir === "down") side = down ? "yes" : "no";
    else side = "yes"; // categorical (e.g. "Hike 25bps"): YES on the named outcome
    const a = askOf(c, side);
    if (okAsk(a)) scored.push({ c, side, a });
  }
  scored.sort((x, y) => Math.abs(x.a - 0.25) - Math.abs(y.a - 0.25));
  const s = scored[0];
  return s ? { riskId: risk.id, contractId: s.c.id, side: s.side, rationale: `Pays if "${s.c.eventTitle}" resolves ${s.side === "yes" ? "" : "NOT "}${s.c.label}.`, basisRisk: `Proxy hedge: the market moves with your cost/demand driver, not your exact loss. ${note}` } : null;
}

export type TieredLeg = HedgeLeg & { tier: string };
export const TIER_LABEL: Record<string, string> = {
  recommended: "Recommended", balanced: "Balanced", "cheap-tail": "Cheap tail", broad: "Broad", "other-date": "Other date", "other-side": "Other side", "other-venue": "Other venue",
};

/**
 * Adds up to `max` choices per risk from the risk's own candidates (never new ids):
 *  - strike ladder on the same event: a cheaper tail (more extreme strike) and a broader strike (pays more often)
 *  - same series on another date (e.g. Brent Nov 30 instead of Nov 20)
 *  - games: the opponent-wins side when the pick is "own team NO" (and vice versa)
 */
export function ladderChoices(rec: TieredLeg, cands: MarketContract[], existing: TieredLeg[], max = 3): TieredLeg[] {
  const out = [...existing];
  const has = (id: string) => out.some((l) => l.contractId === id);
  const c0 = cands.find((c) => c.id === rec.contractId);
  if (!c0) return out;
  const a0 = askOf(c0, rec.side);
  if (a0 == null) return out;
  const b0 = labelBound(c0.label);
  const push = (c: MarketContract, side: "yes" | "no", tier: string, why: string) => {
    if (out.length >= max || has(c.id)) return;
    out.push({ riskId: rec.riskId, contractId: c.id, side, tier, rationale: why, basisRisk: rec.basisRisk });
  };

  if (c0.peril === "game") {
    const other = cands.find((c) => c.eventTicker === c0.eventTicker && c.id !== c0.id && okAsk(askOf(c, rec.side === "no" ? "yes" : "no")) && Math.abs(askOf(c, rec.side === "no" ? "yes" : "no")! - a0) <= 0.1);
    if (other) push(other, rec.side === "no" ? "yes" : "no", "other-side", `Same game, other side: ${rec.side === "no" ? `YES on ${other.label}` : `NO on ${other.label}`} pays in the same outcome (draws/overtime rules can differ).`);
    return out;
  }
  if (b0.dir === "up" || b0.dir === "down") {
    const sibs = cands.filter((c) => c.eventTicker === c0.eventTicker && c.id !== c0.id && labelBound(c.label).dir === b0.dir && okAsk(askOf(c, rec.side)));
    const cheaper = sibs.filter((c) => askOf(c, rec.side)! <= a0 * 0.75).sort((x, y) => Math.abs(askOf(x, rec.side)! - a0 * 0.5) - Math.abs(askOf(y, rec.side)! - a0 * 0.5))[0];
    const broader = sibs.filter((c) => askOf(c, rec.side)! >= a0 * 1.3).sort((x, y) => Math.abs(askOf(x, rec.side)! - Math.min(0.8, a0 * 1.8)) - Math.abs(askOf(y, rec.side)! - Math.min(0.8, a0 * 1.8)))[0];
    if (cheaper && !out.some((l) => l.tier === "cheap-tail")) push(cheaper, rec.side, "cheap-tail", `Cheaper tail cover: "${cheaper.label}" pays only in the worse case, at ${Math.round(askOf(cheaper, rec.side)! * 100)}¢ per $1.`);
    if (broader && !out.some((l) => l.tier === "broad")) push(broader, rec.side, "broad", `Broader cover: "${broader.label}" pays more often, at ${Math.round(askOf(broader, rec.side)! * 100)}¢ per $1.`);
  }
  const s0 = seriesName(c0.eventTitle);
  const dated = cands.filter((c) => c.eventTicker !== c0.eventTicker && seriesName(c.eventTitle) === s0 && (c.location ?? "") === (c0.location ?? "") && labelBound(c.label).dir === b0.dir && okAsk(askOf(c, rec.side)))
    .sort((x, y) => Math.abs((labelBound(x.label).v ?? 0) - (b0.v ?? 0)) - Math.abs((labelBound(y.label).v ?? 0) - (b0.v ?? 0)));
  if (dated[0]) push(dated[0], rec.side, "other-date", `Different window: "${dated[0].eventTitle}" (${dated[0].label}).`);
  return out;
}

// ---------- packages ----------

const r2 = (n: number) => Math.round(n * 100) / 100;
const STRENGTH = { strong: 3, medium: 2, weak: 1 } as const;

/**
 * Three alternative plans from the sized choices (code only), each fitted to the budget at the quote's coverage
 * with the same greedy the client uses (rescaleQuote), so totals match what the owner sees after switching.
 */
export function buildPackages(q: Quote, coveragePct: number): QuotePackage[] {
  const opts = q.options ?? [];
  if (!opts.length) return [];
  const risk = new Map(q.risks.map((r) => [r.id, r]));
  const buyable = (l: QuoteLine) => l.action !== "read-only";
  // tier-based: the same event at a different strike, never a different date/side (those are owner choices)
  const rec = (cs: QuoteLine[]) => cs.filter(buyable)[0];
  const cheapest = (cs: QuoteLine[]) => cs.filter(buyable).find((c) => c.tier === TIER_LABEL["cheap-tail"]) ?? rec(cs);
  const broadest = (cs: QuoteLine[]) => cs.filter(buyable).find((c) => c.tier === TIER_LABEL.broad) ?? rec(cs);
  const strength = (id: string) => STRENGTH[risk.get(id)?.correlation ?? "medium"];
  const defs: { id: QuotePackage["id"]; name: string; blurb: string; pick: (o: { riskId: string; choices: QuoteLine[] }) => QuoteLine | undefined }[] = [
    { id: "essentials", name: "Essentials", blurb: "Only your direct risks, cheap-tail strike where one exists: smallest premium, pays in the bad tail.",
      pick: (o) => (risk.get(o.riskId)?.kind === "proxy" ? undefined : cheapest(o.choices)) },
    { id: "balanced", name: "Balanced", blurb: "The AI's recommended strike for each direct risk, plus creative hedges with a strong or medium link.",
      pick: (o) => (risk.get(o.riskId)?.kind === "proxy" && strength(o.riskId) < 2 ? undefined : rec(o.choices)) },
    { id: "max", name: "Max protection", blurb: "Broader strikes where available and every creative hedge. Pays most often; costs the most.",
      pick: (o) => broadest(o.choices) },
  ];
  const out: QuotePackage[] = [];
  for (const d of defs) {
    const seen = new Set<string>(); // never buy one contract twice (bigger loss keeps it)
    const lines = [...opts].sort((a, b) => (risk.get(b.riskId)?.lossUsd ?? 0) - (risk.get(a.riskId)?.lossUsd ?? 0))
      .map((o) => d.pick(o)).filter((l): l is QuoteLine => !!l && !seen.has(l.contractId) && !!seen.add(l.contractId))
      .sort((a, b) => q.risks.findIndex((r) => r.id === a.riskId) - q.risks.findIndex((r) => r.id === b.riskId));
    if (!lines.length) continue;
    const sized = rescaleQuote({ ...q, lines }, coveragePct as Coverage);
    out.push({ id: d.id, name: d.name, blurb: d.blurb, picks: lines.map((l) => ({ riskId: l.riskId, contractId: l.contractId })),
      totalPremiumUsd: r2(sized.totalPremiumUsd), totalPayoutUsd: r2(sized.totalPayoutUsd) });
  }
  // drop packages identical to an earlier one
  const sig = (p: QuotePackage) => p.picks.map((x) => `${x.riskId}:${x.contractId}`).sort().join("|");
  return out.filter((p, i) => out.findIndex((x) => sig(x) === sig(p)) === i);
}

/** Backtest sentence from hitRate() output. */
export function evidenceText(risk: Risk, h: { settled: number; yesCount: number; threshold?: number; source: string } | null): string | undefined {
  if (!h || !h.settled) return undefined;
  const where = (risk.location ?? "").split(",")[0] || "the city";
  const days = `${h.yesCount} of the last ${h.settled} settled days`;
  if (risk.peril === "rain") return `It rained in ${where} on ${days} (${h.source}).`;
  if (risk.peril === "heat") return `${where}'s high reached ${h.threshold ?? "the threshold"}°F or more on ${days} (${h.source}).`;
  if (risk.peril === "cold") return `${where}'s high stayed at or below ${h.threshold ?? "the threshold"}°F on ${days} (${h.source}).`;
  return undefined;
}
