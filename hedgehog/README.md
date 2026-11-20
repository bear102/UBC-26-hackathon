# Hedgehog: prediction-market insurance for small businesses

**An AI risk advisor that turns a small business's worst days into prediction-market cover, priced like an insurance quote and bought in one signature on Solana.**

- Live demo: https://178-156-138-228.sslip.io (Solana devnet; a demo wallet with test dollars is created for you, or connect Phantom)
- For judges: [`/how-it-works`](https://178-156-138-228.sslip.io/how-it-works) shows the architecture, trust assumptions and live onchain addresses
- Track: DeFi & Onchain Apps · Best use of Solana · Gemini Prediction Markets bounty · QuickNode Streams bounty

## The problem
A heat wave empties a patio bar. A rained-out Saturday kills a food truck's best day. A home-team loss halves game-night traffic. A fuel spike eats a caterer's margin. These losses are real but too small and too specific for an insurer to write a policy. Prediction markets already price most of these events, but a shop owner won't read an order book.

## What it does
1. **Describe the business**: pick an Austin preset or write one sentence (what you sell, where, when you're busy, monthly budget).
2. **Risk map (AI)**: 3-5 bad days, each with a trigger, an estimated dollar loss and the reasoning.
3. **Market match**: code pulls live contracts from Gemini, Kalshi and Polymarket; the AI may only pick from those contract IDs. Code moves each pick to the cheapest identical contract (near-ties go to Gemini).
4. **Quote**: payout if it happens vs premium if it doesn't, sized to 25/50/100% of the loss, walked against book depth and capped by the monthly budget. Risks with no usable market are listed as uncovered, with the reason.
5. **Buy**: "Cover all" sends one `buy_policy` per line to the `hedgehog_policy` Anchor program, signed in one wallet approval. Premiums go into a public USDC-style vault.
6. **Settle**: a crank reads the venue's official result and settles each policy onchain. A hit pays the owner from the vault. If no result ever arrives, anyone can trigger a premium refund after expiry.

## Architecture
```
 OFFCHAIN (Next.js app + worker)                                    VENUES (read)
 ┌────────────┐   ┌──────────────────┐  candidate IDs  ┌───────────────────────────┐
 │ Owner:     │──▶│ AI risk advisor  │◀───────────────│ Gemini PM  (primary)       │
 │ preset or  │   │ risk map + picks │                 │ Kalshi     (public API)    │
 │ 1 sentence │   │ (≤4 LLM calls)   │                 │ Polymarket (Gamma, check)  │
 └────────────┘   └────────┬─────────┘                 └──────────┬────────────────┘
                           │ picks (IDs only)                     │ prices, depth, results
                  ┌────────▼─────────┐                 ┌──────────▼────────────────┐
                  │ Quote engine     │                 │ Desk + crank (worker)     │
                  │ size, walk book, │                 │ records a backing order   │
                  │ fit budget       │                 │ (Gemini: dry-run); settles│
                  └────────┬─────────┘                 └──────────┬────────────────┘
                           │ co-signed buy tx                     │ settle_policy / expire_policy
 ══════════════════════════╪══════════════════════════════════════╪═══════ SOLANA DEVNET
                  ┌────────▼─────────┐                 ┌──────────▼────────────────┐
                  │ Owner's wallet   │── buy_policy ──▶│ hedgehog_policy (Anchor)  │
                  │ demo / Phantom   │                 │ vault · budget · payouts  │
                  └──────────────────┘                 └──────────┬────────────────┘
                                                                  │ txs touching program/desk/attestor
                  ┌──────────────────┐   webhook       ┌──────────▼────────────────┐
                  │ Live dashboard + │◀────────────────│ QuickNode Stream (devnet) │
                  │ feed             │                 │ Block dataset + JS filter │
                  └──────────────────┘                 └───────────────────────────┘
```

### AI decision loop (deterministic where it matters)
- **LLM**: Claude Sonnet 5.5 via the Anthropic SDK (`lib/ai/llm.ts`), falling back to Gemini 2.5 Flash, then Gemini 3.1 Flash-Lite. At most 4 LLM calls per quote (enforced by a test).
- **The AI cannot invent markets.** Every pick must reference a contract ID that code pulled from a live venue API. Side, month/date window, venue and price are re-checked in code.
- **Sizing and budget are plain code** (`lib/markets/quote.ts`): contracts = coverage% × loss ÷ payout per contract, priced by walking the order book; the monthly budget caps the total premium; no line takes more than 60% of the budget; direct risks are funded before indirect ones.
- Quality loop: 5 QA cycles over 75 test businesses (`tests/matching-qa-c*.test.ts`, `docs/AI-EVAL.md`).

## Onchain (Solana devnet)
| What | Address |
|---|---|
| `hedgehog_policy` program | [`4H7QHtz77V8oFuGSeXAEwCrSAph7VFNb667zk5SiRbNe`](https://explorer.solana.com/address/4H7QHtz77V8oFuGSeXAEwCrSAph7VFNb667zk5SiRbNe?cluster=devnet) |
| Underwriter PDA | [`721j9YwEbiQmqdwXibDMSxuFZ27xeb1CMUNANiMngeQT`](https://explorer.solana.com/address/721j9YwEbiQmqdwXibDMSxuFZ27xeb1CMUNANiMngeQT?cluster=devnet) |
| Premium / payout vault | [`9UhtStNo26nFuF2TNNuamNripCLnMjCGPwkrWtcV7LUx`](https://explorer.solana.com/address/9UhtStNo26nFuF2TNNuamNripCLnMjCGPwkrWtcV7LUx?cluster=devnet) |
| Test-dollar mint (USDC stand-in) | [`FBa3PR7p418SfViu9e6NR1th5MnhpdwYfC2HFt8ed1iJ`](https://explorer.solana.com/address/FBa3PR7p418SfViu9e6NR1th5MnhpdwYfC2HFt8ed1iJ?cluster=devnet) |
| Attestor (quoter + settler) | [`5LQKRaTS8nkd1ag37huyKVNBc5iaFDRG1LnCYTvCu5Es`](https://explorer.solana.com/address/5LQKRaTS8nkd1ag37huyKVNBc5iaFDRG1LnCYTvCu5Es?cluster=devnet) |

Live state: `GET /api/cover/info` (vault balance, exposure, free capacity, policies sold).

Program (`programs/hedgehog_policy/src/lib.rs`, Anchor 0.31.1):
- `buy_policy`: must be co-signed by the quoter key, so the buyer cannot set their own price. The program can enforce a rolling 30-day budget, but the app registers businesses with an effectively unlimited one, so the owner's budget only sizes the quote. Refuses cover the vault can't pay (`payout ≤ vault − exposure`, and under `max_exposure`).
- `settle_policy(outcome)`: attestor only. YES pays the owner from the vault; NO closes the policy.
- `expire_policy`: **anyone** can call it after expiry + grace if the attestor never settled; the premium is refunded.
- Also `init_underwriter`, `fund_vault`, `set_underwriter`, `register_business`, `set_budget`.
- Security audit: [`docs/FLOW-AUDIT.md`](docs/FLOW-AUDIT.md). Two critical holes (unsigned pricing; cross-underwriter vault drain) were reproduced against the deployed binary and fixed in place.

### Real-market settlement on devnet
Policy #3 was written on Gemini's `GEMI-WXHIGH-LTAC-2611192059-15TO15` (daily high). Gemini resolved it YES; the crank settled it and the vault paid 3.00 test dollars to the owner: [settle tx](https://explorer.solana.com/tx/2tB5XkKf3MMhL3n7bwjS14Yh1MYsyUThPgTQaZS3A6pLFJFPNyDdDP54iBei2NuQUjmubTCNfHdPFknFgmMDMx2s?cluster=devnet). More settlements (paid and unpaid) are in [`docs/SETTLEMENT.md`](docs/SETTLEMENT.md).

## Gemini Prediction Markets
- **Primary pricing venue.** Public API: `/v1/prediction-markets/events` (active and settled), `/events/{ticker}`, `/v1/book/{symbol}` (`lib/markets/geminiPm.ts`). Quotes use bid/ask, implied probability and a book walk for depth.
- **Routing in code**: when the same contract trades on several venues, the cheapest wins and near-ties go to Gemini; an AI pick on Kalshi is moved to the identical Gemini contract when it is no dearer.
- **Settlement from Gemini's result**: the crank pays from Gemini's `resolutionSide`. Measured lags are in `docs/SETTLEMENT.md` (daily highs about 6 h after the day ends).
- **Backing order on Gemini**: every Gemini-priced sale records a matching order for the Trader API (`POST /v1/prediction-markets/order`, HMAC-signed, IOC limit at ask + 2¢) in `lib/venue/geminiHedge.ts`. **These are dry-run: no live Gemini order has been placed.** Live mode needs a funded account, keys and `HEDGE_LIVE=1`.
- Backtest for heat/cold risks from Gemini's settled daily-high markets (last 30 days), via `events?status=settled` (`hitRate` in `lib/markets/index.ts`).

## QuickNode Streams
| | |
|---|---|
| Network | Solana **devnet** |
| Dataset | Block |
| Filter | [`docs/quicknode-filter.js`](docs/quicknode-filter.js): keeps successful txs that touch the `hedgehog_policy` program, the attestor or the desk |
| Destination | Webhook `POST /api/qn-webhook` ([route](app/api/qn-webhook/route.ts)), authenticated by QuickNode's HMAC signature (`QN_SECURITY_TOKEN`) or a shared-secret header; idempotent by tx signature |
| Why | The dashboard feed shows "policy bought" and "policy settled" from the chain itself, not from our own API's say-so |

Events delivered so far are stored as `source: "quicknode"` feed items (policy bought, policy settled, transfers). The app's devnet RPC is also a QuickNode endpoint, with public devnet as fallback (`lib/solana/connection.ts`).

## Economic design and risk assumptions
- **Premium** = market ask × contracts (book walked for depth). No Hedgehog fee in the demo.
- **Capacity**: the vault only sells cover it can pay in full; exposure is tracked onchain.
- **Budget**: the owner's budget sizes the quote. The program supports an onchain 30-day budget cap, but the app doesn't use it to block purchases.
- **Backing**: Hedgehog is the counterparty. In production each sale is offset by the same contract on Gemini, so a payout is funded by the hedge. In this build that backing is recorded, not placed (dry-run).
- **Basis risk**: the market measures the airport, not your patio; a loss is not an empty bar. Every line shows its mismatch note.
- **Settlement trust**: one attestor key posts results from the venue's official resolution. This is not trustless. The escape hatch is the permissionless refund after expiry. Next: oracle or multisig attestor.
- **Liquidity**: Gemini books are thin; quotes never size past the visible book.
- **Not an insurer**: this is a devnet prototype of the product, with test dollars.

## Limits (honest list)
- Devnet only, test dollars; nothing touches mainnet.
- Gemini backing orders are dry-run. Kalshi and Polymarket backing is recorded only.
- Kalshi data comes from Kalshi's public API; the DFlow client is written but DFlow's metadata API needs a key we don't have.
- The public demo runs `next dev` on a single server.

## Run it
```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY and/or GEMINI_API_KEY; SOLANA_RPC_URL; USDC_MINT
npm run dev                  # http://localhost:5390
npm run worker               # settlement crank (every 60 s)
npm test                     # node test runner, tests/*.test.ts
npm run typecheck
```
Program: `programs/` (Anchor 0.31.1; `anchor build`, then `anchor test` runs `tests/cover.test.ts`). Devnet setup scripts: `scripts/init-underwriter.ts`, `scripts/fund-vault.ts`. End-to-end checks: `scripts/smoke-api.ts`, `scripts/smoke-cover-all.ts`.

## Built with
Solana devnet · Anchor 0.31.1 · SPL Token · @solana/web3.js · Solana Wallet Adapter (Wallet Standard: Phantom, Solflare, etc.) · Gemini Prediction Markets API · Kalshi public API · Polymarket Gamma API · QuickNode Streams + QuickNode Solana RPC · Next.js 15 · React 19 · TypeScript · Claude Sonnet 5.5 (Anthropic SDK) · Google Gemini 2.5 Flash (fallback LLM) · NWS and Open-Meteo weather data · Zod

## Docs
- [`docs/DESIGN.md`](docs/DESIGN.md): design record from the start of the build
- [`docs/FLOW-AUDIT.md`](docs/FLOW-AUDIT.md): money-flow security audit and fixes
- [`docs/SETTLEMENT.md`](docs/SETTLEMENT.md): settlement lags, crank, onchain evidence
- [`docs/AI-EVAL.md`](docs/AI-EVAL.md): AI matching evaluation
