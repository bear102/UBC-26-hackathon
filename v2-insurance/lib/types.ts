// SHARED CONTRACT for all Hedgehog v2 modules. Change only with care; every module imports from here.

export type Peril = "heat" | "cold" | "rain" | "game" | "oil" | "gas" | "fed" | "cpi" | "crypto" | "other";
export type VenueId = "gemini" | "kalshi" | "polymarket";

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
  lossReasoning: string;
  confidence: number;         // 0..1
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
  tradable: boolean;          // can Hedgehog build a buy for it (mock/dflow); gemini = advice-only => false
  status: "open" | "closed" | "settled";
  resolution?: "yes" | "no" | null;
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
  payoutUsd: number;          // paid if event happens (= contracts * 1)
  impliedProb: number;
  maxCoverable?: number;      // when depth limits size
  action: "buy-onchain" | "open-on-gemini" | "read-only";
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
