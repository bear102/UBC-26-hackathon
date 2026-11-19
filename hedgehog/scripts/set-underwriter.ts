// Update the Hedgehog Cover underwriter (authority only, devnet): max exposure (and optionally the attestor).
// Usage: npx tsx scripts/set-underwriter.ts <maxExposureUsd> [attestorPubkey]
import { PublicKey } from "@solana/web3.js";
import { env } from "../lib/env";
import { CoverClient, loadKeypair, toUnits } from "../lib/solana/policyClient";

if (/mainnet/.test(env.rpc())) throw new Error("devnet only");
const maxUsd = Number(process.argv[2]);
if (!(maxUsd > 0)) throw new Error("usage: set-underwriter.ts <maxExposureUsd> [attestorPubkey]");
const c = new CoverClient({ signer: loadKeypair("deployer") });
const u = await c.fetchUnderwriter();
if (!u) throw new Error("underwriter not initialized");
const attestor = process.argv[3] ? new PublicKey(process.argv[3]) : u.attestor;
const sig = await c.program.methods
  .setUnderwriter(attestor, toUnits(maxUsd))
  .accountsPartial({ authority: c.program.provider.publicKey!, underwriter: c.uw })
  .rpc();
console.log("set_underwriter tx:", sig);
console.log(JSON.stringify(await c.info(), null, 2));
