# Hedgehog v2 — Design (2026-11-19, 00:00 CST)

> One line: **an AI risk advisor that turns a small business's worst days into prediction-market hedges, priced like an insurance quote, bought with one signature on Solana.**

Deadline: Fri Nov 20, 12:00 CST (submit target 10:00 CST). Finals Sat Nov 21, UT Austin.

## 1. Decisions (from the user, 2026-11-19)
| Topic | Decision |
|---|---|
| Team | Hedgehog is solo (Spendthrift not entering), so no bounty conflicts |
| Main track | **DeFi & Onchain Apps** |
| Chain award | **Best use of Solana** (DeFi pool) |
| Bounties | **Gemini Prediction Markets**, **QuickNode Streams**. Not: ElevenLabs, Grok, Arc |
| Market venues | Gemini = primary pricing/data. Kalshi (via DFlow, on Solana) = read **and** one-click buy. Polymarket = read-only (stretch) |
| Execution | Advice only on Gemini (deep link to the market). DFlow/Kalshi buys are built by the app and **signed by the owner's own wallet** (small real mainnet buys, $1–5, each approved by the user) |
| Onchain policy program | Anchor program on **devnet only**, test USDC, no link to the mainnet buys |
| Personas | 3 Austin presets + free-text box |
| Intake | Chat sentence + short form |
| Sizing | Coverage % of the estimated loss (25/50/100) **capped by** a monthly hedge budget |
| LLM | Provider-agnostic: Claude (primary) → Gemini → OpenAI fallback |
| Name | Keep "Hedgehog" |
| Hosting | Decide later (build locally first) |
| Network plan | **Devnet first, everything.** Mainnet (real DFlow buy) is the last, optional step, only with the user's approval |

## 2. How each prize is hit (put these in the README)
- **Gemini PM bounty:** Gemini's live prediction-market book is the pricing engine. Every quote shows Gemini bid/ask, depth and implied probability. The Austin daily-high, Spurs/Texans games and WTI oil markets are the hero hedges. The settled-history endpoint backtests "how often would this hedge have paid?" Deep link to the Gemini market.
- **DeFi track:** a new primitive, *parametric business insurance assembled from prediction markets*. It composes with DFlow (Kalshi outcome SPL tokens). The README covers the economics: sizing, premium, basis risk, venue risk, liquidity limits.
- **Best use of Solana:** (a) real hedges are SPL outcome tokens bought via DFlow on mainnet, signed in Phantom; (b) the `hedgehog_policy` Anchor program on devnet is the "Hedgehog Cover" product, an onchain policy book with a USDC premium vault, budget mandate and parametric payout.
- **QuickNode Streams:** a Stream on Solana mainnet, filtered to the owner wallet's DFlow outcome-token mints/accounts, delivers to our webhook. That feeds the live coverage dashboard ("hedge filled", "market resolved: YES", "payout redeemed $X"). If Streams supports devnet, a second filter covers `hedgehog_policy` program events. The README lists network, dataset, filter, destination and why.

