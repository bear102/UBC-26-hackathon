// Move test USDC from a keypair's ATA into the Hedgehog Cover vault (devnet).
// Usage: npx tsx scripts/fund-vault.ts <amountUsd> [keypairName=deployer]
// Or just send devnet USDC (faucet.circle.com) directly to the vault address printed by init-underwriter / /api/cover/info.
import { env } from "../lib/env";
import { CoverClient, loadKeypair } from "../lib/solana/policyClient";

if (/mainnet/.test(env.rpc())) throw new Error("devnet only");
const amount = Number(process.argv[2]);
if (!(amount > 0)) throw new Error("usage: fund-vault.ts <amountUsd> [keypairName]");
const kp = loadKeypair(process.argv[3] ?? "deployer");
const c = new CoverClient({ signer: kp });
const sig = await c.fundVault(amount);
console.log("fund_vault tx:", sig);
console.log(JSON.stringify(await c.info(), null, 2));
