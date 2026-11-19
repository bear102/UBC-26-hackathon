// QuickNode Streams filter for Hedgehog (Solana, dataset: Block).
// Keeps only transactions that touch Hedgehog: the desk (co-signs every outcome-token buy, pays every redeem),
// the Hedgehog Cover program, and the attestor (quotes + settles policies). Destination: /api/qn-webhook.
function main(stream) {
  const WATCH = new Set([
    "B53kF14Dch9fvqTfZBcYGSmQ42SmxAGYHkf2sL6UDCer", // desk (outcome-token venue)
    "4H7QHtz77V8oFuGSeXAEwCrSAph7VFNb667zk5SiRbNe", // hedgehog_policy program (Hedgehog Cover)
    "5LQKRaTS8nkd1ag37huyKVNBc5iaFDRG1LnCYTvCu5Es", // attestor (quoter / settler)
  ]);
  const blocks = Array.isArray(stream.data) ? stream.data : [stream.data];
  const matchedTransactions = [];
  for (const block of blocks) {
    for (const tx of (block && block.transactions) || []) {
      if (tx.meta && tx.meta.err) continue;
      const keys = ((tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [])
        .map((k) => (typeof k === "string" ? k : k.pubkey));
      if (keys.some((k) => WATCH.has(k))) matchedTransactions.push({ slot: block.slot ?? block.parentSlot + 1, ...tx });
    }
  }
  return matchedTransactions.length ? { matchedTransactions } : null;
}
