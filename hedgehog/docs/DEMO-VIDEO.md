# Demo video: 2:00 plan

The Devpost video must be 2-3 minutes (YouTube or Drive). We aim for **2:00**: under 2:10, never over 3:00.
Screen clips are recorded by script (headless Chromium, 1920×1080, visible cursor) into `demo-assets/clips/`. Stills go in `demo-assets/shots/`.
You record **one voiceover track** (script below), plus two optional clips.

## Shot list

| # | Time | Clip | Screen (what happens) | Voiceover (≈150 words/min) |
|---|---|---|---|---|
| 1 | 0:00–0:12 | `01-hook.mp4` | Home hero: the certificate, a slow scroll to "Pick a business" | "A rainy Saturday can wipe out a week of profit for a food truck or a patio bar. No insurer writes a policy that small. But prediction markets already price days like that." |
| 2 | 0:12–0:32 | `02-describe.mp4` | "Describe yours": type a one-line patio bar in Austin → the AI's question (multi-select weather) → answer → progress screen (the ~60 s wait is cut in the edit) | "Hedgehog turns those markets into insurance. I describe my business in one sentence. Claude maps my risks and asks a quick question, like which weather actually hurts me." |
| 3 | 0:32–1:00 | `03-plan.mp4` | Plan: the risk list with dollar losses → one risk card (if it happens / if it doesn't) → "Where the price comes from" venue compare → Plan B "AI pick" selected → budget line | "Every risk gets a dollar loss and a live contract on Gemini, Kalshi or Polymarket. Our code pulls the markets; the AI can only choose from those, and the cheapest venue sets the price. It shows exactly what I pay, and what I get if the bad day comes. And the whole plan fits my budget." |
| 4 | 1:00–1:20 | `04-buy.mp4` | Create demo wallet → Cover all → approve → "Covered" receipt → Solana Explorer tx page | "One click covers everything. One wallet approval buys every policy from our Solana program. The premium sits in a public vault that only sells cover it can actually pay." |
| 5 | 1:20–1:38 | `05-dashboard.mp4` | Dashboard "Your cover" → the live feed with the new policy and its "QuickNode" event | "My cover shows up right away. QuickNode Streams watches our program on chain and pushes every policy and payout into this live feed." |
| 6 | 1:38–1:52 | `06-settle.mp4` | Explorer: policy #3 settle tx ([2tB5…Mx2s](https://explorer.solana.com/tx/2tB5XkKf3MMhL3n7bwjS14Yh1MYsyUThPgTQaZS3A6pLFJFPNyDdDP54iBei2NuQUjmubTCNfHdPFknFgmMDMx2s?cluster=devnet)), zoomed on the vault → owner 3.00 transfer | "When the market resolves, the policy settles itself. This one was written on a Gemini temperature market. Gemini resolved it, and the vault paid the owner. No claim form." |
| 7 | 1:52–2:00 | `07-close.mp4` | /how-it-works hero, or back to the home hero with the logo | "Hedgehog. Insurance for your worst business day, priced by prediction markets and paid on Solana." |

Spare B-roll, in case a section runs short or needs covering: `b-markets.mp4` (markets explorer, Gemini/Kalshi/Polymarket side by side), `b-mobile.mp4` (the plan at phone width), `b-tax.mp4` (onchain tax record + CSV).

## What you film (only you can)
1. **Voiceover (required).** Read the right-hand column in one take per section, in a quiet room, phone or laptop mic about 15 cm away. Leave about 1 s of silence between sections. 7 short files or one long file both work. Total ≈ 245 words ≈ 1:45 of speech; the visuals fill the rest.
2. **Optional: a 5-10 s face intro** ("Hi, I'm … and this is Hedgehog"). Only if you want a face on it. It can replace the first line of section 1.
3. **Optional: a real Phantom approval** on your own machine (10 s): on the plan page press Cover all and approve in the Phantom popup. Judges for the Solana prize like seeing a real wallet. The scripted clip uses the built-in demo wallet, which has no popup.

## Editing
Use any editor (CapCut, iMovie, DaVinci). Lay the clips in order, put your voiceover on top, and trim each clip to its line. Cut the AI wait in clip 2 to about 1 s with a "≈60 s later" caption. Export at 1080p and upload to YouTube (unlisted is fine). Add the link to Devpost and the README.

## Do not show
Policy #7 (`hedgehog:hail`), e2e test fixtures presented as real payouts, the `/wallet-debug` page, `.env` files, or any API key.
