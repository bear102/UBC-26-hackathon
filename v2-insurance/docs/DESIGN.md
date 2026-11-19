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
| Market venues | **"Sold on Solana, hedged on Gemini"** (decided 2026-11-19 01:30, see §3c). Gemini = primary venue: it prices the cover **and** is where the desk backs it. Kalshi (via DFlow) = only for perils Gemini doesn't list (rain, gas, Fed, CPI) or where Gemini has no usable ask. Polymarket = read-only context + cross-venue price check (built) |
| Execution | Gemini **and** Kalshi lines are one-click buys of Solana devnet outcome tokens (mock venue) or a Cover policy, signed by the owner's wallet. For Gemini-priced sales the desk records a **backing order on Gemini** (dry-run by default; live only with `GEMINI_TRADE_KEY`/`GEMINI_TRADE_SECRET` + `HEDGE_LIVE=1`, which needs the user's approval). "Open on Gemini ↗" stays as a secondary link. The optional real mainnet buy is still Kalshi/DFlow only ($1–5, user-approved) |
| Onchain policy program | Anchor program on **devnet only**, test USDC, no link to the mainnet buys |
| Personas | 3 Austin presets + free-text box |
| Intake | Chat sentence + short form |
| Sizing | Coverage % of the estimated loss (25/50/100) **capped by** a monthly hedge budget |
| LLM | Provider-agnostic: Claude (primary) → Gemini → OpenAI fallback |
| Name | Keep "Hedgehog" |
| Hosting | Decide later (build locally first) |
| Network plan | **Devnet first, everything.** Mainnet (real DFlow buy) is the last, optional step, only with the user's approval |

## 2. How each prize is hit (put these in the README)
- **Gemini PM bounty (data + trading):** Gemini is the primary venue. Its live books price the cover (bid/ask, depth, implied probability, book-walk sizing); candidate ranking prefers Gemini and a deterministic router moves an AI pick from Kalshi to the identical Gemini contract when it is no dearer. Every Gemini-priced sale creates a **backing order on Gemini** via the Trader API (`POST /v1/prediction-markets/order`, HMAC-signed, IOC limit at ask+2¢). The orders are shown on the dashboard and in the feed, and are dry-run until the desk account is funded. Settled-history endpoint backtests "how often would this hedge have paid?". Hero hedges: Austin daily highs, Spurs games, WTI/Brent.
- **DeFi track:** a new primitive, *parametric business insurance assembled from prediction markets*, with the insurer/reinsurer split done onchain/offchain: risk is **sold on Solana** (outcome tokens, Cover policies, USDC vault) and **hedged on Gemini** (the regulated CLOB). It composes with DFlow (Kalshi outcome SPL tokens). The README covers the economics: sizing, premium, basis risk, venue risk, desk solvency, liquidity limits.
- **Best use of Solana:** (a) every hedge, Gemini- or Kalshi-priced, is an SPL outcome token signed for in Phantom (devnet desk; DFlow on mainnet for Kalshi); (b) the `hedgehog_policy` Anchor program on devnet is the "Hedgehog Cover" product, an onchain policy book with a USDC premium vault, budget mandate and parametric payout.
- **QuickNode Streams:** a Stream on Solana mainnet, filtered to the owner wallet's DFlow outcome-token mints/accounts, delivers to our webhook. That feeds the live coverage dashboard ("hedge filled", "market resolved: YES", "payout redeemed $X"). If Streams supports devnet, a second filter covers `hedgehog_policy` program events. The README lists network, dataset, filter, destination and why.

