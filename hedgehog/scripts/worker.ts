// Settlement crank: every 60s, for open positions read the market (getContract); when settled redeem winners and
// mark losers. `npm run worker` (loop) · `tsx scripts/worker.ts --once` (single pass). runOnce() is exported for tests.
import "../lib/env";
import { runCrank, type CoverCrank, type CrankResult } from "../lib/venue/crank";
import { CoverClient } from "../lib/solana/policyClient";
import { defaultGetContract, venueFor } from "../lib/venue";
import type { GetContract, Venue } from "../lib/venue/types";

/** Cover policies on devnet: the attestor (keys/attestor.json) settles from the market resolution. */
export async function coverCrank(): Promise<CoverCrank | undefined> {
  try {
    const c = new CoverClient();
    const u = await c.fetchUnderwriter();
    if (!u) return undefined;
    return {
      graceSecs: Number(u.graceSecs.toString()),
      listOpen: async () => (await c.listPolicies()).filter((p) => p.status === "open"),
      settle: (pda, outcome) => c.settlePolicy(pda, outcome),
      expire: (pda) => c.expirePolicy(pda),
    };
  } catch (e) {
    console.warn("[crank] cover disabled:", (e as Error).message);
    return undefined;
  }
}

export async function runOnce(opts: { getContract?: GetContract; venueFor?: (n: "devnet" | "mainnet") => Venue; log?: (s: string) => void; cover?: CoverCrank | false } = {}): Promise<CrankResult> {
  return runCrank({
    getContract: opts.getContract ?? defaultGetContract,
    venueFor: opts.venueFor ?? venueFor,
    log: opts.log ?? ((s) => console.log(`[crank ${new Date().toISOString()}] ${s}`)),
    cover: opts.cover === false ? undefined : opts.cover ?? (await coverCrank()),
  });
}

async function main() {
  const once = process.argv.includes("--once");
  const intervalMs = Number(process.env.CRANK_INTERVAL_MS) || 60_000;
  for (;;) {
    try {
      const r = await runOnce();
      console.log(`[crank] checked=${r.checked} confirmed=${r.confirmed} won=${r.won} lost=${r.lost} redeemed=${r.redeemed} voided=${r.voided} policies settled=${r.policiesSettled} expired=${r.policiesExpired} awaiting=${r.policiesAwaiting ?? 0} errors=${r.errors.length}`);
    } catch (e) { console.error("[crank] pass failed:", e); }
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const isMain = process.argv[1] && /worker\.ts$/.test(process.argv[1]);
if (isMain) main();
