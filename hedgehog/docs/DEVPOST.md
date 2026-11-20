# Devpost submission copy

Paste-ready. Every claim here is checked against code or devnet (see README "Limits").

**Name:** Hedgehog
**Tagline:** Insurance for a small business's worst days, priced by prediction markets and sold on Solana.
**Track:** DeFi & Onchain Applications · **Chain award:** Best use of Solana · **Bounties:** Gemini Prediction Markets, QuickNode Streams
**Links:** demo https://178-156-138-228.sslip.io · judges' page https://178-156-138-228.sslip.io/how-it-works · repo `<public repo URL>` · video `<YouTube URL>`

## What did you build?
Hedgehog is an AI risk advisor with an onchain policy book. A small business describes itself in a sentence. The AI maps its worst days (heat waves, rainouts, home-team losses, fuel spikes) to dollar losses. Hedgehog prices cover for each from live Gemini, Kalshi and Polymarket contracts, and the owner buys every policy from our Solana program in one wallet approval. When the market resolves, the policy pays out from an onchain vault.

## What problem does it solve?
These losses are real but too small and too specific for an insurer to write. Prediction markets already price the events, but a shop owner won't trade an order book or work out which contract matches their risk. Hedgehog does the matching and sizing and sells the result as a plain insurance quote: what you pay, what you get if it happens.

## How does it work?
1. An LLM (Claude, with Gemini fallback) builds a risk map: trigger, estimated loss, reasoning.
2. Code pulls live contracts from the three venues. The AI may only pick contract IDs from that list, so it cannot invent markets.
3. Code sizes each line against the book's depth and the owner's monthly budget; the cheapest identical contract wins, ties go to Gemini.
4. `buy_policy` on our Anchor program is co-signed by our quoter, so the price can't be tampered with. The premium goes into a public vault that refuses cover it can't pay, and the monthly budget is enforced onchain.
5. A crank reads the venue's official result and settles the policy; a YES pays the owner from the vault. If no result ever arrives, anyone can trigger a refund after expiry.
6. Each Gemini-priced sale records a matching backing order on Gemini (dry-run in this build). A QuickNode Stream on devnet pushes our program's transactions to the live dashboard.

## What makes it unique?
It turns existing, regulated prediction markets into parametric insurance for businesses too small for insurers. We don't run our own oracle or liquidity pool: the venues set the price and the result. Risk is sold on Solana, where the vault, the budget and every payout are public, and backed on Gemini.

## What would you build next?
Live backing orders on a funded Gemini account; a multisig or oracle attestor instead of one key; Kalshi outcome tokens on mainnet through DFlow; pilots with a few Austin businesses to check that the loss estimates match their books.

## Technologies used
Solana (devnet), Anchor, SPL Token, @solana/web3.js, Solana Wallet Adapter / Wallet Standard (Phantom), Gemini Prediction Markets API, Kalshi API, Polymarket Gamma API, QuickNode Streams, QuickNode RPC, Next.js, React, TypeScript, Claude (Anthropic API), Google Gemini API, Zod, NWS / Open-Meteo weather data.

## Video script (2:30)
Record on the public URL. Use a preset (fast and repeatable). Do not show policy #7 (`hedgehog:hail`) or e2e fixtures as real payouts.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Home page | "A heat wave or a rained-out Saturday can cost a small business a week's margin. No insurer writes a policy that small. Prediction markets already price these events. Hedgehog turns them into insurance." |
| 0:15–0:45 | Pick the Rainey St patio bar preset → risk map | "The AI maps the business to its worst days, each with a dollar loss and its reasoning." |
| 0:45–1:15 | Quote: one line's venue comparison, payout vs premium, budget bar | "Each risk is matched to a live contract. The AI can only choose from contracts our code pulled, and code picks the cheapest venue. Gemini is primary. Here's what you pay, and what you get if it happens." |
| 1:15–1:35 | "Cover all" → one wallet approval → explorer tx | "One approval buys every policy from our Solana program. The premium goes into a public vault that only sells cover it can pay." |
| 1:35–1:55 | Dashboard: "Your cover" + feed with a QuickNode event | "QuickNode Streams watches our program on devnet and pushes each policy into the live feed." |
| 1:55–2:15 | Explorer: policy #3 settle tx (2tB5…Mx2s), vault → owner 3.00 | "This policy was written on a Gemini daily-high market. Gemini resolved it YES, our crank settled it, and the vault paid the owner. No claim form." |
| 2:15–2:30 | /how-it-works trust section + addresses | "Devnet, test dollars, one attestor key, dry-run Gemini backing: stated plainly. Next: live backing and a multisig attestor." |

## Pitch Q&A (short answers)
- **Isn't this just a prediction-market UI?** No. The owner never sees a contract; they get a quote in dollars sized to their loss and budget, and a policy with an onchain payout.
- **Prior art (Etherisc, Arbol, Nexus)?** They run their own oracles and capital pools for each peril. We reuse markets that already exist and are already resolved by regulated venues, so a new peril needs no new oracle.
- **Basis risk?** Real: the airport reading isn't your patio. Every line shows its mismatch note, and sizing is a share of the estimated loss, not a promise to make you whole.
- **Who settles? Is it trustless?** No. One attestor key posts the venue's official result. The escape hatch is the permissionless refund after expiry. Next: multisig or oracle.
- **Is this legal insurance?** Not in this build. It is a devnet prototype; the product path is an advisor plus self-directed hedges, or a licensed partner writing the cover.
- **Why blockchain?** The vault balance, the exposure, the owner's budget and every payout are public, and the refund doesn't depend on us. The owner doesn't have to trust Hedgehog to pay.
- **Thin books?** Quotes never size past the visible book; that limits cover size today.
- **Did you place real Gemini orders?** No. The backing order is built in code (HMAC Trader API client) but runs dry-run until a funded account is approved.
