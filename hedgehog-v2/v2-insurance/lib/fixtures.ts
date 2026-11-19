// Demo fixtures for the frontend. Used with `?mock=1` or as an automatic fallback when an API call fails.
import type { BusinessProfile, FeedEvent, MarketContract, Position, Quote, QuoteLine, Risk } from "@/lib/types";
import { rescaleQuote, type Coverage } from "@/lib/client/quote";

export type Preset = BusinessProfile & { tagline: string };

export const FIXTURE_PRESETS: Preset[] = [
  {
    id: "rainey-patio-bar", presetId: "rainey-patio-bar", name: "Lazy Heron Patio Bar",
    tagline: "Rainey St patio bar. A wet Saturday or a Spurs loss empties the deck.",
    description: "We're a patio bar on Rainey Street. Most of our seats are outside, and Spurs game nights and Saturdays are our big days.",
    city: "Austin, TX", zip: "78701", avgDailyRevenueUsd: 3200, busyDays: ["Thu", "Fri", "Sat"], monthlyBudgetUsd: 300,
  },
  {
    id: "east-austin-food-truck", presetId: "east-austin-food-truck", name: "Cielo Taco Truck",
    tagline: "East Austin food truck. Rain kills the lunch line; a cold snap halves it.",
    description: "Taco truck on East Cesar Chavez. No indoor seating — when it rains at lunch, the line disappears.",
    city: "Austin, TX", zip: "78702", avgDailyRevenueUsd: 1400, busyDays: ["Tue", "Wed", "Thu", "Fri", "Sat"], monthlyBudgetUsd: 150,
  },
  {
    id: "austin-catering-delivery", presetId: "austin-catering-delivery", name: "Hill Country Catering Co.",
    tagline: "Catering + delivery fleet. Fuel spikes eat the margin on fixed-price contracts.",
    description: "We cater corporate lunches and weddings with four delivery vans. Our contracts are fixed-price, so fuel spikes come out of our margin.",
    city: "Austin, TX", zip: "78745", avgDailyRevenueUsd: 4500, busyDays: ["Fri", "Sat", "Sun"], monthlyBudgetUsd: 400,
  },
];

const mk = (c: Partial<MarketContract> & Pick<MarketContract, "id" | "venue" | "eventTitle" | "label" | "peril" | "expiry" | "yesAsk">): MarketContract => ({
  symbol: c.id.split(":")[1] ?? c.id, eventTicker: (c.id.split(":")[1] ?? c.id).split("-").slice(0, 2).join("-"),
  yesBid: c.yesAsk != null ? Math.max(0.01, +(c.yesAsk - 0.03).toFixed(2)) : null,
  noAsk: c.yesAsk != null ? +(1 - c.yesAsk + 0.03).toFixed(2) : null,
  noBid: c.yesAsk != null ? +(1 - c.yesAsk).toFixed(2) : null,
  depthYes: 2500, depthNo: 2500, location: "Austin", tradable: c.venue !== "polymarket", status: "open", resolution: null,
  ...c,
});

export const FIXTURE_MARKETS: MarketContract[] = [
  mk({ id: "kalshi:KXRAINAUS-26NOV21", venue: "kalshi", eventTitle: "Will it rain in Austin on Sat, Nov 21?", label: "Yes — measurable rain (≥0.01 in)", peril: "rain", expiry: "2026-11-22T06:00:00Z", yesAsk: 0.28, url: "https://kalshi.com/markets/kxrainaus" }),
  mk({ id: "kalshi:KXRAINAUS-26NOV20", venue: "kalshi", eventTitle: "Will it rain in Austin on Fri, Nov 20?", label: "Yes — measurable rain (≥0.01 in)", peril: "rain", expiry: "2026-11-21T06:00:00Z", yesAsk: 0.34, url: "https://kalshi.com/markets/kxrainaus" }),
  mk({ id: "gemini:GAME-NBA-SAS-LAL-261120-LAL", venue: "gemini", eventTitle: "Spurs vs Lakers — Fri, Nov 20", label: "Lakers win", peril: "game", location: "San Antonio", expiry: "2026-11-21T05:00:00Z", yesAsk: 0.46, depthYes: 1800, url: "https://www.gemini.com/prediction-markets" }),
  mk({ id: "gemini:TEMP-AUS-261121-LT58", venue: "gemini", eventTitle: "Highest temperature in Austin on Nov 21, 2026?", label: "Below 58°F", peril: "cold", expiry: "2026-11-22T06:00:00Z", yesAsk: 0.12, depthYes: 400, url: "https://www.gemini.com/prediction-markets" }),
  mk({ id: "gemini:TEMP-AUS-261122-LT50", venue: "gemini", eventTitle: "Highest temperature in Austin on Nov 22, 2026?", label: "Below 50°F", peril: "cold", expiry: "2026-11-23T06:00:00Z", yesAsk: 0.08, depthYes: 300, url: "https://www.gemini.com/prediction-markets" }),
  mk({ id: "gemini:WTI-261231-GT85", venue: "gemini", eventTitle: "WTI crude settle on Dec 31, 2026?", label: "Above $85", peril: "oil", location: undefined, expiry: "2026-12-31T22:00:00Z", yesAsk: 0.18, depthYes: 1500, url: "https://www.gemini.com/prediction-markets" }),
  mk({ id: "kalshi:KXAAAGASM-26NOV30-T3.40", venue: "kalshi", eventTitle: "US average gas price on Nov 30?", label: "Above $3.40/gal", peril: "gas", location: "US", expiry: "2026-12-01T05:00:00Z", yesAsk: 0.22, url: "https://kalshi.com/markets/kxaaagasm" }),
  mk({ id: "kalshi:KXCPI-26NOV-T0.4", venue: "kalshi", eventTitle: "CPI month-over-month for November?", label: "Above 0.4%", peril: "cpi", location: "US", expiry: "2026-12-10T13:30:00Z", yesAsk: 0.15, tradable: false, url: "https://kalshi.com/markets/kxcpi" }),
];
const M = (id: string) => FIXTURE_MARKETS.find((m) => m.id === id)!;