## 3. User flow (the 2-minute demo path)
1. **Pick a business**: preset card (Rainey St patio bar / East Austin food truck / catering + delivery) or "Describe your business".
2. **Intake**: one chat sentence plus a form with avg daily revenue, busy days, ZIP, monthly hedge budget.
3. **Risk map (AI)**: 3–5 risks, each with trigger, estimated $ loss per event, and the reasoning shown. E.g. "Over 98°F in Austin on a Saturday → patio traffic −40% → ~$1,100 lost."
4. **Market match (AI + search)**: for each risk, the best live markets across Gemini / Kalshi-DFlow / Polymarket(read). Shows venue, contract, ask, implied probability, depth and basis-risk note ("measured at Camp Mabry, not Rainey St").
5. **Quote (the insurance view)**: per risk, the cover (payout if it happens), premium (cost if it doesn't), contracts and venue. Coverage slider 25/50/100%; the total is capped by the budget, so the AI re-allocates to the best payout per dollar. "Uncoverable" risks are listed honestly.
6. **Act**:
   - Kalshi/DFlow: **"Buy hedge"** → app builds the tx → Phantom signs → SPL outcome tokens in the owner's wallet.
   - Gemini: **"Open on Gemini"** deep link with exact contract + qty (advice only).
   - **"Hedgehog Cover"** (devnet): pay the premium in test USDC into the policy program and get a parametric policy (see §6).
7. **Coverage dashboard**: open hedges, live P&L, settlement status. QuickNode webhook events stream in. Settled ones show "paid $X vs lost $Y".

## 3b. Devnet-first plan (user decision 2026-11-19)
DFlow has no devnet: its "dev" API (`dev-quote-api.dflow.net`, `dev-prediction-markets-api.dflow.net/api/v1`) is a rate-limited, key-free test API that still builds **mainnet** txs. So:
- **Venue adapter interface** `Venue { listMarkets(); quote(market, side, qty); buildBuyTx(owner, market, side, qty) -> base64 tx; redeem(owner, market) }`.
- `MockDflowVenue` (devnet, default): real prices from Gemini + the DFlow metadata API (read-only). A desk keypair owns one YES/NO SPL mint pair per hedged market on devnet. `buildBuyTx` returns a tx partially signed by the desk (owner pays test USDC → desk; desk mints outcome tokens → owner) that the owner signs in Phantom. Settlement: the crank reads the real resolution; `redeem` burns winning tokens and pays 1 test USDC each.
- `DflowVenue` (mainnet): the same interface against the real DFlow Trade API. It's switched on by `VENUE=dflow`, used only in the final real-buy step.
- QuickNode: Streams on devnet if supported; else QuickNode Webhooks (devnet documented) until the mainnet switch.

## 4. Architecture
```
Next.js app (UI + API routes)                     worker (tsx, same repo)
 ├─ /api/advise    LLM risk map + market match     ├─ market indexer: Gemini events (30s), DFlow markets (60s)
 ├─ /api/quote     sizing + budget allocation       ├─ settlement crank: resolves devnet policies from venue outcomes
 ├─ /api/dflow/tx  build unsigned DFlow buy tx      └─ QuickNode webhook consumer → events table
 ├─ /api/qn-webhook  QuickNode Streams destination
 └─ wallet adapter (Phantom) for mainnet buy + devnet policy txs
Store: SQLite (or JSON in .data/) — businesses, plans, hedges, events
External: Gemini PM public API · DFlow Metadata + Trade API · Polymarket Gamma API (read) · NWS (forecast context) · LLM (Claude/Gemini/OpenAI)
Chain: Solana mainnet (DFlow tokens, QuickNode Stream) · Solana devnet (hedgehog_policy program, test USDC)
```

### AI decision loop (deterministic where it matters)
1. **LLM call 1, risk map**: business profile → JSON `{risks:[{id, peril, trigger, location, window, lossUsd, lossReasoning, confidence}]}`. Schema-validated, retried once, falls back to the preset's hand-written risk map.
2. **Candidate search (code, not LLM)**: an index of live markets with normalized tags (peril: heat/rain/game/oil/gas/fed/cpi; location; date). Filtered by peril + location + window.
3. **LLM call 2, match + explain**: risk + top ~15 candidates → picks contract(s), side (YES/NO), and a basis-risk note. Every pick must reference a candidate ID from step 2, so it cannot invent markets.
4. **Sizing (code)**: `contracts = ceil(coverage% × lossUsd / payoutPerContract)`, `premium = contracts × ask` (walks the book for depth). Budget cap: greedy by `payout/premium`. Rejects asks > 0.85 (too expensive to be "insurance") and depth < contracts (shows "max coverable").
5. **Output**: quote JSON + human summary. The LLM provider is chosen by env; on error it falls through to the next provider.

## 5. External APIs (verify each at H0; the [?] items are unverified)
- **Gemini PM (verified 2026-11-18/19):** `GET /v1/prediction-markets/events?status=active&limit=100&offset=N`, `/events/{ticker}`, `/events/recently-settled`, `/v1/book/{symbol}`. Live now: 400 events (347 sports, 38 crypto, 10 daily-high weather incl. Austin/Dallas, 5 commodities incl. WTI/Brent). Client: reuse `v1-promos/lib/hh/gemini.ts`.
- **DFlow [?]:** Metadata API (market discovery, prices) + Trade API (returns unsigned Solana tx to buy outcome tokens/redeem). Dev endpoints need no key (rate-limited); production needs a DFlow key. Outcome tokens: separate YES/NO mints, winner redeems $1. Source: QuickNode guide "Kalshi prediction markets with DFlow", solana.com/news/dflow-prediction-markets-api. **Gate G1.**
- **Polymarket Gamma [?]:** public read of markets (stretch).
- **QuickNode Streams [?]:** Solana mainnet confirmed in the guide; devnet unconfirmed. JS/Go filter → webhook. **Gate G3.**
- **NWS:** forecast context for heat/rain risk (verified in v1).

## 6. `hedgehog_policy` Anchor program (devnet, test USDC)
"Hedgehog Cover": Hedgehog acts as underwriter, selling parametric cover from a USDC vault (in production it would back its book with prediction-market hedges, which is the DFlow path above).

Accounts
- `Underwriter` PDA `["uw"]`: authority, attestor pubkey, USDC vault (ATA owned by PDA), total exposure, max exposure.
- `Business` PDA `["biz", owner]`: owner, monthly budget (USDC), spent this period, period start.
- `Policy` PDA `["pol", business, policy_id]`: peril code, market ref (venue + ticker string, ≤64 bytes), trigger text hash, premium, payout, expiry, status {Open, PaidOut, Expired}.

Instructions
- `init_underwriter(attestor, max_exposure)`, `fund_vault(amount)`
- `register_business(monthly_budget)`, `set_budget(monthly_budget)`
- `buy_policy(policy_id, peril, market_ref, premium, payout, expiry)`: transfers premium owner → vault; checks budget (rolling 30d), checks `payout ≤ vault − exposure`; exposure += payout.
- `settle_policy(outcome: bool)`: attestor only; if YES, transfers payout vault → owner ATA and sets PaidOut; else Expired. Exposure −= payout.
- `expire_policy()`: anyone, after expiry + grace, if not settled → refund premium (protects owner if the attestor disappears).

Errors: `BudgetExceeded`, `InsufficientCapacity`, `NotAttestor`, `AlreadySettled`, `NotExpired`, `BadParams`.
Attestor = our crank: reads the venue resolution (Gemini `resolutionSide` / DFlow/Kalshi result) and posts it. Documented as a trust assumption in the README.

## 7. Presets (all hedgeable with today's live markets; confirm at H0)
| Business | Risk → market |
|---|---|
| **Rainey St patio bar** | Austin high ≥ X°F (Gemini weather) · Spurs/Texans loss on game night (Gemini sports) · rain in Austin (Kalshi/DFlow) |
| **East Austin food truck** | Rain day (Kalshi/DFlow) · extreme heat (Gemini) |
| **Catering + delivery** | WTI oil above $X (Gemini commodities) · US gas price above $Y (Kalshi/DFlow) · Fed/CPI (Kalshi, context) |

## 8. Screens
1. Landing: "What's your worst business day? Hedge it." + 3 preset cards + free text.
2. Intake: chat box + 4-field form.
3. Plan: risk cards → matched market(s) → quote table, coverage slider, budget bar, "uncoverable" section.
4. Checkout: Phantom connect (mainnet for DFlow, devnet for Cover), tx status, explorer links.
5. Dashboard: hedges, live prices, QuickNode event feed, settled results ("lost $1,100 in sales, hedge paid $480").
6. `/how-it-works` for judges: architecture, trust assumptions, addresses.

## 9. Build plan (CST)
| When | Work | Gate |
|---|---|---|
| Thu 00:00–02:00 | H0 checks: DFlow metadata + build an unsigned buy tx (G1), list Kalshi weather/gas markets in DFlow, check QuickNode devnet (G3), install Rust/Solana/Anchor in background | **G1:** DFlow tx builds. Fail → Gemini-only data + devnet Cover is the Solana story |
| Thu 02:00–06:00 | Next.js app skeleton, market indexer (Gemini + DFlow), LLM loop + presets, quote engine | — |
| Thu 06:00–08:00 | **Sleep** / user tasks (wallet, keys, QuickNode) | — |
| Thu 08:00–12:00 | Anchor program + tests (LiteSVM/anchor test), deploy devnet; Cover checkout | **G2:** program deployed, buy+settle work on devnet |
| Thu 12:00–15:00 | Hedge checkout via MockDflowVenue on devnet with Phantom, dashboard | — |
| Thu 15:00–18:00 | QuickNode Stream + webhook → dashboard feed; settlement crank | **G3:** a real event arrives via Streams |
| Thu 18:00–22:00 | Optional mainnet step: `DflowVenue` + one real $1–5 buy (user approval). Polish UI, free-text robustness, `/how-it-works`, README, hosting decision + deploy | — |
| Fri 00:00–07:00 | Sleep; buy a hedge that settles overnight so the demo shows a real payout | — |
| Fri 07:00–10:00 | Record 2–3 min video, Devpost form, make repo public (user says go) | **Submit by 10:00** |

Cut order if behind: Polymarket read → free-text input (presets only) → devnet Cover program UI (keep the program + tests) → QuickNode (switch to polling).

## 10. User-only actions
1. **Now:** put LLM keys in `v2-insurance/.env.local` (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (LLM), `OPENAI_API_KEY`).
2. **Thu morning:** Phantom wallet on **devnet** with test SOL (faucet.solana.com) + test USDC (faucet.circle.com). Mainnet funds (~$10 USDC + ~0.02 SOL) only later, if we do the optional real-buy step.
3. **Thu morning:** QuickNode account → Solana mainnet endpoint + Streams access; give me the API key.
4. **Thu (optional):** DFlow production API key if dev endpoints rate-limit.
5. **Thu evening:** hosting decision (domain to point at this server's Caddy, or Vercel login).
6. **Fri:** video recording, Devpost submission, "make repo public".

## 11. Risks
- **DFlow access** (geo/KYC limits on Kalshi tokens for US users, API changes). Mitigation: G1 at H0; fallback = show the built tx + simulation and keep the Cover program as the Solana story.
- **Thin Gemini books**: show depth and "max coverable"; never quote beyond the book.
- **Basis risk** (airport temp ≠ patio temp; a loss ≠ empty bar): shown on every quote and called out as the honest part of the pitch.
- **LLM hallucinating markets**: impossible by construction (picks must be candidate IDs).
- **Regulatory** (selling "insurance"): the app is an advisor + self-directed hedges; the devnet Cover program is a prototype of the long-term vision. Mention it in Q&A.
- **Attestor trust** in the Cover program: single-key attestor, refund-on-expiry escape hatch; future work = oracle/multisig.

## 12. Open items I'll resolve myself at H0
DFlow endpoint URLs and response shapes; which Kalshi series cover Austin rain / US gas; QuickNode Streams network list; Anchor version (latest stable that builds with installed Rust).
