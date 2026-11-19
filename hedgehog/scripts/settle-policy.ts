// Attestor/crank: settle or expire a Hedgehog Cover policy on devnet.
// Usage: npx tsx scripts/settle-policy.ts <policyPda> yes|no
//        npx tsx scripts/settle-policy.ts <policyPda> expire
//        npx tsx scripts/settle-policy.ts list [owner]
import { env } from "../lib/env";
import { store } from "../lib/store";
import { CoverClient } from "../lib/solana/policyClient";

if (/mainnet/.test(env.rpc())) throw new Error("devnet only");
const [a, b] = process.argv.slice(2);
const c = new CoverClient();
if (!a || a === "list") {
  console.log(JSON.stringify(await c.listPolicies(b), null, 2));
} else {
  const pol = await c.getPolicy(a);
  if (!pol) throw new Error("policy not found");
  if (b === "expire") {
    const sig = await c.expirePolicy(a);
    console.log("expire_policy tx:", sig);
    store.feed({ source: "program", kind: "policy_settled", text: `Policy #${pol.policyId} (${pol.marketRef}) expired unsettled: ${pol.premiumUsd} USDC premium refunded`, txSig: sig });
  } else if (b === "yes" || b === "no") {
    const sig = await c.settlePolicy(a, b === "yes");
    console.log("settle_policy tx:", sig);
    store.feed({
      source: "program",
      kind: "policy_settled",
      text: b === "yes"
        ? `Policy #${pol.policyId} (${pol.marketRef}) triggered: paid ${pol.payoutUsd} USDC to ${pol.owner.slice(0, 4)}…`
        : `Policy #${pol.policyId} (${pol.marketRef}) settled NO: no payout`,
      txSig: sig,
    });
  } else {
    throw new Error("second arg must be yes|no|expire");
  }
  console.log(JSON.stringify(await c.getPolicy(a), null, 2));
}