type LineSeed = { risk: Risk; contractId: string; rationale: string; basisRisk: string };
type Seed = { lines: LineSeed[]; uncovered: { risk: Risk; reason: string }[]; summary: string };

const SEEDS: Record<string, Seed> = {
  "rainey-patio-bar": {
    lines: [
      { risk: { id: "r1", peril: "rain", title: "Rain washes out Saturday on the patio", trigger: "Measurable rain at Austin-Bergstrom on Sat, Nov 21", location: "Austin", window: "Sat Nov 21", lossUsd: 1100, lossReasoning: "~70% of seats are outside. Rainy Saturdays run ~35% below a normal $3,200 day → ~$1,100.", confidence: 0.78 },
        contractId: "kalshi:KXRAINAUS-26NOV21", rationale: "Pays $1 per contract if any measurable rain is recorded in Austin on Saturday.", basisRisk: "Measured at the airport (KAUS), ~8 mi from Rainey St. A 10-minute shower counts as rain but may not empty the patio." },
      { risk: { id: "r2", peril: "game", title: "Spurs lose on watch-party night", trigger: "Spurs lose to the Lakers, Fri Nov 20", location: "San Antonio", window: "Fri Nov 20", lossUsd: 600, lossReasoning: "Win nights keep the crowd ~2 hours longer. A loss empties the deck by 9pm: ~$600 less in late tabs.", confidence: 0.56 },
        contractId: "gemini:GAME-NBA-SAS-LAL-261120-LAL", rationale: "Buying 'Lakers win' pays exactly when the Spurs lose.", basisRisk: "A close loss may still keep people around; a blowout win can also end early." },
      { risk: { id: "r3", peril: "cold", title: "Cold front keeps the patio empty", trigger: "Austin daily high below 58°F on Sat, Nov 21", location: "Austin", window: "Sat Nov 21", lossUsd: 800, lossReasoning: "Below ~58°F heaters can't keep the deck comfortable; past cold Saturdays ran ~25% light.", confidence: 0.64 },
        contractId: "gemini:TEMP-AUS-261121-LT58", rationale: "Gemini's Austin daily-high market prices the cold-front odds directly.", basisRisk: "Daily high, not evening temperature — a warm afternoon with a cold night won't pay." },
    ],
    uncovered: [{ risk: { id: "r4", peril: "other", title: "Rainey St closed for a city event", trigger: "Street closure on a busy night", lossUsd: 1500, lossReasoning: "Closures cut walk-in traffic roughly in half.", confidence: 0.3 }, reason: "No prediction market tracks Austin street closures. Talk to a commercial insurer about business-interruption cover." }],
    summary: "Your worst day is a rainy Saturday: about $1,100 in lost patio sales. Rain cover is the best value at 28¢ per $1 of payout and can be bought onchain right now. Add the Spurs-loss hedge on Gemini for Friday's watch party. The cold-front contract is cheap but thin (400 contracts on the book).",
  },
  "east-austin-food-truck": {
    lines: [
      { risk: { id: "r1", peril: "rain", title: "Rain at lunch kills the line", trigger: "Measurable rain in Austin on Fri, Nov 20", location: "Austin", window: "Fri Nov 20", lossUsd: 900, lossReasoning: "No indoor seating. Rainy weekdays lose ~65% of a $1,400 day → ~$900.", confidence: 0.81 },
        contractId: "kalshi:KXRAINAUS-26NOV20", rationale: "Pays $1 per contract if it rains in Austin on Friday.", basisRisk: "Rain at 7pm counts too, even though the lunch rush was dry." },
      { risk: { id: "r2", peril: "cold", title: "Cold snap halves the weekend crowd", trigger: "Austin daily high below 50°F on Sun, Nov 22", location: "Austin", window: "Sun Nov 22", lossUsd: 350, lossReasoning: "Below 50°F walk-ups drop by about a quarter.", confidence: 0.6 },
        contractId: "gemini:TEMP-AUS-261122-LT50", rationale: "Gemini's Austin daily-high market, below-50°F bucket.", basisRisk: "Thin book: only ~300 contracts at the ask." },
    ],
    uncovered: [{ risk: { id: "r3", peril: "other", title: "Truck generator breaks down", trigger: "Mechanical failure", lossUsd: 1400, lossReasoning: "A full day of lost sales.", confidence: 0.2 }, reason: "Idiosyncratic to your truck — no market can price it. Equipment-breakdown insurance fits better." }],
    summary: "Rain is your biggest exposure: ~$900 per wet weekday. A Friday rain hedge costs about 34¢ per $1 of cover and settles onchain. The cold-snap hedge is cheap backup for Sunday.",
  },
  "austin-catering-delivery": {
    lines: [
      { risk: { id: "r1", peril: "oil", title: "Diesel spike on fixed-price contracts", trigger: "WTI crude settles above $85 on Dec 31", location: "US", window: "through Dec 31", lossUsd: 1200, lossReasoning: "~2,000 gal/month across 4 vans. A move to $85 WTI adds ~$0.60/gal → ~$1,200/month of margin.", confidence: 0.62 },
        contractId: "gemini:WTI-261231-GT85", rationale: "WTI leads pump diesel by 1–2 weeks; Gemini's commodity market is the cleanest proxy.", basisRisk: "Pump diesel also moves on refinery margins and taxes, not just crude." },
      { risk: { id: "r2", peril: "gas", title: "Gas prices climb before holiday season", trigger: "US average gas above $3.40/gal on Nov 30", location: "US", window: "Nov 30", lossUsd: 700, lossReasoning: "Two of the vans run on gasoline: +$0.30/gal ≈ $700 over the busy month.", confidence: 0.58 },
        contractId: "kalshi:KXAAAGASM-26NOV30-T3.40", rationale: "Kalshi's AAA national-average gas market, bought as an onchain outcome token.", basisRisk: "National average, not Austin pump prices (Texas usually runs below average)." },
      { risk: { id: "r3", peril: "cpi", title: "Food-cost inflation squeezes menus", trigger: "Nov CPI above 0.4% m/m", location: "US", window: "Dec 10 release", lossUsd: 500, lossReasoning: "Ingredient costs track food CPI; fixed menus can't reprice until January.", confidence: 0.4 },
        contractId: "kalshi:KXCPI-26NOV-T0.4", rationale: "Headline CPI is a loose proxy for food costs.", basisRisk: "Headline CPI, not food-at-home. Shown for context only." },
    ],
    uncovered: [{ risk: { id: "r4", peril: "other", title: "Client cancels a large event", trigger: "Last-minute cancellation", lossUsd: 3000, lossReasoning: "Prepped food and staff time are lost.", confidence: 0.25 }, reason: "Depends on your clients, not a public event. Use deposits and cancellation clauses instead." }],
    summary: "Fuel is your exposure. A WTI > $85 hedge on Gemini covers a crude spike through year-end at 18¢ per $1. Pair it with the onchain gas-price hedge for November. CPI is shown for context only.",
  },
};

