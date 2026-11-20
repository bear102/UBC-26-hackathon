# Finals pitch: 5 min + 2 min Q&A

Sat Nov 21, UT Austin. Judged on Technical Execution, Product & UX, Innovation, Impact & Potential, Demo.
Shape: **story (45 s) → live demo (3 min) → why it's real (45 s) → close (30 s)**. About 600 spoken words; the demo carries the rest.

## Before you walk on (do Saturday morning)
- [ ] Site loads: https://178-156-138-228.sslip.io (and /dashboard).
- [ ] Laptop: browser at 110-125% zoom, bookmarks bar hidden, notifications off, one tab per step (below), demo wallet already created and funded.
- [ ] Open the demo plan and press **Refresh prices** (Friday's day markets have closed). If a line is gone, press **Re-run AI** now, not on stage.
- [ ] A policy that settled Saturday morning (bought Friday evening) is on the dashboard, so you can show a live payout. Otherwise use policy #3 (Gemini daily high, paid 3.00).
- [ ] Backup: `hedgehog-demo-v2.mp4` downloaded locally. If the network dies, play it and talk over it.

**Tabs, in order:** ① home `?fx=1` · ② the pre-made plan (San Antonio sports bar) · ③ dashboard · ④ SolanaFM settle tx for policy #3.

## Script

### 0:00–0:45 · The problem (tab ①, home hero)
> "A taco truck in Austin loses a whole Saturday when it rains. A sports bar by the Spurs arena loses its late-night tab every time the Spurs lose at home. These are real, predictable losses: a few hundred to a few thousand dollars, a few times a year.
> No insurer will write a policy that small. But prediction markets already price exactly these events: tomorrow's rain, tonight's game, next week's high. The business owner just can't use them. They don't know which contract matches their risk, and they shouldn't have to trade an order book.
> Hedgehog turns those markets into insurance."

### 0:45–1:25 · Describe → AI risk map (tab ②, top of the plan)
Don't wait on a live AI run (~60 s). Show the pre-made plan and say what happened:
> "This sports bar described itself in one sentence. Claude mapped its worst days, each with a trigger, a dollar loss and its reasoning, and asked a couple of quick questions, like whether rain actually hurts the patio.
> The AI can't make up markets. Our code pulls about six thousand live contracts from Gemini, Kalshi and Polymarket. The AI may only choose from that list, and deterministic guards check every pick: right date, right team, right side, right city."

### 1:25–2:25 · The quote (tab ②, scroll)
Point at one line: the Gemini Spurs line.
> "Here's the Spurs line. If New Orleans beats the Spurs at home on Saturday, this bar loses about [$X]. Gemini prices that at about 11 cents per dollar, so cover costs [$Y] and pays [$Z]." *(read the numbers off the card)*
Open **Where the price comes from**:
> "We compare the same contract across venues and the cheapest wins; ties go to Gemini. The whole plan is sized to the owner's budget and to how much is actually for sale in the book. Every line shows its basis risk in plain English."
Scroll to **Pick a plan**:
> "Three plans. The AI's pick is the default."

### 2:25–3:10 · Buy (tab ②, Cover all)
> "One click: Cover all. One wallet approval buys every policy from our Solana program."
Approve, show the receipt.
> "Our quoter co-signs every sale, so nobody can change the price. The premium goes into a public vault, and the program refuses to sell cover the vault can't pay."

### 3:10–3:55 · Proof it pays (tabs ③ and ④)
Dashboard:
> "The policy shows up right away. QuickNode Streams watches our program on chain and pushes every sale and payout into this live feed."
SolanaFM settle tx:
> "And here's one that paid out. This policy was written on a Gemini temperature market. Gemini resolved it, our crank settled it on Solana, and the vault paid the owner. No claim form, no adjuster."
*(If a Saturday-morning policy settled, show that one instead: "this one paid out this morning.")*

### 3:55–4:30 · Why it's real
> "What's built and working on devnet: the Anchor program with vault, quoter and refund escape hatch; three live market feeds with best-price routing; a Claude risk advisor tested on 75 different businesses over five rounds of grading and fixes; a QuickNode stream; and an onchain tax record for the owner's accountant.
> What's honest: test dollars, one attestor key, and backing orders on Gemini that run dry-run until an account is funded. We say so on the site."

### 4:30–5:00 · Close
> "Prediction markets already price the bad days for every small business in America. Hedgehog is the first product that sells those prices to the business as insurance: priced on Gemini, Kalshi and Polymarket, paid on Solana.
> Insurance for your worst business day. Thank you."

## Q&A (2 min): short answers
- **Isn't this just a prediction-market UI?** No. The owner never sees a contract. They get a quote in dollars sized to their loss and budget, and a policy with an onchain payout.
- **How is the AI kept honest?** It can only pick contract IDs our code fetched. Deterministic guards reject the wrong date, month, team, sport, city, high vs low temperature, and wrong-side picks. We graded 75 businesses across 5 cycles and fixed about 80 root causes.
- **Basis risk?** Real: the airport weather station isn't your patio. Every line says so, and cover is a share of the estimated loss, not a promise to make you whole.
- **Who settles? Is it trustless?** Not fully. One attestor key posts the venue's official result. If no result ever arrives, anyone can trigger a refund after expiry. Next step: a multisig or oracle.
- **Prior art (Etherisc, Arbol, Nexus Mutual)?** They build their own oracles and capital pools per peril. We reuse markets that regulated venues already price and resolve, so a new peril needs no new oracle or pool.
- **How do you make money?** A spread between the premium and the backing hedge, or a small fee per policy. The demo charges no fee.
- **Is it legal insurance?** Not as built. It's a devnet prototype. The path is either an advisor with self-directed hedges, or a licensed partner writing the cover.
- **Why Solana?** Cheap, fast, and public: the vault balance, exposure and every payout are verifiable, and the refund doesn't depend on us. A policy costs a fraction of a cent to write.
- **Thin order books?** We never size past the visible book, so cover per line is limited today. More volume on the venues means bigger cover.
- **What does a quote cost you?** About $0.14 of Claude API per quote (4 calls max), with Gemini as fallback.
- **Did you place real Gemini orders?** No. The signed Trader API client is built; backing runs dry-run until a funded account is approved.

## If something breaks on stage
- AI or plan won't load → "Here's one we ran earlier" → play the video from 0:32.
- Wallet approval fails → show the receipt and dashboard from the earlier purchase; say "here's the same flow from this morning."
- Network down → play `hedgehog-demo-v2.mp4` and narrate.
