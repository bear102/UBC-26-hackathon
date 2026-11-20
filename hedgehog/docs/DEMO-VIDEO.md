# Demo video: final cut (2:12)

File: `public/demo-assets/hedgehog-demo-v5.mp4` (served at https://178-156-138-228.sslip.io/demo-assets/hedgehog-demo-v5.mp4; not in git).
Devpost asks for 2-3 minutes. Built by script from clips recorded at 2880×1620 with logged clicks: title card → 13 sections (click zooms, section label, captions, voiceover) → outro, with crossfades. Each section lasts exactly as long as its line.

## Sections and voiceover (in order)
| # | Label | Footage | Line |
|---|---|---|---|
| 1 | — | Home hero animating in | A rainy Saturday can wipe out a week of profit for a food truck or a patio bar. No insurer writes a policy that small. But prediction markets already price days like that. |
| 2 | Describe your business | Form typed, quick question, quote reveal | Hedgehog turns those markets into insurance. I describe my business in one sentence. Claude maps my risks and asks a quick question or two about how the business runs. |
| 3 | Any business | Food truck rain line, caterer diesel line, sports bar Spurs line | It works for any business: a food truck gets rain cover, a caterer hedges diesel, a sports bar hedges a home loss. |
| 4 | Live market quote | Schedule, Gemini Spurs card, venue compare, Plan B | Every risk gets a dollar loss and a live contract on Gemini, Kalshi or Polymarket. Our code pulls the markets; the AI can only choose from those, and the cheapest venue sets the price. It shows exactly what I pay, and what I get if the bad day comes. And the whole plan fits my budget. |
| 5 | Honest about limits | Natural hedges, Not coverable | It's honest about what it can't cover. Coin-flip prices and loose links stay out of the plan, and it tells you what not to hedge: a Spurs win already helps this bar. |
| 6 | You stay in control | Plan A/B/C, coverage 25/50/100, edit loss | The owner stays in control: pick a plan, choose how much of each loss to cover, or correct the AI's estimate, and the quote re-prices instantly. |
| 7 | Buy on Solana | Demo wallet, Cover all, receipt, tx | One click covers everything. One wallet approval buys every policy from our Solana program. The premium sits in a public vault that only sells cover it can actually pay. |
| 8 | Priced & backed on Gemini | Gemini best-price row, backing order, markets explorer | Gemini is our primary venue. When it has the best price, the policy is priced on Gemini and matched with a backing order there: a dry run on devnet today. |
| 9 | Live feed · QuickNode Streams | Dashboard + live feed | My cover shows up right away. QuickNode Streams watches our program on chain and pushes every policy and payout into this live feed. |
| 10 | Automatic payout | Policy #3 settle tx (vault −3, owner +3) | When the market resolves, the policy settles itself. This one was written on a Gemini temperature market. Gemini resolved it, and the vault paid the owner. No claim form. |
| 11 | On-chain trust | Vault + program on SolanaFM, refund clause | Everything that matters is on chain: the vault, its exposure limit and every policy. If a market never resolves, anyone can trigger the refund. |
| 12 | Tax record from the chain | Tax table + CSV | And the owner gets a tax record straight from the chain. |
| 13 | — | How it works → home | Hedgehog. Insurance for your worst business day, priced by prediction markets and paid on Solana. |

## Optional clips from you (copy to `/root/hedgehog-voice/` on the server)
- Your voice: one file per line above, named `01`…`13` in this table's order (any audio format).
- A real Phantom approval (~8 s): replaces part of section 7.
- Your QuickNode "ubc26" stream page (~8 s): network, dataset, filter, destination; goes in section 9.
- A face intro (~5 s), before section 1.

## Do not show
Policy #7 (`hedgehog:hail`), e2e fixtures as real payouts, `/wallet-debug`, `.env` files or keys.
