# Hedgehog

> **"Your drink's on us if the Spurs lose": hedged on Gemini, guaranteed onchain.**
> Any Austin bar, coffee cart or food truck types one sentence and gets a promo it can sell in 30 seconds. The promo is priced from Gemini's live prediction-market book and hedged on Gemini **before the first sale**. Customers' refunds sit in a Solana escrow and land as dollars the customer owns.

UBC 2026 Hackathon · **Track:** Consumer Apps · **Chain award:** Best use of Solana · **Bounty:** Gemini Prediction Markets

- Live app: `PUBLIC_URL` (TBD) · Demo video: (TBD)
- Program (devnet): [`6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf`](https://explorer.solana.com/address/6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf?cluster=devnet)

## What it does (one path)

1. **Owner types one sentence** ("sports bar on Guadalupe, $6 drafts, game nights"). An LLM maps it to ≤3 promise cards built **only from live Gemini events** (server-validated; templates if the model is slow or wrong). Every number on a card comes from Gemini's order book, not the model: cost per receipt (Σ ask), fair value (Σ mid), spread, max receipts (book depth), and the chance customers get paid.
2. **Owner taps "Lock & hedge".** `create_promise` locks `cap × refund` USDC in a vault PDA the merchant can't touch. The hedge agent sends one IOC batch to Gemini for the first tranche (10 receipts' worth), the attestor reads the position back and posts `attest_hedge(OPEN)`, and capacity becomes 10.
3. **Cashier taps [New sale]** → one single-use QR (90 s). The customer scans: no app, no signup, no wallet words. The browser makes a key, and the server issues a receipt PDA (the merchant pays fees and rent).
4. **No hedge, no promise.** Receipt #11 reverts onchain with `Unhedged (6002)`. That revert is the agent's demand signal: it buys the next tranche on Gemini, re-attests, and the same phone retries and gets its receipt.
5. **Sales close** → the attestor re-reads positions (CUTOFF, sweeps, PRESETTLE). The minimum held fraction is written to the merchant's onchain track record.
6. **Gemini resolves** → the relayer posts `attest_outcome(winning_symbol, canonical_hash)`. On YES anyone can crank: the customer's USDC account is created and $1 is pushed in the same transaction. On NO the merchant gets the vault back.
7. **The customer sees "$1.00 is yours"** → *Spend it here* / *Cash out* (the merchant co-signs as fee payer) / *Verify with Gemini* (the browser re-hashes Gemini's JSON and compares it with the onchain outcome hash).

## Architecture

```
Next.js app (one process)                      Gemini                      Solana devnet
 /merchant      scan → cards → lock&hedge  ──▶ public: events, /v1/book    program hedgehog_promise
 /merchant/p/id console, attacks, crank        private (HMAC):             Merchant PDA (track record)
 /counter/id    cashier [New sale] → QR          order/batch (IOC)         Promise PDA + Vault (USDC)
 /r/code        customer receipt, $1 is yours    positions, orders/history Receipt PDAs
 /p/id          public page, Verify            Anthropic Messages API      7 instructions
 worker (instrumentation.ts): hedge agent · attestor · relayer · cranker
 store: .data/hedgehog.json
```

## Solana program (`programs/hedgehog_promise`, Anchor 0.31.1)

| Instruction | Who | What |
|---|---|---|
| `create_promise` | merchant | locks `cap × refund_units` USDC in the vault PDA; validates strip, amounts, times |
| `attest_hedge(phase)` | attestor key (compile-time constant) | OPEN sets `hedged_capacity`; CUTOFF/PRESETTLE keep `held_bps_min` (never increases) |
| `issue_receipt` | merchant | reverts `SalesClosed` / `SoldOut` / **`Unhedged`** (`sold + 1 > hedged_capacity`) |
| `attest_outcome` | relayer key (constant) | YES iff Gemini's winning contract is in the strip; writes the merchant track record once |
| `refund_crank` | anyone | pays up to N receipts per tx; **skips** dead token accounts instead of failing the batch; pays YES after a 72 h relayer timeout |
| `release` | merchant | only: nothing sold · settled NO with a CUTOFF attestation · settled YES and all refunded (or 7-day grace) |
| `close_receipts` | merchant | returns receipt rent after payout or NO |

Accounts: `Merchant ["merchant", authority]`, `Promise ["promise", authority, id]`, `Vault ["vault", promise]` (token account, authority = promise PDA), `Receipt ["receipt", promise, index]`.
Invariants tested: vault ≥ outstanding liability; `sold ≤ hedged_capacity ≤ cap` at every issue; vault funds only go to a receipt holder's ATA or (under `release` rules) back to the merchant; each receipt refunded once; no issue after sales close; `held_bps_min` monotone; one bad customer account can't block a crank.

**Why Solana:** refunds are pushed to anonymous holders (customers never sign up), 5 per transaction including creating their token accounts; the merchant is the fee payer for every customer action; receipt PDAs are the eligibility list.

Tests: `npm run test:program` (13 LiteSVM tests with clock warp: happy YES/NO, Unhedged, SalesClosed, SoldOut, LiabilityLocked, UnauthorizedAttestor, StaleAttestation, held-bps monotonicity + hedge break, dead-ATA skip, relayer timeout, release escapes, validation, overflow, settled-vector replay of `WXHIGH-AUS-2611170459`).

## Gemini Prediction Markets integration

- Public: `GET /v1/prediction-markets/events?search=…` (the paginated list omits events; search is reliable), `/events/{ticker}`, `GET /v1/book/{instrumentSymbol}` for depth.
- Private (HMAC-SHA384, two Trader keys with separate nonces): `/v1/prediction-markets/order/batch` (IOC limit buys), `/positions` and `/orders/history` (attestor's own key).
- **Hedge-gating rule:** the program will not issue receipt *n* unless an attestation of Gemini positions covers *n* receipts.
- Settlement: `resolutionSide` drives the outcome; the canonical hash is `sha256(JSON.stringify(sortKeysDeep({ticker, resolvedAt, contracts:[{instrumentSymbol, resolutionSide}] sorted})))`. Test vector: `WXHIGH-AUS-2611170459` → `4c0985315ecd2b18bf22532d8da14eb4a423a4756ca2a7dfa5242084d46dee82`.
- Gemini's own contract text is the customer's terms (hashed onchain as `terms_hash`).
- Depth evidence (Nov 18-19): 1,500 "Spurs lose" contracts cost $165-$217 on the live book.

## Agent safety (the agent spends real money)

IOC limit orders only, limit ≤ ask + $0.02 · Σask ≤ $0.75 per $1 of payout · never hedges more than the liability cap · daily budget (`DAILY_BUDGET_USD`, default $25) · no automatic buy retries without re-reading positions · halts on any 401/403/terms error · "Stop agent" button · its keys have no withdrawal role · the attestor uses a separate key and process path.

## Trust model (disclosed)

In the demo our team is the merchant and also runs the attestor and relayer. Neither Solana key can move vault funds. If the relayer goes silent, customers are paid after 72 h. A false "NO" is publicly checkable from the receipt (Verify). The hedge is **attested, not custodied**: order ids are published in `/p/<id>/hedge.json` (Gemini can confirm them); real enforcement needs a locked hedge account at Gemini.

**Honesty lines:** refunds are devnet test USDC; hedges are Gemini contracts. Receipts in our runs went to our team and friends. `PAPER-` order ids are simulated fills against Gemini's live public book, used only while API keys were unavailable, and are labelled in every screen.

## Setup

```bash
npm install
# program
anchor build -- --tools-version v1.57 && anchor deploy --provider.cluster devnet
npm test                      # unit + LiteSVM program tests
# app (+ worker, started by instrumentation.ts)
cp .env.example .env.local    # fill keys; never commit
npm run build && npm start    # port 5380
```

Env: `SOLANA_RPC_URL`, `USDC_MINT`, `PUBLIC_URL`, `HH_ADMIN_TOKEN` (merchant login: open `/api/login?t=<token>`), `GEMINI_API_KEY_A/SECRET_A` (agent), `GEMINI_API_KEY_B/SECRET_B` (attestor), `HEDGE_MODE` (`live`|`paper`), `DAILY_BUDGET_USD`, `PRICE_CEILING`, `LIMIT_SLIPPAGE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`. Keypairs live in `keys/` (git-ignored).

Local end-to-end without devnet SOL: `npx tsx scripts/localnet-accounts.ts`, run `solana-test-validator --bpf-program <id> target/deploy/hedgehog_promise.so --account-dir .data/localnet`, start the app with `SOLANA_RPC_URL=http://127.0.0.1:8899`, then `npx tsx scripts/e2e.ts <ticker> <symbol…>`.
