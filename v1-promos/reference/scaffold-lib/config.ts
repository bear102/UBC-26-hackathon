import fs from "node:fs";
import path from "node:path";

// tsx scripts don't get Next's automatic .env loading.
for (const f of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), f);
  if (fs.existsSync(p) && !process.env.__KELLY_ENV_LOADED) {
    try { process.loadEnvFile(p); } catch {}
  }
}
process.env.__KELLY_ENV_LOADED = "1";

const e = (k: string, d = "") => (process.env[k] ?? "").trim() || d;

export const DATA_DIR = path.join(process.cwd(), ".data");
export const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export const config = {
  rpcUrl: e("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
  network: "solana-devnet" as const,
  usdcMintSetting: e("USDC_MINT", CIRCLE_DEVNET_USDC),
  usdcDecimals: 6,
  appUrl: e("APP_URL", "http://localhost:3000"),
  geminiPublic: e("GEMINI_PUBLIC_BASE", "https://api.gemini.com"),
  geminiTrade: e("GEMINI_TRADE_BASE", "https://api.sandbox.gemini.com"),
  geminiKey: e("GEMINI_API_KEY"),
  geminiSecret: e("GEMINI_API_SECRET"),
  anthropicKey: e("ANTHROPIC_API_KEY"),
  anthropicModel: e("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  elevenKey: e("ELEVENLABS_API_KEY"),
  elevenVoice: e("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
  quicknodeToken: e("QUICKNODE_STREAM_TOKEN"),
};

/** Prices (in USDC) the data sellers charge per request via x402. */
export const SELLER_PRICES = {
  "crypto-vol": 0.002,
  "weather-forecast": 0.001,
  "analyst": 0.01,
} as const;
export type SellerId = keyof typeof SELLER_PRICES;

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
