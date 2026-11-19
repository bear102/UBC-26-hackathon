// Venue selection. VENUE=mock (devnet, default) | dflow (mainnet; final real-buy step only).
import { env } from "../env";
import type { MarketContract } from "../types";
import { DflowVenue } from "./dflow";
import { MockDflowVenue } from "./mock";
import type { GetContract, Venue } from "./types";

export * from "./types";
export { MockDflowVenue } from "./mock";
export { DflowVenue } from "./dflow";

const venues: Partial<Record<"mock" | "dflow", Venue>> = {};

export function getVenue(id: "mock" | "dflow" = env.venue()): Venue {
  return (venues[id] ??= id === "dflow" ? new DflowVenue() : new MockDflowVenue());
}

/** Venue that owns positions on a network (crank / confirm). */
export function venueFor(network: "devnet" | "mainnet"): Venue {
  return getVenue(network === "mainnet" ? "dflow" : "mock");
}

/** Lazy binding to "@/lib/markets" (owned by another module) so tests/scripts can run without it. */
export const defaultGetContract: GetContract = async (id: string): Promise<MarketContract | null> => {
  const m = await import("../markets");
  return m.getContract(id);
};
