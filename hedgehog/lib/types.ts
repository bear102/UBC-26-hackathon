// SHARED CONTRACT for all Hedgehog v2 modules. Change only with care; every module imports from here.

export type Peril = "heat" | "cold" | "rain" | "game" | "oil" | "gas" | "fed" | "cpi" | "crypto" | "other"
  // winter / disaster / climate perils (Kalshi via DFlow; Polymarket reference). "gas" also covers diesel (fuel).
  | "snow" | "power" | "water" | "quake" | "storm"
  // commodity inputs that used to be "other": natural gas (Gemini NGAS), metals (Gemini XAU/XAG/COPPER)
  | "natgas" | "metals"
  // no direct market: matched to the closest real market (lib/markets/proxies.ts), or Hedgehog parametric cover when
  // HEDGEHOG_PARAMETRIC=1 (lib/markets/parametric). smoke = air quality (AQI). flood also has real river / sea-level markets.
  | "flood" | "smoke" | "hail" | "wildfire";
/** Every peril, in display order (append-only: on-chain peril codes follow lib/solana/policyClient.ts PERIL_CODES). */
export const ALL_PERILS = ["heat", "cold", "rain", "game", "oil", "gas", "fed", "cpi", "crypto", "other", "snow", "power", "water", "quake", "storm", "natgas", "metals", "flood", "smoke", "hail", "wildfire"] as const satisfies readonly Peril[];
/** "hedgehog" = Hedgehog parametric cover: synthetic contracts priced from public history, settled from official data. */
export type VenueId = "gemini" | "kalshi" | "polymarket" | "hedgehog";

/** Business profile from the intake (chat sentence + form). */
export interface BusinessProfile {
  id: string;                 // slug, e.g. "rainey-patio-bar" or random for free text
  name: string;
  description: string;        // the owner's chat sentence(s)
  city: string;               // "Austin, TX"
  zip?: string;
  avgDailyRevenueUsd: number;
  busyDays: string[];         // ["Fri","Sat"]
  monthlyBudgetUsd: number;   // hedge budget cap
  presetId?: string;
}

/** One risk the AI identified. */
export interface Risk {
  id: string;                 // "r1"
  peril: Peril;
  title: string;              // "Extreme heat on a Saturday"
  trigger: string;            // "Austin high >= 98F"
  location?: string;          // "Austin"
  window?: string;            // "next 7 days" / ISO date
  lossUsd: number;            // estimated $ lost per occurrence
  lossUsdAi?: number;         // the AI's original estimate when the owner edited lossUsd
  lossReasoning: string;
  confidence: number;         // 0..1
  /** direct = the obvious exposure; proxy = second-order / creative link (fuel, commodities, rates, rival games...). */
  kind?: "direct" | "proxy";
  /** How tightly the market tracks this business's loss. */
  correlation?: "strong" | "medium" | "weak";
  causalStory?: string;       // "Diesel follows Brent within ~2 weeks; 4 vans burn ~1,300 gal/month"
  worthIt?: string;           // why the premium is (or isn't) worth paying
  evidence?: string;          // backtest: "Austin hit >= 85°F on 3 of the last 29 days (Gemini settled markets)"
  /** Exposure horizon (lib/ai/horizon.ts): a day/game/week, a month, or a whole season. Absent = parsed from `window`. */
  horizon?: "event" | "month" | "season";
}

/** Something the business benefits from: say so, don't sell a hedge for it. */
export interface NaturalHedge {
  peril: Peril;
  title: string;              // "Cold snaps help birria sales"
  explanation: string;
  advice: "dont-hedge" | "hedge-opposite" | "watch";
}

/** A pre-built plan the owner can switch to (all lines sized at the quote's coverage, inside the budget). */
export interface QuotePackage {
  id: "essentials" | "balanced" | "max";
  name: string;               // "Essentials"
  blurb: string;
  picks: { riskId: string; contractId: string }[];
  totalPremiumUsd: number;
  totalPayoutUsd: number;
}

/** A normalized, tradable (or read-only) binary contract from any venue. */
export interface MarketContract {
  id: string;                 // globally unique: `${venue}:${symbol}`
  venue: VenueId;
  eventTitle: string;         // "Highest temperature in Austin on November 19, 2026?"
  label: string;              // contract label: "95°F or above", "Spurs"
  symbol: string;             // venue instrument (Gemini instrumentSymbol / Kalshi ticker)
  eventTicker: string;
  peril: Peril;
  location?: string;
  expiry: string;             // ISO
  yesAsk: number | null;      // $ per contract that pays $1 (0..1)
  yesBid: number | null;
  noAsk: number | null;
  noBid: number | null;
  depthYes?: number;          // contracts available at/near ask
  depthNo?: number;
  url?: string;               // deep link to the venue market
  tradable: boolean;          // can Hedgehog build a buy for it (devnet mock venue / dflow): gemini + kalshi true, polymarket false
  status: "open" | "closed" | "settled";
  resolution?: "yes" | "no" | null;
  /** Set by findCandidates when this is the closest real market for a risk with no direct one (hail -> tornado count):
   *  the honest basis-risk note (lib/markets/proxies.ts). */
  proxyNote?: string;
}