## 3. User flow (the 2-minute demo path)
1. **Pick a business**: preset card (Rainey St patio bar / East Austin food truck / catering + delivery) or "Describe your business".
2. **Intake**: one chat sentence plus a form with avg daily revenue, busy days, ZIP, monthly hedge budget.
3. **Risk map (AI)**: 3–5 risks, each with trigger, estimated $ loss per event, and the reasoning shown. E.g. "Over 98°F in Austin on a Saturday → patio traffic −40% → ~$1,100 lost."
4. **Market match (AI + search)**: for each risk, the best live markets across Gemini / Kalshi-DFlow / Polymarket(read). Shows venue, contract, ask, implied probability, depth and basis-risk note ("measured at Camp Mabry, not Rainey St").
5. **Quote (the insurance view)**: per risk, the cover (payout if it happens), premium (cost if it doesn't), contracts and venue. Coverage slider 25/50/100%; the total is capped by the budget, so the AI re-allocates to the best payout per dollar. "Uncoverable" risks are listed honestly.
6. **Act**:
   - Gemini or Kalshi line: **"Buy hedge"** → app builds the tx → Phantom signs → SPL outcome tokens in the owner's wallet. Gemini lines then get a desk backing order on Gemini (dry-run), shown in checkout and on the dashboard. "Open on Gemini ↗" stays as a secondary link.
   - Polymarket line: read-only context (link out). Lines carry a **Cross-check** chip: "Polymarket 11%" when the same game or threshold trades there.
   - **"Hedgehog Cover"** (devnet): pay the premium in test USDC into the policy program and get a parametric policy (see §6).
7. **Coverage dashboard**: open hedges, live P&L, settlement status. QuickNode webhook events stream in. Settled ones show "paid $X vs lost $Y".

## 3b. Devnet-first plan (user decision 2026-11-19)
DFlow has no devnet: its "dev" API (`dev-quote-api.dflow.net`, `dev-prediction-markets-api.dflow.net/api/v1`) is a rate-limited, key-free test API that still builds **mainnet** txs. So:
- **Venue adapter interface** `Venue { listMarkets(); quote(market, side, qty); buildBuyTx(owner, market, side, qty) -> base64 tx; redeem(owner, market) }`.
- `MockDflowVenue` (devnet, default): real prices from Gemini + the DFlow metadata API (read-only). A desk keypair owns one YES/NO SPL mint pair per hedged market on devnet. `buildBuyTx` returns a tx partially signed by the desk (owner pays test USDC → desk; desk mints outcome tokens → owner) that the owner signs in Phantom. Settlement: the crank reads the real resolution; `redeem` burns winning tokens and pays 1 test USDC each.
- `DflowVenue` (mainnet): the same interface against the real DFlow Trade API. It's switched on by `VENUE=dflow`, used only in the final real-buy step.
- QuickNode: Streams on devnet if supported; else QuickNode Webhooks (devnet documented) until the mainnet switch.

## 3c. Venues: "Sold on Solana, hedged on Gemini" (decision 2026-11-19 01:30 CST)
Why: Gemini PM is a CFTC-regulated, account-based CLOB with no onchain representation; Kalshi reaches Solana only via DFlow. Before this change only Kalshi lines were buyable, so quotes were mostly Kalshi (Gemini's competitor), which hurt the Gemini bounty pitch. Insurers sell cover and reinsure it elsewhere, so we use the same split.
- **Pricing/ranking** (`lib/markets/index.ts`): Gemini gets +0.6. In a peril/day/place slot (or game) that Gemini covers with a usable ask (≤0.85, spread ≤0.20, depth ≥5 when known), Kalshi contracts get −1.5. Kalshi stays on top when Gemini has no ask, only >0.85, or an empty book (e.g. Spurs–Pelicans today).
- **Routing** (`lib/markets/quote.ts` `routeToGemini`): if the AI picks a Kalshi contract and the identical Gemini contract (same game + YES team, or same day/place + same bounds; daily high ≠ daily low) costs ≤ Kalshi + 1¢, the leg is re-pointed and the rationale says so. This is code, not the LLM.
- **Execution**: the devnet desk mints outcome tokens for the Gemini contract at its live ask (`lib/venue/mock.ts`, unchanged). After `/api/hedge/confirm` or `/api/cover/confirm`, `lib/venue/geminiHedge.ts` plans the backing order (same symbol and outcome, qty = contracts or payout, IOC limit = ask + 2¢ rounded up, ≤ 0.99). It stores the order in `.data/hedges.json`, emits `Desk hedge on Gemini (dry-run): BUY 5 YES GEMI-… @ $0.13`, and serves it at `GET /api/hedge/backing`. The order is placed live only with `HEDGE_LIVE=1` plus both trade keys.
- **Trust assumptions** (shown on /how-it-works): the desk is a counterparty. Solvency rests on the offsetting Gemini position plus the USDC vault, whose balance anyone can check onchain. Cover keeps refund-on-expiry. The backing is dry-run until funded.
- **Residual risks**: (1) basis between our token and the Gemini fill is zero when filled (same contract), but slippage, partial fills and unfilled IOC orders leave the desk exposed. These are recorded as `partial`/`rejected`/`error`. (2) Gemini books are thin, so sizing already caps at depth. (3) Settlement timing: the crank pays from Gemini's `resolutionSide`, while the desk's Gemini payout arrives in USD on Gemini (treasury rebalancing is offchain, as for any reinsurer).
- **Polymarket** (`lib/markets/polymarket.ts`): Gamma `/markets` by tag (NBA/NFL moneylines, Fed, Inflation incl. US gas, Oil), cached for 60s, failures return []. It adds read-only candidates (ranked −2, never spending budget) and attaches `QuoteLine.crossCheck` (Polymarket's probability that the line pays; exact match for games, "similar" for thresholds).

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
- **Polymarket Gamma (verified 2026-11-19):** `GET https://gamma-api.polymarket.com/markets?closed=false&tag_id=<745 NBA|450 NFL|159 Fed|702 Inflation|309 Oil>&end_date_min=…&end_date_max=…[&sports_market_types=moneyline]`. No key is needed. `outcomes`/`outcomePrices` are JSON strings, and `bestAsk`/`bestBid` quote outcome[0]. `/events` pages with limit >50 need gzip, and NBA events carry ~500 prop markets, so we use `/markets`. There are no Texas city weather markets.
- **Gemini Trader API (not yet keyed):** `POST /v1/prediction-markets/order {symbol, orderType:"limit", side:"buy", outcome, price, quantity, timeInForce}`, HMAC-SHA384 headers (client adapted from v1 `geminiPrivate.ts`). It needs a funded account plus keys from the user.
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
