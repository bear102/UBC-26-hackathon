// Loads .env.local / .env for scripts (Next loads them itself). Server-only.
import fs from "node:fs";
import path from "node:path";

let loaded = false;
export function loadEnv() {
  if (loaded) return; loaded = true;
  for (const f of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\n]*?)\s*(#.*)?$/);
      if (m && (process.env[m[1]] === undefined || process.env[m[1]] === "")) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();
const e = (k: string, d = "") => process.env[k] || d;
export const env = {
  geminiKey: () => e("GEMINI_API_KEY"),
  geminiModelPro: () => e("GEMINI_MODEL_PRO", "gemini-2.5-pro"),
  geminiModelFast: () => e("GEMINI_MODEL_FAST", "gemini-2.5-flash"),
  anthropicKey: () => e("ANTHROPIC_API_KEY"),
  openaiKey: () => e("OPENAI_API_KEY"),
  quicknodeKey: () => e("QUICKNODE_API_KEY"),
  rpc: () => e("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
  usdcMint: () => e("USDC_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  venue: () => e("VENUE", "mock") as "mock" | "dflow",
  geminiPublic: () => e("GEMINI_PUBLIC_BASE", "https://api.gemini.com"),
  dflowMeta: () => e("DFLOW_METADATA_BASE", "https://dev-prediction-markets-api.dflow.net/api/v1"),
  dflowTrade: () => e("DFLOW_TRADE_BASE", "https://dev-quote-api.dflow.net"),
  dataDir: () => path.resolve(process.cwd(), ".data"),
  keysDir: () => path.resolve(process.cwd(), "keys"),
};