export function fixtureQuote(profile: BusinessProfile, coveragePct: Coverage = 50): Quote {
  const seed = SEEDS[profile.presetId ?? profile.id] ?? SEEDS["rainey-patio-bar"];
  const scale = profile.avgDailyRevenueUsd > 0 ? profile.avgDailyRevenueUsd / (FIXTURE_PRESETS.find((p) => p.id === (profile.presetId ?? profile.id))?.avgDailyRevenueUsd ?? 3200) : 1;
  const risks: Risk[] = [];
  const lines: QuoteLine[] = seed.lines.map((s) => {
    const risk = { ...s.risk, lossUsd: Math.round(s.risk.lossUsd * scale) };
    risks.push(risk);
    const c = M(s.contractId);
    const price = c.yesAsk ?? 0.5;
    return {
      riskId: risk.id, contractId: c.id, side: "yes", rationale: s.rationale, basisRisk: s.basisRisk, contract: c,
      coveragePct, contracts: 0, pricePerContract: price, maxCoverable: c.depthYes, premiumUsd: 0, payoutUsd: 0, impliedProb: price,
      action: !c.tradable ? "read-only" : "buy-onchain",
    } satisfies QuoteLine;
  });
  for (const u of seed.uncovered) risks.push({ ...u.risk, lossUsd: Math.round(u.risk.lossUsd * scale) });
  const base: Quote = {
    businessId: profile.id, createdAt: new Date().toISOString(), risks, lines,
    uncovered: seed.uncovered.map((u) => ({ riskId: u.risk.id, reason: u.reason })),
    totalPremiumUsd: 0, totalPayoutUsd: 0, budgetUsd: profile.monthlyBudgetUsd, summary: seed.summary, model: "fixture (demo data)",
  };
  return rescaleQuote(base, coveragePct);
}

