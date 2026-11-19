// One-time: create the Hedgehog Cover underwriter + PDA-owned USDC vault on devnet.
// Usage: npx tsx scripts/init-underwriter.ts [maxExposureUsd=1000] [graceSecs=3600]
import { PublicKey } from "@solana/web3.js";
import { env } from "../lib/env";
import { CoverClient, loadKeypair } from "../lib/solana/policyClient";

if (/mainnet/.test(env.rpc())) throw new Error("devnet only");
const maxExposureUsd = Number(process.argv[2] ?? 1000);
const graceSecs = Number(process.argv[3] ?? 3600);
const deployer = loadKeypair("deployer");
const attestor = loadKeypair("attestor").publicKey;
const mint = new PublicKey(env.usdcMint());
const c = new CoverClient({ signer: deployer });

const existing = await c.fetchUnderwriter();
if (existing) {
  console.log("underwriter already initialized");
} else {
  const sig = await c.initUnderwriter({ mint, attestor, maxExposureUsd, graceSecs });
  console.log("init_underwriter tx:", sig);
}
console.log(JSON.stringify(await c.info(), null, 2));
