# Pitch / demo notes (collected while building)

## Dashboard: "Hedges" vs "Hedgehog Cover policies"
The dashboard ("My cover") shows two sections:
- **Hedges**: outcome-token positions from the old "Buy hedge (devnet)" button (YES/NO SPL tokens in the owner's wallet, paid by burning them). That button was retired when the plan was consolidated to one "Get covered" button.
- **Hedgehog Cover policies**: what "Get covered" buys now (a policy in our Solana program `hedgehog_policy`, premium into the onchain payout pool, paid automatically on settlement).
For the demo: a fresh wallet shows "0 on file" in both. Before recording/pitching, buy cover with the demo wallet on markets that settle beforehand so the dashboard isn't empty, and decide whether to remove or relabel the "Hedges" section (user asked to keep this in mind for the pitch/demo, 2026-11-19).

**Resolved 2026-11-20:** the dashboard now shows one "Your cover" list (Cover policies). The old outcome-token section appears only for wallets that still hold such positions, as "Earlier hedges (outcome tokens)", so a judge's demo wallet sees a single list.
