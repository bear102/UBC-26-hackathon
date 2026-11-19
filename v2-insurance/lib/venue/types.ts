// Venue layer contract. MockDflowVenue (devnet) and DflowVenue (mainnet) both implement it.
import type { MarketContract, Position } from "../types";

export type Side = "yes" | "no";

export interface BuyArgs {
  owner: string;              // wallet pubkey (base58); fee payer + signer of the returned tx
  contract: MarketContract;
  side: Side;
  contracts: number;          // whole contracts, each pays $1 if the side wins
  businessId: string;
}

export interface Venue {
  id: "mock" | "dflow";
  network: "devnet" | "mainnet";
  /** Returns an unsigned-by-owner tx (base64) and saves Position{status:"open", txSig:""}. */
  buildBuyTx(a: BuyArgs): Promise<{ position: Position; txBase64: string }>;
  /** Verifies the owner's signature landed on-chain and matches the position; sets txSig, emits a "fill" FeedEvent. */
  confirmBuy(positionId: string, signature: string): Promise<Position>;
  /** Pays a winning position. Throws OwnerSignatureRequired when the venue needs the owner to sign (DFlow). */
  redeem(position: Position): Promise<{ txSig: string; payoutUsd: number }>;
}

/** Contract lookup injected into venues/worker (defaults to getContract from "@/lib/markets"). */
export type GetContract = (id: string) => Promise<MarketContract | null>;

export class VenueError extends Error {
  constructor(message: string, public status = 400, public code = "venue_error") { super(message); }
}

/** DFlow redemption is an owner-signed swap (outcome -> USDC); the crank can't do it. */
export class OwnerSignatureRequired extends VenueError {
  constructor(message: string, public txBase64?: string) { super(message, 409, "owner_signature_required"); }
}