/** AI's pick for a risk (must reference a candidate MarketContract.id). */
export interface HedgeLeg {
  riskId: string;
  contractId: string;
  side: "yes" | "no";         // which side pays when the bad thing happens
  rationale: string;
  basisRisk: string;          // honest mismatch note
}

/** Sized line in the quote. */
export interface QuoteLine extends HedgeLeg {
  contract: MarketContract;
  coveragePct: number;        // 25 | 50 | 100
  contracts: number;
  pricePerContract: number;   // avg fill price walking the book
  premiumUsd: number;         // cost
  /** Premium spread over the months the hedge covers (season / month-end contracts; max 6): what it costs against the monthly budget. */
  premiumPerMonth?: number;
  payoutUsd: number;          // paid if event happens (= contracts * 1)
  impliedProb: number;
  maxCoverable?: number;      // when depth limits size
  action: "buy-onchain" | "open-on-gemini" | "read-only";
  /** Strike/window choice label, e.g. "Cheap tail" | "Balanced" | "Broad" | "Longer window". */
  tier?: string;
  /** Optional cross-venue price check (Polymarket, read-only): its probability that this line pays. */
  crossCheck?: { venue: "polymarket"; contractId: string; title: string; prob: number; lineProb: number; diffPts: number; exact: boolean; url?: string };
  /** Weather lines whose date has a forecast (lib/ai/forecast.ts): the forecast's chance this line pays vs the market's.
   *  `note` only when they differ by >= 15 pts ("Forecast 70% vs market 23%: cheap cover"). */
  forecast?: { prob: number; marketProb: number; source: "NWS" | "Open-Meteo"; date: string; note?: string };
}

export interface Quote {
  businessId: string;
  createdAt: string;
  risks: Risk[];
  lines: QuoteLine[];
  uncovered: { riskId: string; reason: string }[];
  totalPremiumUsd: number;
  totalPayoutUsd: number;
  budgetUsd: number;
  summary: string;            // human paragraph from the AI
  model: string;              // which LLM produced it
  /** All sized choices per risk (first = the AI's recommendation; `lines` uses one of them). */
  options?: { riskId: string; choices: QuoteLine[] }[];
  packages?: QuotePackage[];
  naturalHedges?: NaturalHedge[];
  /** The owner's answers to the AI's clarifying questions that this quote was built with. */
  clarifications?: ClarifyAnswer[];
}

/** A short clarifying question the AI asks before quoting (lib/ai/clarify.ts). */
export interface ClarifyQuestion {
  id: string;                 // topic slug: "outdoor" | "vehicles" | "loan" | "busy-days" | "game" | "weather" | other
  question: string;           // "How much of your seating is outdoors?"
  why: string;                // few words shown under it: "so rain cover fits"
  options: string[];          // tap-to-select chips (<= 5)
  allowFreeText: boolean;
  multi?: boolean;            // owner may tick several options ("Rain, Cold"); answer is the picks joined with ", "
  label?: string;             // 1-3 word topic for the plan recap: "Outdoor seating"
}

/** The owner's answer to one ClarifyQuestion. */
export interface ClarifyAnswer {
  questionId: string;
  question: string;
  answer: string;
  label?: string;
}

/** A hedge position the owner bought (devnet mock venue or mainnet DFlow). */
export interface Position {
  id: string;
  businessId: string;
  owner: string;              // wallet pubkey
  contractId: string;
  side: "yes" | "no";
  contracts: number;
  costUsd: number;
  mint: string;               // outcome token mint
  txSig: string;
  network: "devnet" | "mainnet";
  status: "open" | "won" | "lost" | "redeemed";
  createdAt: string;
  settledAt?: string;
  payoutUsd?: number;
  redeemTxSig?: string;
  marketCostUsd?: number;     // contracts × market ask (cents up); costUsd = marketCostUsd + feeUsd
  feeUsd?: number;            // Hedgehog fee (HEDGEHOG_FEE_BPS), 0 by default
  voided?: boolean;           // market cancelled/void: payoutUsd is a refund of costUsd, not a $1/contract payout
}

/** Event for the dashboard feed (QuickNode webhook, crank, app). */
export interface FeedEvent {
  id: string;
  at: string;
  source: "quicknode" | "crank" | "app" | "program";
  kind: "fill" | "transfer" | "resolved" | "redeemed" | "policy_bought" | "policy_settled" | "info";
  text: string;
  txSig?: string;
  positionId?: string;
}
