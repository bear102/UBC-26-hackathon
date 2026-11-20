// Shared Solana Connection helper. Server-only.
// devnet: env.rpc() (SOLANA_RPC_URL). mainnet: MAINNET_RPC_URL (read-only use; we never sign on mainnet server-side).
import { Connection } from "@solana/web3.js";
import { env } from "../env";

const cache = new Map<string, Connection>();

export function rpcUrl(network: "devnet" | "mainnet" = "devnet"): string {
  return network === "mainnet" ? process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com" : env.rpc();
}

/** Devnet requests go to SOLANA_RPC_URL (QuickNode) and fall back to SOLANA_RPC_FALLBACK (public devnet) on a
 *  network error, 429 or 5xx, so the demo never depends on one provider. */
const FALLBACK = () => process.env.SOLANA_RPC_FALLBACK || "https://api.devnet.solana.com";

function fallbackFetch(primary: string, fallback: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const r = await fetch(input, init);
      if (r.status !== 429 && r.status < 500) return r;
    } catch { /* fall through to the fallback endpoint */ }
    const url = typeof input === "string" && input.startsWith(primary) ? fallback + input.slice(primary.length) : fallback;
    return fetch(url, init);
  }) as typeof fetch;
}

export function getConnection(network: "devnet" | "mainnet" = "devnet"): Connection {
  const url = rpcUrl(network);
  let c = cache.get(url);
  if (!c) {
    const fb = network === "devnet" ? FALLBACK() : "";
    c = fb && fb !== url ? new Connection(url, { commitment: "confirmed", fetch: fallbackFetch(url, fb) }) : new Connection(url, "confirmed");
    cache.set(url, c);
  }
  return c;
}
