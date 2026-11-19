// Shared Solana Connection helper. Server-only.
// devnet: env.rpc() (SOLANA_RPC_URL). mainnet: MAINNET_RPC_URL (read-only use; we never sign on mainnet server-side).
import { Connection } from "@solana/web3.js";
import { env } from "../env";

const cache = new Map<string, Connection>();

export function rpcUrl(network: "devnet" | "mainnet" = "devnet"): string {
  return network === "mainnet" ? process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com" : env.rpc();
}

export function getConnection(network: "devnet" | "mainnet" = "devnet"): Connection {
  const url = rpcUrl(network);
  let c = cache.get(url);
  if (!c) { c = new Connection(url, "confirmed"); cache.set(url, c); }
  return c;
}
