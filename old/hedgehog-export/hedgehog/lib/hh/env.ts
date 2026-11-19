// Loads .env.local / .env for scripts (Next loads them itself).
import fs from "node:fs";
import path from "node:path";

let loaded = false;
export function loadEnv() {
  if (loaded) return;
  loaded = true;
  for (const f of [".env.local", ".env"]) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined || process.env[m[1]] === "") process.env[m[1]] = v;
    }
  }
}
loadEnv();

export const env = {
  rpc: () => process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  usdcMint: () => process.env.USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  publicUrl: () => (process.env.PUBLIC_URL || "http://localhost:5380").replace(/\/$/, ""),
  geminiPublic: () => process.env.GEMINI_PUBLIC_BASE || "https://api.gemini.com",
  geminiTrade: () => process.env.GEMINI_TRADE_BASE || "https://api.gemini.com",
  dailyBudget: () => Number(process.env.DAILY_BUDGET_USD || 25),
  priceCeiling: () => Number(process.env.PRICE_CEILING || 0.75),
  limitSlippage: () => Number(process.env.LIMIT_SLIPPAGE || 0.02),
};
