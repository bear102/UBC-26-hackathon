// Move test dollars from a keypair's ATA into the Hedgehog Cover vault (devnet).
// Usage: npx tsx scripts/fund-vault.ts <amountUsd> [keypairName=deployer] [--mint]
//   --mint: first mint <amount> test dollars to the keypair's ATA (keypair must be the mint authority, i.e. desk).
// Example: npx tsx scripts/fund-vault.ts 500 desk --mint
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { env } from "../lib/env";
import { CoverClient, loadKeypair, toUnits } from "../lib/solana/policyClient";

if (/mainnet/.test(env.rpc())) throw new Error("devnet only");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const doMint = process.argv.includes("--mint");
const amount = Number(args[0]);
if (!(amount > 0)) throw new Error("usage: fund-vault.ts <amountUsd> [keypairName] [--mint]");
const kp = loadKeypair(args[1] ?? "deployer");
const c = new CoverClient({ signer: kp });
if (doMint) {
  const ata = await getOrCreateAssociatedTokenAccount(c.connection, kp, c.mint, kp.publicKey);
  const sig = await mintTo(c.connection, kp, c.mint, ata.address, kp, BigInt(toUnits(amount).toString()));
  console.log("mint_to tx:", sig);
}
const sig = await c.fundVault(amount);
console.log("fund_vault tx:", sig);
console.log(JSON.stringify(await c.info(), null, 2));
