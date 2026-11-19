// Settlement crank: every 60s, for open positions read the market (getContract); when settled redeem winners and
// mark losers. `npm run worker` (loop) · `tsx scripts/worker.ts --once` (single pass). runOnce() is exported for tests.
import "../lib/env";
import { runCrank, type CrankResult } from "../lib/venue/crank";
import { defaultGetContract, venueFor } from "../lib/venue";
import type { GetContract, Venue } from "../lib/venue/types";

export async function runOnce(opts: { getContract?: GetContract; venueFor?: (n: "devnet" | "mainnet") => Venue; log?: (s: string) => void } = {}): Promise<CrankResult> {
  return runCrank({
    getContract: opts.getContract ?? defaultGetContract,
    venueFor: opts.venueFor ?? venueFor,
    log: opts.log ?? ((s) => console.log(`[crank ${new Date().toISOString()}] ${s}`)),
  });
}

async function main() {
  const once = process.argv.includes("--once");
  const intervalMs = Number(process.env.CRANK_INTERVAL_MS) || 60_000;
  for (;;) {
    try {
      const r = await runOnce();
      console.log(`[crank] checked=${r.checked} confirmed=${r.confirmed} won=${r.won} lost=${r.lost} redeemed=${r.redeemed} errors=${r.errors.length}`);
    } catch (e) { console.error("[crank] pass failed:", e); }
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const isMain = process.argv[1] && /worker\.ts$/.test(process.argv[1]);
if (isMain) main();