export const DEMO_OWNER = "HHdemo1111111111111111111111111111111111111";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export function fixturePositions(owner = DEMO_OWNER): Position[] {
  return [
    { id: "pos_demo_won", businessId: "rainey-patio-bar", owner, contractId: "kalshi:KXRAINAUS-26NOV14", side: "yes", contracts: 480, costUsd: 129.6, mint: "Ra1nYes14mint1111111111111111111111111111111", txSig: "5demoFillTx1111111111111111111111111111111111111111111111111111111111111111111111111", network: "devnet", status: "redeemed", createdAt: ago(60 * 24 * 6), settledAt: ago(60 * 24 * 5), payoutUsd: 480, redeemTxSig: "5demoRedeemTx11111111111111111111111111111111111111111111111111111111111111111111111" },
    { id: "pos_demo_open", businessId: "rainey-patio-bar", owner, contractId: "kalshi:KXRAINAUS-26NOV21", side: "yes", contracts: 550, costUsd: 154, mint: "Ra1nYes21mint1111111111111111111111111111111", txSig: "5demoFillTx2222222222222222222222222222222222222222222222222222222222222222222222222", network: "devnet", status: "open", createdAt: ago(42) },
    { id: "pos_demo_lost", businessId: "rainey-patio-bar", owner, contractId: "gemini:GAME-NBA-SAS-DAL-261115-DAL", side: "yes", contracts: 200, costUsd: 88, mint: "GameDAL15mint111111111111111111111111111111", txSig: "5demoFillTx3333333333333333333333333333333333333333333333333333333333333333333333333", network: "devnet", status: "lost", createdAt: ago(60 * 24 * 5), settledAt: ago(60 * 24 * 4) },
  ];
}

export function fixtureFeed(): FeedEvent[] {
  return [
    { id: "e1", at: ago(1), source: "quicknode", kind: "transfer", text: "Stream: 550 RAIN-NOV21 YES tokens landed in the owner wallet", txSig: "5demoFillTx2222222222222222222222222222222222222222222222222222222222222222222222222", positionId: "pos_demo_open" },
    { id: "e2", at: ago(42), source: "app", kind: "fill", text: "Hedge filled: 550 × Rain in Austin Sat Nov 21 @ 28¢", positionId: "pos_demo_open" },
    { id: "e3", at: ago(60 * 24 * 5), source: "crank", kind: "resolved", text: "Market resolved YES: 0.42 in of rain at KAUS on Sat Nov 14" },
    { id: "e4", at: ago(60 * 24 * 5 - 3), source: "program", kind: "redeemed", text: "Redeemed 480 winning tokens → $480 test USDC paid out", txSig: "5demoRedeemTx11111111111111111111111111111111111111111111111111111111111111111111111", positionId: "pos_demo_won" },
    { id: "e5", at: ago(60 * 24 * 4), source: "crank", kind: "resolved", text: "Market resolved NO: Spurs beat the Mavericks 118–104 (hedge expired)" },
  ];
}

export type CoverPolicy = {
  policyId: string; policyPda?: string; owner?: string; businessId?: string; peril?: string; marketRef?: string; trigger?: string;
  premiumUsd: number; payoutUsd: number; expiry?: string; status: string; txSig?: string; settleTxSig?: string; createdAt?: string;
};
export type CoverInfo = { programId: string; underwriterPda: string; vault: string; vaultBalance: number; exposure: number; mint: string };

export function fixturePolicies(): CoverPolicy[] {
  return [
    { policyId: "1", policyPda: "PoL1cyPda111111111111111111111111111111111", businessId: "rainey-patio-bar", peril: "rain", marketRef: "kalshi:KXRAINAUS-26NOV21", trigger: "Measurable rain at Austin-Bergstrom on Sat, Nov 21", premiumUsd: 42, payoutUsd: 150, expiry: "2026-11-22T06:00:00Z", status: "open", createdAt: ago(30) },
  ];
}
export function fixtureCoverInfo(): CoverInfo {
  return { programId: "HedgeHog1111111111111111111111111111111111", underwriterPda: "UwPda11111111111111111111111111111111111111", vault: "Vau1t11111111111111111111111111111111111111", vaultBalance: 5000, exposure: 150, mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" };
}
