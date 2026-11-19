# Hedgehog: build-ready spec

> Status: build spec **v2** (red-team revision), Wed 2026-11-18 ~19:45 UTC (H0 + 0.75 h). v1 written ~19:30 UTC. Every red-team item is mapped in §12; judge answers in §13.
> H0 = Wed 2026-11-18 13:00 CST (19:00 UTC). Submission deadline = H47 = Fri 2026-11-20 12:00 CST (18:00 UTC).
> All times are CST (UTC-6) unless marked Z.
> Source design: `ideas/current/Hedgehog.json` (avg 8.20). This spec resolves the last round of critic objections (see §0.3).

---

## 0. Decisions this spec locks (read first)

### 0.1 What changed vs the 8.20 design, and why

| # | Change | Driven by | Evidence |
|---|---|---|---|
| D1 | **Track = Consumer Apps** (was DeFi). DeFi is the fallback. | past-winners, jaded and sponsor all said the artifact is consumer-shaped. The user's current focus is 3 projects (Hedgehog, the Spendthrift money-back wallet, the Shed grid-computing project), and 2 of the 3 ship. Spendthrift and Shed both sit in Agentic, so Hedgehog never collides on track. Earshot/Edge402 were deprioritized by the user (the MEMORY.md index line is stale). | `ideas/build/Spendthrift.md` §0 (Agentic, no Gemini PM), `ideas/build/Shed.md` (Agentic) |
| D2 | **One hero moment: receipt #11 bounces `Unhedged`, the agent buys the next tranche on Gemini, the same phone retries and succeeds.** The recorded payout is the proof, not the hero. Cold rerun and Mattress Mack are cut from the pitch and kept for Q&A. | jaded #2, demo-engineer #8 | — |
| D3 | **Attacks cut to 3 live** (Unhedged is the hero; LiabilityLocked; UnauthorizedAttestor). SalesClosed and the hedge-reduced flip are shown as one **recorded** clip from Thursday's Spurs run. | demo-engineer #8, past-winners #4 | Real sell-back needs a bid. Clippers bid 0.13 × 388 was verified 19:21Z, but weather bins are thin. |
| D4 | **Hedge-held is attested, not custodied, and we say so.** (a) `release` (merchant gets the vault back) **requires a CUTOFF attestation** when anything was sold, so a merchant can't dodge its hedge record. (b) After sales close the attestor re-reads positions at CUTOFF, every 15 min, and at PRESETTLE (PRESETTLE is now **never cut**), and the promise keeps the **minimum** held fraction (`held_bps_min`). (c) The Merchant PDA's **onchain track record** (`cutoff_held_full`, `hedge_breaks`) is written **once, at `attest_outcome`**, from that minimum, so a sell-back at any point before settlement counts as a break. Honest limit: positions sit in the merchant's own Gemini account, so a sale between two reads (≤15 min) or a sale in the Gemini web UI is caught only at the next read. Real enforcement needs Gemini custody (a locked hedge sub-account or settle-to-address), which is our ask to Gemini. Line: "The vault protects the customer. The hedge record protects the merchant from its own agent, and it is what earns a smaller lock later." | sponsor #1, past-winners #3, red team H5/H4 | — |
| D5 | **Liquidity claim corrected with live depth.** Books are NOT 20-40 deep. Clippers YES asks are **750 @ 0.14 and 2,520 @ 0.15**. Each Austin weather bin has **100 at top of book** on both sides. A 300-cover × $5 Spurs night (1,500 contracts) fills **today** for **$217.50**. Weather promos cap at about 100 receipts. | demo-engineer #1, past-winners #2, sponsor #5 | `GET /v1/book/{symbol}`, 2026-11-18 19:21Z (§4.1) |
| D6 | **The "paying twice" answer, in 10 seconds (corrected):** "The vault is a deposit, not a cost. If the Spurs win, the vault comes back to the merchant the same night. If they lose, the vault pays the customers and Gemini pays the merchant $1 per contract in its Gemini account, so the merchant ends the night whole minus the premium, just in two places. Capital needed is the liability plus the premium (1.15×), not 2×." We state that the Gemini payout lands in USD at Gemini, not in the vault; moving it back is a withdrawal (roadmap: Gemini USDC withdrawal, unverified). | jaded #5, past-winners #8, red team judge Q1 | — |
| D7 | **Auditor-REST is dead.** The Gemini docs say Get Positions and Get Order History need the **Trader** role. Only WebSocket `positions@account` accepts Auditor. Decision: the **attestor uses its own Trader-role key** on the merchant's Gemini account, separate from the ordering agent's key. It is disclosed, has no Fund Manager role (so it can't withdraw), and lives in a separate process. Nonces stay independent. The Auditor WS path is an optional H2 experiment, not a dependency. | demo-engineer #6, research finding 3 | developer.gemini.com pages fetched 2026-11-18 (§4.2) |
| D8 | **Order type = IOC** (`immediate-or-cancel`) via `/order/batch`, not GTC plus a 30-s cancel. This removes the cancel client from the critical path. | scope | Place Batch Orders doc: `timeInForce` enum |
| D9 | **Relayer timeout favors customers.** If no outcome is posted by `expected_resolve_ts + 72 h`, `refund_crank` treats the promise as YES. The relayer can't hold refunds hostage. Its only possible misbehaviour is a false NO, which is publicly detectable through Verify. **Accepted cost:** if a game is cancelled and Gemini's Market Outcome Review Process runs past the timeout (or resolves NO later), the merchant pays the customers and may also lose the hedge. This is disclosed in the terms as a merchant risk, like any money-back promo. The relayer never posts while Gemini shows a cancelled or under-review state (§5.4). | jaded #8, demo-engineer #9, red team H8 | live Clippers contract text (fetched 2026-11-18): cancellations go to the Market Outcome Review Process |
| D10 | **The Kalshi line is softened** to "Every one of these was hand-built, unescrowed, and gave customers no proof." We make no claims about Kalshi's process. | past-winners #6 | — |
| D11 | **Honesty lines are fixed text** (§7.4): devnet refunds vs real hedges are stated once, plainly. Run receipts are "issued to our team and friends". The weather pair is "sold to different customers; one side was certain to pay, on purpose, so you could see a real payout". "Spend it here" shows a **balance and a transfer**, not a counter discount. | all four critics | — |
| D12 | **Program attestor and relayer pubkeys are compile-time constants**, so no config instruction is needed. Key rotation means a program upgrade. The upgrade authority is disclosed. The program has **7 instructions** (v2 adds `close_receipts`, D17). | scope | — |
| D13 | **Receipts need a cashier tap.** The counter shows a QR only after the cashier taps **[New sale]** on the merchant-authenticated counter screen. One tap gives one single-use code with a 90-s TTL. The code endpoints need the counter session token. Free entry: the cashier hands one code to anyone who asks, without a purchase (the "no purchase necessary" route), still one per tap. | red team H1, judge Q3 | — |
| D14 | **Lazy customer ATA.** `issue_receipt` no longer creates the customer's USDC account. It only checks that `holder_ata` is the canonical ATA of `holder`. The cranker creates ATAs idempotently **in the same transaction** as `refund_crank`, only on YES nights. This removes ATA rent on NO nights (~86% of Spurs nights) and makes a customer-closed ATA harmless (it gets recreated in the payout tx). The program also **skips** a pair whose ATA is not a live USDC token account instead of failing the batch. | red team B4, H3 | — |
| D15 | **Release escapes.** `release` also succeeds (i) any time `sold == 0` (cancel a failed hedge or an unused promise), and (ii) on `SETTLED_YES` when `now > resolved_at + RELEASE_GRACE (7 d)`, even with unrefunded receipts (unclaimable dust goes back to the merchant). No customer can lock a vault forever. | red team B4, H9 | — |
| D16 | **Stable public origin is mandatory before Run #1.** The customer key lives in `localStorage` for that origin, and the QR and backup links embed `PUBLIC_URL`. No quick tunnels. U6 is now required by H19 (named Cloudflare tunnel on a domain the user controls, or an ngrok free static domain). | red team B5 | — |
| D17 | **`close_receipts`** (7th instruction, merchant-only) closes refunded receipts, or any receipt of a `SETTLED_NO`/`CLOSED` promise, and returns the rent to the merchant. Receipt rent is a float, not a cost. It sits at cut-list position 5 (if cut, it is described as roadmap and the economics slide counts receipt rent as a cost). | red team H3, judge Q5 | — |
| D18 | **Auto top-up threshold can be disabled** (`topup_threshold = -1` means top up only after an `Unhedged` revert). Stage and Run #2 use -1. The v1 value 0 would have bought the tranche at sold=10 and killed the hero. | red team B2 | — |
| D19 | **Price ceiling on Σask, not Σlimit.** The guard is `Σ ask_i ≤ PRICE_CEILING (0.75)` per $1. Slippage is bounded separately by `limit_i = ask_i + 0.02` and by the budget guard. The "74°F or warmer" strip (Σask 0.65) passes. | red team B3 | — |
| D20 | **The end-to-end test settles on a fresh event tonight:** `WXHIGH-AUS-2611190459` (Austin high on Nov 18; verified active 19:38Z; expiry 04:59:59Z Nov 19; expected resolution ~Thu 05:02 CST = H16). The H0 gate buys **1 contract in each of its 6 bins** (Σask 1.26 at 19:38Z), so a strip of all 6 bins is a certain YES. The test promise uses `refund_units = $0.10`, cap 10 → 1 contract per bin covers 10 receipts, which exercises a full 10-receipt crank. **Timing risk:** `attest_outcome` needs `resolved_at ≥ sales_close_ts`, and NWS report publication varies, so the test promise is created **as soon as the program is on devnet** with `sales_close = create + 20 min`, target before 03:30 CST. If Gemini resolves before our sales close, the test is void (the $1 stays locked until the D9 timeout) and G3 falls back to the clock-warp path. Clock-warp tests in LiteSVM cover the settled `2611170459` vector. | red team B1 | `GET /events/WXHIGH-AUS-2611190459` 19:38Z: asks 72TO73 0.70, 70TO71 0.43, HI74 0.09, 68TO69 0.02, LO65 0.01, 66TO67 0.01 |

### 0.2 One-liner, track, prizes, opener

- **One-liner:** *Hedgehog lets any Austin bar, coffee cart or food truck say "your drink's on us if the Spurs lose". It prices and hedges the promise on Gemini before the first sale and pays the refunds automatically from a Solana escrow.*
- **Main track:** Consumer Apps (crypto invisible: customers scan a QR, install nothing, pay nothing extra, and end up holding $1). **Fallback:** DeFi & Onchain Apps, if the user prefers. The README covers both checklists (§8).
- **Chain award:** Best use of Solana (custom Anchor program, hedge-gated issuance, pushed refunds to anonymous holders, fee-payer UX).
- **Bounties:** Gemini Prediction Markets (primary: real production fills on Gemini weather and NBA books, Gemini's contract text as the consumer terms, `resolutionSide` as the trigger). Official UBC Winner (automatic). Not targeted: QuickNode, ElevenLabs, Grok.
- **15-second opener (verbatim):**
  > "Hedgehog: game-day promos for Austin bars, hedged on Gemini, with refunds guaranteed onchain. *[beat]* Bars love 'your drink's on us if the team loses'. It fills seats. Last summer bars in New York, Chicago, DC and San Francisco made the news hedging those promos on prediction markets. Every one was hand-built, unescrowed, and gave customers no proof. We made it one sentence."

### 0.3 Critic objections → where answered

| Objection | Answer location |
|---|---|
| Too crowded for 5 minutes | D2, D3, §7.1 (8 beats, 1 hero) |
| Devnet refunds vs real hedges | D11, §7.4 line H1, §10 R3 |
| Weather pair is staged | D11, §7.4 line H3 |
| Paying twice (escrow + hedge) | D6, §7.4 line H4 |
| Gate is decorative | D4, §3.4 `release` check, Merchant PDA |
| Liquidity vs economics | D5, §4.1 depth table |
| Track | D1, open question Q1 |
| Single point of failure (Gemini prod API) | §9 gate G1 *tonight*, user actions U1-U4 |
| Trust = Hedgehog's keys | §3.6 trust table, D9, Verify (§6.4) |
| Attack #5 needs a bid | D3 (Spurs/Clippers only, bid verified) |
| Kalshi overstatement | D10 |
| WS positions is a stream, not a snapshot | D7 (REST Get Positions with a Trader key) |
| Bandwidth to run a cart and a party | §9 owners; receipts from team and friends (D11) |
| Legal one-liner | §7.4 line H5, D13 |
| Free receipts / QR farming | D13, §6.3 |
| Vault griefing by a customer | D14, D15 |
| Merchant sells hedge after cutoff | D4 (min held fraction, record at settle; custody limit stated) |
| Grid computing / money-back wallet scope | D1: they are the sibling specs `Shed.md` / `Spendthrift.md`; 2 of 3 ship (Q7) |

---

## 1. Product summary (one complete path)

1. **Owner types one sentence** → the LLM maps it to ≤3 promise cards built from **live Gemini events only** (template fallback).
2. **Owner taps "Lock & hedge"** → `create_promise` locks `cap × $1` devnet USDC in a vault PDA → the agent sends a Gemini `/order/batch` IOC buy for a 10-receipt tranche → the attestor reads positions and calls `attest_hedge(OPEN)` → capacity = 10.
3. **Cashier taps [New sale]** → the counter shows a one-time QR → **customer scans** → `/r/[code]` makes a browser keypair → the server (one issuance at a time per promise) calls `issue_receipt` (merchant pays fees and receipt rent; no customer token account yet). The program reverts `Unhedged` if `sold+1 > hedged_capacity`. The agent tops up on demand.
4. **At sales cutoff** the attestor re-reads positions → `attest_hedge(CUTOFF)` → the held fraction and the merchant track record are written.
5. **Gemini resolves** → the relayer posts `attest_outcome(winning_symbol, canonical_hash)` (this also writes the merchant's hedge record) → on YES, a `refund_crank` tx creates the customers' USDC accounts and pushes $1 to 10 receipts per transaction. On NO, the merchant calls `release`. Afterwards `close_receipts` returns receipt rent to the merchant.
6. **The customer sees "$1.00 is yours"** → Spend it here (transfer to the merchant) / Cash out (any address) / Verify with Gemini (browser re-hash).

---

## 2. Architecture

```
                         ┌─────────────────────────────── EXTERNAL ───────────────────────────────┐
                         │ Gemini PUBLIC  api.gemini.com  /v1/prediction-markets/events[/{ticker}]│
                         │                                /v1/book/{instrumentSymbol}              │
                         │ Gemini PRIVATE api.gemini.com  /v1/prediction-markets/order/batch      │
                         │   (HMAC-SHA384)                /v1/prediction-markets/positions        │
                         │                                /v1/prediction-markets/orders/history   │
                         │                                /v1/prediction-markets/order (sell-back)│
                         │ Anthropic Messages API (card scan, tool schema)                        │
                         │ Solana devnet RPC api.devnet.solana.com  ·  Circle devnet USDC mint    │
                         └────────────────────────────────────────────────────────────────────────┘
                                    ▲ public reads           ▲ signed orders / reads      ▲ txs
┌──────────────── FRONTENDS (Next.js 15, same app) ────────────────┐   ┌────── OFFCHAIN SERVICES (Node, tsx) ──────┐
│ /merchant            scan → cards → lock&hedge → promise console │   │ api routes (Next, same process)           │
│ /merchant/p/[id]     capacity meter, orders, attest timeline,     │──▶│  /api/scan  /api/promises  /api/receipts │
│                      crank / release / attack panel               │   │  /api/cosign  /api/attacks/[n]           │
│ /counter/[id]        full-screen rotating one-time QR             │   │                                           │
│ /r/[code]            customer receipt (browser keypair,           │   │ hedge-agent   (Gemini TRADER key A)       │
│                      badges, $1 is yours, spend/cash-out, Verify) │   │   prices strips, IOC batch buys, top-ups, │
│ /p/[id]              public promise page (judges, Explorer links) │   │   sell-back (attack), budget guard        │
└──────────────────────────────────────────────────────────────────┘   │ attestor      (Gemini TRADER key B, read  │
                                                                         │   only by code path; Solana ATTESTOR key)│
                                                                         │ relayer       (Solana RELAYER key)        │
                                                                         │ cranker       (Solana CRANK key, any key) │
                                                                         │ worker.ts = scheduler for the 3 above     │
                                                                         │ store: .data/hedgehog.json (JSON, 1 host) │
                                                                         └───────────────────────────────────────────┘
                                                      │ txs
                                                      ▼
                    ┌──────────── SOLANA DEVNET: program `hedgehog_promise` (Anchor) ─────────────┐
                    │ Merchant PDA (track record) · Promise PDA · Vault token PDA · Receipt PDAs   │
                    │ ix: create_promise, attest_hedge, issue_receipt, attest_outcome,             │
                    │     refund_crank, release, close_receipts (D17)                              │
                    │ SPL Token (Circle devnet USDC 4zMMC9…DncDU) · Associated Token program       │
                    └──────────────────────────────────────────────────────────────────────────────┘
```

**Hosting decision:** one Linux host (this box or a small VPS) runs `next start` and `npm run worker`. It is exposed over HTTPS on a **stable hostname** (D16): a Cloudflare **named** tunnel on a domain the user controls, or an ngrok free static domain. Quick tunnels are banned because the hostname changes on restart, which would orphan every customer's `localStorage` key and printed QR. `PUBLIC_URL` is frozen before Run #1, and the worker refuses to start if `PUBLIC_URL` contains `trycloudflare.com`. It is not Vercel, because the JSON store and the long-running worker need one process host. Judges' phones hit the public URL over cellular, so conference wifi only affects the stage laptop.

**Repo layout to add** (existing repo `blockchainHackathon26`, Next 15, `lib/` reused):
```
programs/hedgehog_promise/        Anchor program (Cargo workspace at repo root: Anchor.toml, Cargo.toml)
tests/hedgehog_promise.ts         anchor tests (local validator)
lib/hh/catalog.ts                 live series catalog from Gemini public API
lib/hh/pricing.ts                 strip pricing, depth caps, tranche sizing (pure, unit-tested)
lib/hh/canon.ts                   canonical resolution hash (shared browser+server)
lib/hh/geminiPrivate.ts           HMAC client: batchOrder, order, positions, orderHistory (2 key profiles)
lib/hh/program.ts                 Anchor client wrappers + PDA helpers + IDL
lib/hh/store.ts                   hedgehog state (promises, codes, orders, attestations, budget)
lib/hh/scan.ts                    LLM card scan (Anthropic, tool schema) + templates
scripts/h0-gate.ts                H0 production fill test
scripts/worker.ts                 attestor + relayer + cranker scheduler
scripts/attacks.ts                prebuilt attack txs
app/merchant/…, app/counter/[id], app/r/[code], app/p/[id], app/api/…
```
Existing `lib/gemini.ts` public helpers (`activeEvents`, `eventByTicker`) are reused. Its `priv()` HMAC function moves into `geminiPrivate.ts` with a key-profile argument.

---

## 3. Onchain program `hedgehog_promise` (Anchor 0.31.x, Solana devnet)

### 3.1 Constants
```rust
pub const USDC_MINT: Pubkey  = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // Circle devnet USDC, 6 dp (verified §4.4)
pub const ATTESTOR: Pubkey   = pubkey!("<filled at H4 from keys/attestor.json>");
pub const RELAYER: Pubkey    = pubkey!("<filled at H4 from keys/relayer.json>");
pub const MAX_STRIP: usize   = 6;
pub const MAX_SYMBOL: usize  = 48;     // e.g. "GEMI-WXHIGH-AUS-2611200459-74TO75" = 33 bytes
pub const MAX_TICKER: usize  = 40;     // e.g. "NBA-2611200100-LAC-SAS-M" = 24
pub const MAX_CAP: u32       = 500;
pub const CENTI_MICROS: u64  = 10_000; // 0.01 contract × $1 = 10_000 µUSDC
pub const RELAYER_TIMEOUT: i64 = 72 * 3600;
pub const ATTEST_MAX_SKEW: i64 = 300;
pub const RELEASE_GRACE: i64 = 7 * 24 * 3600; // D15
```
Feature flag `demo-clock`: off. Program tests use LiteSVM `set_sysvar::<Clock>` (arbitrary unix time, so the settled `2611170459` vector can be replayed), not a flag. Devnet end-to-end uses the fresh event in D20.

### 3.2 Accounts

**Merchant**, PDA seeds `["merchant", authority]`. Created with `init_if_needed` in `create_promise`.

| field | type | bytes |
|---|---|---|
| discriminator | — | 8 |
| authority | Pubkey | 32 |
| promises_created | u32 | 4 |
| promises_closed | u32 | 4 |
| cutoff_held_full | u32 | 4 (written at `attest_outcome`: `held_bps_min == 10000`) |
| hedge_breaks | u32 | 4 (written at `attest_outcome`: `held_bps_min < 10000`, or sold > 0 with no post-close attestation) |
| receipts_issued | u64 | 8 |
| refunds_paid | u64 | 8 (count) |
| bump | u8 | 1 |
| **total** | | **73** (rent ≈ 0.00140 SOL) |

**Promise**, PDA seeds `["promise", authority, promise_id.to_le_bytes()]` (`promise_id: u64`, chosen by the server as a unix-ms timestamp).

| field | type | bytes | notes |
|---|---|---|---|
| discriminator | — | 8 | |
| merchant | Pubkey | 32 | merchant authority |
| promise_id | u64 | 8 | |
| vault | Pubkey | 32 | |
| event_ticker | String (≤40) | 44 | Gemini event ticker |
| strip_len | u8 | 1 | 1..=6 |
| strip | [[u8;48];6] | 288 | instrumentSymbols, zero-padded; promise is YES iff any strip contract resolves yes |
| hedged_centi | [u32;6] | 24 | last attested qty per bin, in 0.01 contracts |
| refund_units | u64 | 8 | µUSDC per receipt (demo: 1_000_000). Must be a multiple of 10_000 |
| cap | u32 | 4 | max receipts = vault lock / refund_units |
| sold | u32 | 4 | |
| refunded | u32 | 4 | |
| hedged_capacity | u32 | 4 | receipts covered per latest OPEN attestation |
| held_bps_cutoff | u16 | 2 | first CUTOFF value, for display |
| held_bps_min | u16 | 2 | minimum over every CUTOFF/PRESETTLE attestation (init 10000); feeds the track record |
| phases_done | u8 | 1 | bit0 OPEN, bit1 CUTOFF, bit2 PRESETTLE |
| premium_micros | u64 | 8 | cumulative premium paid (attested), for display |
| orders_hash | [u8;32] | 32 | sha256 of sorted Gemini orderIds (latest OPEN). **Commitment only**: order ids are private to the account, so third parties can't check it; the ids and fills are published in `/p/[id]/hedge.json` (§6.6) |
| sales_close_ts | i64 | 8 | ≤ event startTime (games) or noon CT (weather) |
| expected_resolve_ts | i64 | 8 | games: startTime + **4.5 h** (measured NBA lag 2h40m-4h16m, §4.1); weather: expiry+6.5h |
| terms_hash | [u8;32] | 32 | sha256(canonical terms JSON, §5.6) |
| status | u8 | 1 | 0 OPEN, 1 SETTLED_YES, 2 SETTLED_NO, 3 CLOSED |
| winning_symbol | [u8;48] | 48 | zeroes = none resolved yes |
| outcome_hash | [u8;32] | 32 | canonical resolution hash (§5.5) |
| resolved_at | i64 | 8 | Gemini event `resolvedAt` (ms → s) |
| created_at | i64 | 8 | |
| bump, vault_bump | u8,u8 | 2 | |
| **total** | | **~739** | use `#[derive(InitSpace)]` (rent ≈ 0.0060 SOL) |

**Vault**: SPL token account, PDA seeds `["vault", promise]`, mint = USDC_MINT, authority = Promise PDA.

**Receipt**, PDA seeds `["receipt", promise, index.to_le_bytes()]` (`index: u32` = `promise.sold` before increment).

| field | type | bytes |
|---|---|---|
| discriminator | — | 8 |
| promise | Pubkey | 32 |
| index | u32 | 4 |
| holder | Pubkey | 32 (customer browser wallet) |
| holder_ata | Pubkey | 32 (must equal the canonical ATA of `holder` for USDC_MINT; may not exist yet, D14) |
| code_hash | [u8;32] | 32 (sha256 of the one-time QR code; audit only) |
| issued_at | i64 | 8 |
| refunded | bool | 1 |
| bump | u8 | 1 |
| **total** | | **150** (rent ≈ 0.00193 SOL) |

Per receipt the merchant fronts 0.00193 SOL of receipt rent (returned by `close_receipts`) + ~0.00001 SOL fees. Only on YES nights does the cranker pay 0.00204 SOL per new customer ATA (that rent goes to the customer with the $1). Budget 1 SOL for receipts and ATAs across all runs.

### 3.3 Errors (`#[error_code]`, in this order, so codes are stable for the UI)
`6000 SalesClosed`, `6001 SoldOut`, `6002 Unhedged`, `6003 LiabilityLocked`, `6004 UnauthorizedAttestor` (wrong attestor OR relayer signer), `6005 AlreadyRefunded`, `6006 NotSettled`, `6007 AlreadySettled`, `6008 InvalidStrip`, `6009 InvalidAmount`, `6010 InvalidTimes`, `6011 TooEarly`, `6012 StaleAttestation`, `6013 ReceiptMismatch`, `6014 WrongMint`, `6015 NotMerchant`.

### 3.4 Instructions

#### 1) `create_promise(promise_id: u64, event_ticker: String, strip: Vec<String>, refund_units: u64, cap: u32, sales_close_ts: i64, expected_resolve_ts: i64, terms_hash: [u8;32])`
Accounts: `authority` (signer, mut, payer), `merchant` (init_if_needed), `promise` (init), `vault` (init, token::mint=usdc_mint, token::authority=promise), `authority_usdc` (mut, token::mint=usdc_mint, token::authority=authority), `usdc_mint`, `token_program`, `system_program`, `rent`.
Checks:
- `usdc_mint == USDC_MINT` (WrongMint)
- `1 ≤ strip.len() ≤ 6`, each symbol `≤48` bytes, starts with `"GEMI-" + event_ticker + "-"`, no duplicates (InvalidStrip)
- `event_ticker.len() ≤ 40` (InvalidStrip)
- `refund_units ≥ 10_000 && refund_units % 10_000 == 0` and `1 ≤ cap ≤ 500` (InvalidAmount)
- `now < sales_close_ts < expected_resolve_ts ≤ now + 72h` (InvalidTimes)

Effects: transfer `cap × refund_units` from `authority_usdc` to the vault (CPI `transfer_checked`, computed in u64 with `checked_mul`). Set every field. `hedged_capacity = 0`, `held_bps_min = 10000`, `status = OPEN`, `merchant.promises_created += 1`. Emit `PromiseCreated{promise, merchant, event_ticker, strip_len, refund_units, cap, sales_close_ts, terms_hash}`.

#### 2) `attest_hedge(phase: u8, qty_centi: Vec<u32>, premium_micros: u64, orders_hash: [u8;32], observed_at: i64)`
Accounts: `attestor` (signer), `promise` (mut). (v2: the merchant account is no longer touched here; the record is written at `attest_outcome`.)
Checks:
- `attestor.key() == ATTESTOR` (UnauthorizedAttestor)
- `promise.status == OPEN` (AlreadySettled)
- `qty_centi.len() == strip_len` (InvalidStrip)
- `|now − observed_at| ≤ 300` (StaleAttestation)
- phase 0 OPEN: `now < sales_close_ts` (SalesClosed). Phases 1 CUTOFF and 2 PRESETTLE: `now ≥ sales_close_ts` (TooEarly).

Effects:
- `per_bin_capacity_i = (qty_centi[i] as u64) × 10_000 / refund_units` (**u64 before multiplying**; u32 overflows above 429,496 centi), `capacity = min(min_i(...), u32::MAX)`.
- OPEN: `hedged_capacity = min(capacity, cap)` (it can go down: a sell-back before cutoff makes later issuance revert). `hedged_centi = qty_centi`, `premium_micros = premium_micros`, `orders_hash = orders_hash`, set bit0.
- CUTOFF / PRESETTLE (may be posted repeatedly until settlement): `held_bps = if sold == 0 {10000} else {min(10000, capacity × 10000 / sold)}` (u64 math). First CUTOFF sets `held_bps_cutoff`. Every one does `held_bps_min = min(held_bps_min, held_bps)` and sets its phase bit. No merchant counters here.
- Emit `HedgeAttested{promise, phase, capacity, held_bps, orders_hash, observed_at}`.

Trust: the attestor can over-report and let the merchant sell unhedged receipts. That harms the **merchant's** P&L, never the customer, because the vault is 100%. The ATTESTOR Solana key can't move vault funds. (Its paired Gemini key B is a Trader key and *could* trade on the merchant's Gemini account; see §3.6.)

#### 3) `issue_receipt(code_hash: [u8;32])`
Accounts: `authority` (signer, mut, fee payer + rent payer), `merchant` (mut, seeds `["merchant", authority]`), `promise` (mut, `promise.merchant == authority`, else NotMerchant), `receipt` (init, seeds use `promise.sold`), `holder` (UncheckedAccount, customer pubkey, **not a signer**), `holder_ata` (UncheckedAccount; must equal `get_associated_token_address(holder, USDC_MINT)`, else ReceiptMismatch; **not created here**, D14), `system_program`.
**Concurrency:** the receipt PDA is seeded by `promise.sold`, so two simultaneous issues collide (`account already in use`, system error 0x0). `/api/receipts` therefore runs a **per-promise FIFO mutex** in the single Next process: read `promise.sold` at `confirmed`, send, await confirmation, release. A collision or unknown error is retried once after a re-read. Anything still unmapped shows "Busy, retrying…" on the phone, never a raw error.
Checks, in this order (the UI maps them):
1. `status == OPEN` (AlreadySettled)
2. `now < sales_close_ts` (**SalesClosed**)
3. `sold < cap` (**SoldOut**)
4. `sold + 1 ≤ hedged_capacity` (**Unhedged**)

Effects: init the receipt `{promise, index: sold, holder, holder_ata, code_hash, issued_at: now}`. `sold += 1`, `merchant.receipts_issued += 1`. Emit `ReceiptIssued{promise, index, holder}`.

#### 4) `attest_outcome(winning_symbol: String, canonical_hash: [u8;32], resolved_at: i64)`
Accounts: `relayer` (signer), `promise` (mut), `merchant` (mut, seeds `["merchant", promise.merchant]`).
Checks:
- `relayer.key() == RELAYER` (UnauthorizedAttestor)
- `status == OPEN` (AlreadySettled)
- `now ≥ sales_close_ts && resolved_at ≥ sales_close_ts` (TooEarly)
- `winning_symbol.len() ≤ 48` (InvalidStrip)

Effects: `status = SETTLED_YES` if `winning_symbol` is non-empty and equals one of `strip[0..strip_len]`, else `SETTLED_NO`. Store `winning_symbol`, `outcome_hash`, `resolved_at`. **Write the track record once:** if `sold > 0`: `(phases_done & CUTOFF != 0 && held_bps_min == 10000) ? merchant.cutoff_held_full += 1 : merchant.hedge_breaks += 1`. Emit `OutcomeAttested{promise, yes: bool, winning_symbol, canonical_hash, resolved_at, held_bps_min}`.
Non-binary outcomes: weather rules say an undeterminable value resolves No. Sports rules send a cancelled game to Gemini's **Market Outcome Review Process**, which can be delayed or non-binary. The relayer only posts when every contract has `resolutionSide ∈ {yes,no}` (§5.4); otherwise D9's timeout applies.

#### 5) `refund_crank()` (permissionless)
Accounts: `cranker` (signer, pays the tx fee only), `promise` (mut), `vault` (mut, seeds `["vault", promise]`), `merchant` (mut, **seeds `["merchant", promise.merchant]`**, so a cranker can't credit another merchant's counters), `token_program`, `usdc_mint`. `remaining_accounts` = up to **10 pairs** `(receipt [mut], holder_ata [mut])`.
Checks:
- `status == SETTLED_YES`, **or** (`status == OPEN && now > expected_resolve_ts + RELAYER_TIMEOUT`), in which case set `status = SETTLED_YES` first (customer-favoring timeout, D9). Otherwise NotSettled.
- For each pair: the receipt is owned by the program, deserializes, `receipt.promise == promise.key()`, `holder_ata == receipt.holder_ata` (ReceiptMismatch), `!receipt.refunded` (AlreadyRefunded).
- **Dead-ATA skip (D14):** if `holder_ata` is not owned by the token program or is not an initialized USDC account, emit `RefundSkipped{promise, index}` and continue. One customer can never fail the whole batch.

Effects per paid pair: `transfer_checked(vault → holder_ata, refund_units)` signed by the Promise PDA. `receipt.refunded = true`, `promise.refunded += 1`, `merchant.refunds_paid += 1`. Emit `RefundPaid{promise, index, holder, amount}`.
Tx shape (worker, §5.7): `ComputeBudget` + up to 10 × `createAssociatedTokenAccountIdempotent(payer=cranker)` + `refund_crank`. **Size must be measured at G2**: 10 ATA-creates add ~10 × 6 account metas plus data. If it exceeds 1232 B, use a v0 tx with an address lookup table (mint, programs, promise, vault, merchant), or drop to 5 pairs per tx. Request 400k CU.

#### 6) `release()`
Accounts: `authority` (signer), `merchant` (mut, seeds `["merchant", authority]`), `promise` (mut), `vault` (mut, seeds `["vault", promise]`), `authority_usdc` (mut), `usdc_mint`, `token_program`.
Checks (anything else → **LiabilityLocked**):
- `promise.merchant == authority` (NotMerchant)
- **Either** `sold == 0` and `status != CLOSED` (cancel path, any time, D15),
- **or** `status == SETTLED_NO` **and** (`phases_done & CUTOFF != 0` **or** `now > expected_resolve_ts + 24h`). The merchant can't recover the vault without its hedge record being written (D4),
- **or** `status == SETTLED_YES` **and** (`refunded == sold` **or** `now > resolved_at + RELEASE_GRACE`) (D15).

Effects: transfer the entire vault balance to `authority_usdc`. `status = CLOSED`, `merchant.promises_closed += 1`. Emit `Released{promise, amount, cancelled: sold == 0}`.

#### 7) `close_receipts()` (merchant only, D17; cut-list item 5)
Accounts: `authority` (signer, mut, receives rent), `promise` (`promise.merchant == authority`). `remaining_accounts` = up to 20 receipts (mut).
Checks per receipt: owned by the program, `receipt.promise == promise.key()`, and (`receipt.refunded` **or** `promise.status ∈ {SETTLED_NO, CLOSED}`), else LiabilityLocked. A YES receipt that is unrefunded stays open until it is paid (or until the promise is CLOSED after `RELEASE_GRACE`).
Effects: close each receipt account to `authority`. Safe against re-issue because receipt seeds use a monotonic index. History stays in the `ReceiptIssued`/`RefundPaid` events and the store, which `/p/` reads.

### 3.5 Invariants (checked in tests, §10.2)
- I1: while `status ∈ {OPEN, SETTLED_YES}`, `vault.amount ≥ (sold − refunded) × refund_units`.
- I2: at every successful `issue_receipt`, `sold ≤ hedged_capacity ≤ cap`.
- I3: no instruction moves vault funds to any account except a receipt's `holder_ata` (crank) or the merchant's ATA (release under the §3.4 conditions).
- I6: `held_bps_min` never increases. The merchant counters change only in `attest_outcome` (record) and `refund_crank`/`release` (counts), and only on the merchant PDA derived from `promise.merchant`.
- I7: no single receipt or holder account can make `refund_crank` fail for the others, and `release` is always reachable eventually (D15).
- I4: each receipt is refunded at most once. `refunded ≤ sold`.
- I5: no `issue_receipt` succeeds at `now ≥ sales_close_ts`.

### 3.6 Trust model (every privileged key)

| Key | Held by | Can | Cannot | Misbehaviour → who is harmed → mitigation |
|---|---|---|---|---|
| Merchant authority (Solana) | merchant (demo: team) | create promises, issue receipts, release after settle | touch the vault before settlement (LiabilityLocked), post outcomes (UnauthorizedAttestor) | none on customers |
| ATTESTOR (Solana) | Hedgehog operator, disclosed | set hedged capacity and held_bps | move vault funds, settle | over-reporting → merchant sells unhedged → merchant P&L only. Mitigation: re-reads after close; order ids and fills published in `hedge.json` (checkable by Gemini, not by the public). The onchain `orders_hash` is a commitment, not a proof |
| Gemini key B (**Trader role**; Gemini requires Trader for REST positions/order history) | attestor process | **can** place/cancel PM orders on the merchant's Gemini account (role semantics); our code path only reads | withdraw (no Fund Manager, verify at H0) | a leaked key B could trade the merchant's account. Mitigation: separate process, IP allowlist to the host if available, no withdrawal role, Auditor-WS swap is roadmap. We never call it "read-only" on stage |
| RELAYER (Solana) | Hedgehog operator, disclosed (same operator as attestor in v1: least privilege, not more trust) | post the outcome | move funds | false NO → customers unpaid. Mitigation: canonical hash, publicly checkable via Verify in the customer's browser. Roadmap: multi-relayer / Switchboard |
| Relayer silence | — | — | — | after 72 h the crank pays customers (D9) |
| Cranker | anyone | push refunds | redirect refunds (holder_ata checked) | none |
| Gemini key A (Trader) | hedge agent, server-side | buy/sell PM contracts on the merchant's account | withdraw (no Fund Manager role, **verify at H0**) | overspend → merchant. Mitigation: budget and price ceilings (§5.2) |
| Merchant (as a Gemini account holder) | merchant | sell the hedge any time, including in the Gemini web UI | hide it for more than one re-read interval (≤15 min) before settlement | merchant P&L; customers are unaffected (vault). Recorded as a hedge break at settlement (D4) |
| Customer browser key | customer | spend/cash out own $1; close own ATA | block refunds to others or lock the vault (D14, D15) | none on others |
| Program upgrade authority | team laptop key | upgrade program | — | disclosed in README. Production: multisig, then frozen |

Pitch phrasing: "a program rule fed by a disclosed attestor", **never** "trustless".

---

## 4. External integrations (verified live; timestamps UTC)

### 4.1 Gemini public market data, no auth. **Verified 2026-11-18 19:20-19:26Z**
Base `https://api.gemini.com`. Rate limit (docs, fetched 19:24Z): **public 120 req/min, recommended ≤1 req/s**. Burst: 5 queued, then `429`. No PM-specific limits. Response headers carry no rate-limit headers (observed: `x-request-id`, `vary: Origin`).

| Endpoint | Observed |
|---|---|
| `GET /v1/prediction-markets/events?status=active&limit=100&offset=N` | 200, paging works. **≥500 active events** (Sports 363, Crypto 82, Weather 49, Commodities 6 across offsets 0-400). Event fields: `id,title,ticker,category,type,status,startTime,expiryDate,effectiveDate,contracts[],volume,volume24h,termsLink(empty),subcategory,…`. Contract fields: `id,label,ticker,instrumentSymbol,status,marketState,prices{bestBid,bestAsk,…},quantityMinimum("0.01"),quantityIncrement,priceIncrement("0.01"),priceMinimum,description(rich text: rules),resolutionSide,resolvedAt,expiryDate,…` |
| `GET /v1/prediction-markets/events/{ticker}` | 200. Returns a settled event with `status:"settled"`, event-level `resolvedAt`, and per contract `resolutionSide:"yes"/"no"`. **CORS:** a request with `Origin: https://hedgehog.example.app` got `access-control-allow-origin` reflecting the origin, so **browser Verify works**. |
| `GET /v1/prediction-markets/events/recently-settled?limit=100` | 200 (419 KB), dominated by 5/15-min crypto. Not useful for finding games; use the by-ticker lookup. |
| `GET /v1/book/{instrumentSymbol}` | **200, works for PM contracts** → `{bids:[{price,amount,timestamp}], asks:[…]}`. Used for depth caps. |

**Live books recorded 19:21Z (production):**

| Contract | bids (price × qty) | asks |
|---|---|---|
| `GEMI-NBA-2611200100-LAC-SAS-M-LAC` (Clippers win = Spurs lose) | 0.13×388, 0.12×350, 0.11×400, 0.10×500 | **0.14×750, 0.15×2520**, 0.32×10 |
| `…-SAS` (Spurs) | 0.86 / ask 0.88 (top only, from event) | |
| `GEMI-WXHIGH-AUS-2611200459-LO69` | 0.01×100 | 0.03×100, 0.09×10 |
| `…-70TO71` | 0.05×100 | 0.10×100, 0.15×10 |
| `…-72TO73` | 0.27×100, 0.22×7 | 0.32×100, 0.37×1 |
| `…-74TO75` | 0.48×100, 0.42×10 | 0.53×100, 0.57×5 |
| `…-76TO77` | 0.07×100, 0.04×10 | 0.11×100, 0.15×10 |
| `…-HI78` | — | 0.01×100, 0.08×10 |

Derived (prices move, so the cards always reprice live):
- "Under 74°F" strip = LO69 + 70TO71 + 72TO73: Σask **0.45**/receipt, depth 100.
- "74°F or warmer" = 74TO75 + 76TO77 + HI78: Σask **0.65**, depth 100. The pair costs **1.10 per paired $1**: a rebate plus about 10% spread. We say so (D11).
- "Spurs lose": 0.14. **1,500 contracts = 750×0.14 + 750×0.15 = $217.50.**

**Calendar (verified `startTime`/`expiryDate`, 19:20Z):**

| Promo | Event ticker | startTime / expiry (Z) | Our sales close | Expected resolve | H |
|---|---|---|---|---|---|
| **E2E test (D20)** | `WXHIGH-AUS-2611190459` ("Highest temperature in Austin on November 18, 2026?", verified active 19:38Z, 6 bins) | expiry 2026-11-19T04:59:59Z | create + 20 min, target ≤ 03:50 CST, must precede Gemini's `resolvedAt` | ~Thu 05:02 CST (11:02Z) = H16 | G3 |
| Wrong-weather pair | `WXHIGH-AUS-2611200459` ("Highest temperature in Austin on November 19, 2026?") | expiry 2026-11-20T04:59:59Z | Thu 12:00 CST (18:00Z) = H23 | ~Fri 05:02 CST (11:02Z) = H40 | run #1 |
| Spurs lose | `NBA-2611200100-LAC-SAS-M` | start 2026-11-20T01:00Z (Thu 7:00 PM CST) | H30 | **Thu 9:40 PM - Fri 0:20 AM CST** (lag measured from `/recently-settled` on Nov 18: 2h40m, 2h55m, 3h48m, 4h16m after start). `expected_resolve_ts = start + 4.5 h` | run #2 |
| (alt) Aggies lose (NCAAM) | `NCAAM-2611200100-TAMU-TCU-M` | start 2026-11-20T01:00Z | H30 | ~H33 | backup to Spurs (book 0.59/0.73, wide) |
| Rockets lose | `NBA-2611210300-HOU-DEN-M` | start 2026-11-21T03:00Z (Fri 9 PM CST) | — | ~Sat 0:00-1:30 CST | optional finals footage (a settled game shown as a `/p/` page); not the live promo (DEN 0.51/0.54) |
| **Saturday Austin high (finals live promo, preferred)** | expected `WXHIGH-AUS-2611220459` (Nov 21 high; check listing Fri evening/Sat 7 AM) | expiry ~Sun 04:59Z | Sat 12:00 CST, or slot end + 30 min if earlier | ~Sun 05:02 CST | finals live, if the finals slot ends before noon. Fits "money back if hot" |
| Aggies-OU | `NCAAF-2611211700-TAM-OU-M` | start **2026-11-21T20:45Z** (Sat 2:45 PM CST; the ticker's "1700" is stale) | — | — | finals live promo if the slot ends after noon (sales close at kickoff) |
| San Antonio high | `WXHIGH-SAT-2611200459` | listed | — | — | cut-list item |

Settled-event test vector (resolved 2026-11-17T11:02:22Z, >24 h old): `WXHIGH-AUS-2611170459` → canonical hash **`4c0985315ecd2b18bf22532d8da14eb4a423a4756ca2a7dfa5242084d46dee82`**. Identical across fetches at 18:57Z and 19:26Z. The winning contract is `GEMI-WXHIGH-AUS-2611170459-HI58`. Canonical string in §5.5.

Rules text sample (Clippers contract `description`): *"If Los Angeles C wins the Pro Basketball game between Los Angeles C and San Antonio originally scheduled for November 19, 2026 at 8:00 PM ET, this market will resolve to Yes. Otherwise, it will resolve to No. …"* This is shown verbatim on the card and the receipt.

Failure handling (public): 10 s timeout. Retry 3× on 5xx/429 with backoff 1 s, 2 s, 4 s. Cache 30 s (catalog) and 5 s (books). If the book for any strip bin is empty or erroring when a promise is created → the card is disabled ("No Gemini book: can't hedge"). Production returned 500s on Nov 18 (earlier iteration), so this path is tested.

### 4.2 Gemini private PM API (HMAC). **Docs verified 2026-11-18 19:23-19:25Z. Calls NOT yet verified (needs keys; gate G1)**
Auth (all private): `POST`, headers `X-GEMINI-APIKEY`, `X-GEMINI-PAYLOAD` = base64(JSON `{request:"<path>", nonce:<ms>, …body}`), `X-GEMINI-SIGNATURE` = hex HMAC-SHA384(payload, secret), `Content-Type: text/plain`, `Content-Length: 0`, `Cache-Control: no-cache`. **Each key needs strictly increasing nonces → one key per process** (key A = agent, key B = attestor). Private limit: **600/min, recommended ≤5/s**.

| Call | Path | Role | Request | Response fields we use |
|---|---|---|---|---|
| Terms status / accept | `/v1/prediction-markets/terms/status`, `/v1/prediction-markets/terms/accept` (paths from existing `lib/gemini.ts`; **verify at H0**) | Trader | — | `hasAcceptedLatest` |
| Place Batch Orders | `/v1/prediction-markets/order/batch` | **Trader** | `{orders:[{symbol, orderType:"limit", side:"buy", quantity:"10", price:"0.16", outcome:"yes", timeInForce:"immediate-or-cancel"}]}` (1-20 orders) | `results[i].order.{orderId,status,filledQuantity,remainingQuantity,price}` or `results[i].{error,message}`. Validation/terms/risk failure rejects the whole batch. Per-order exchange rejects are per entry. **Batch results have no `avgExecutionPrice`**, so read it from order history. |
| Place Order | `/v1/prediction-markets/order` | Trader | same single-order fields (used for the 1-contract sell-back: `side:"sell"`, `outcome:"yes"`, `price:"<bid>"`, IOC) | `orderId,status,filledQuantity,avgExecutionPrice` (201) |
| Get Positions | `/v1/prediction-markets/positions` | **Trader** (docs name no Auditor) | — | `positions[].{symbol,totalQuantity,quantityOnHold,avgPrice,outcome,resolutionSide,contractMetadata.eventTicker}` |
| Get Order History | `/v1/prediction-markets/orders/history` | Trader | `{status:"filled", symbol, from, to, limit≤1000}` | `orders[].{orderId,filledQuantity,avgExecutionPrice,status}` → premium |
| WS positions | `wss://ws.gemini.com`, auth headers at handshake (`X-GEMINI-NONCE` + payload = base64(nonce)) | **Auditor or Trader** | — | Snapshot-on-subscribe **undocumented** → optional H2 experiment only |

Failure handling (private): any 5xx/429/timeout on an order → **no automatic retry of buys** (to avoid double fills). Re-read positions, compute the shortfall, and retry once only if the shortfall is > 0 and the budget allows. Any `401/403` or terms error → stop the agent, mark the promise `HEDGE_FAILED`, and keep sales blocked (capacity stays 0). All requests and responses are logged to the store (redacted keys).

**Unverified, gated at H0 (G1):** retail account API access to PM trading; sports and weather contracts tradeable for a Texas resident of the user's age; `/order/batch` availability on the account; fills at the shown asks; Trader keys lacking withdrawal permission; fee per contract (budget assumes ≤ $0.02/contract); whether USD balance or USDC is needed to buy PM contracts; whether an ACH deposit carries a trading hold (use an instant method or an existing balance); `terms/status`/`terms/accept` paths. **Measured at G1 (recorded in `h0-gate.log`):** time from IOC fill to the new quantity in key B `positions` (if > 3 s, the attestor uses the order-history fill quantity, §5.3).
**Unverified, checked Thu by 6:30 PM CST (before tip-off):** NBA `marketState` and bids right before and after `startTime`. The sell-back runs **before** tip-off, so in-play trading is not needed.

### 4.3 Anthropic Messages API (card scan)
`@anthropic-ai/sdk` (already in `package.json`), model from env `ANTHROPIC_MODEL`, with one tool `propose_cards` (schema in §5.1). Timeout **12 s**. On timeout, error or invalid output → template cards (§5.1). No retries on stage.

### 4.4 Solana devnet. **Verified 2026-11-18 19:22Z**
- `POST https://api.devnet.solana.com` `getVersion` → 200 `{"solana-core":"4.5.0-beta.0","feature-set":1591744305}`.
- `getAccountInfo 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` → SPL mint, **decimals 6**, initialized (Circle devnet USDC).
- Airdrop is closed (prior iteration) → SOL comes from `faucet.solana.com` (manual, GitHub login). USDC comes from `faucet.circle.com` (Solana Devnet). Per-request amounts are **unverified**: request on several wallets from H0. Fallback: `USDC_MINT=self`, labeled "test USD", which drops the Circle claim. **`scripts/setup.ts` does not exist yet** (`scripts/` is empty, though `package.json` points `setup` at it). A1 writes it in H1-4: create a 6-dp mint, mint 1,000 to the merchant, print the mint, write `.data/mint.json`. `USDC_MINT` in the program then comes from a `self-mint` cargo feature, so the swap is a rebuild + redeploy (~10 min). The decision is taken at H12 from the merchant balance (need ≥ $100).
- Local toolchain **not installed** on this box (`which anchor solana cargo` → none; node v24.21.0 present). Install at H0 (§9).
- Commitment `confirmed`. Retry sends via `maxRetries: 3`. Re-fetch the blockhash on expiry.

### 4.5 NWS. **Verified 19:22-19:24Z** (context only, not a settlement source)
`GET https://api.weather.gov/stations/KAUS/observations/latest` → 200 (18:45Z obs, 20 °C). `GET /points/30.1945,-97.6699` → forecast URL `gridpoints/EWX/159,88/forecast` → **Thursday high 72°F, Friday 74°F**. Used only for the card's "NWS says 72°F" context line. Gemini resolution is the only trigger. A User-Agent header is required.

### 4.6 Not used (stated so agents don't build them)
ERCOT, QuickNode Streams, Switchboard, Arc, x402: roadmap or other projects. The Gemini USDC-on-Solana withdrawal (`/v1/withdraw/usdc` family, **unverified**) is a roadmap slide only, worded "Gemini's API documents USDC withdrawals; settling hedge payouts straight to a vault is the integration we'd build next".

---

## 5. Offchain services and agents

### 5.1 Card scan (`lib/hh/scan.ts`)
Input: free text ≤ 300 chars. The LLM gets the **catalog** (only live events in series `WXHIGH-AUS`, `WXHIGH-SAT`, `NBA-*-SAS|HOU|DAL-M`, `NCAAM|NCAAF-*` with a Texas team, `-M` moneylines only, `startTime > now + 30 min`) and must call:
```json
{"name":"propose_cards","input_schema":{"type":"object","properties":{"cards":{"type":"array","maxItems":3,"items":{"type":"object","properties":{
 "event_ticker":{"type":"string"},
 "strip":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":6},
 "sentence":{"type":"string","description":"customer-facing, ≤80 chars, e.g. 'Spurs lose tonight → $1 back'"},
 "why":{"type":"string","description":"≤120 chars, why this fits the business"},
 "applies_to":{"type":"string","description":"which purchases, e.g. 'any draft', 'iced drinks'"}},
 "required":["event_ticker","strip","sentence","why","applies_to"]}}},"required":["cards"]}}
```
Server validation: `event_ticker` is in the catalog and every strip symbol belongs to it, else drop the card. Fewer than 1 valid card → templates:
- T1 "Spurs/Rockets/Mavs lose tonight → $1 back" (opponent YES on the next Texas NBA `-M`).
- T2 "Under X°F at Austin-Bergstrom → $1 back on iced drinks". X = the bin edge nearest 50% cumulative probability (by mid). Strip = all bins below X.
- T3 the complement "X°F or warmer → $1 back on hot drinks".

### 5.2 Pricing and hedge agent (`lib/hh/pricing.ts`, agent loop in the API process)
For a card with strip S and refund R ($1 → `refund_units = 1_000_000`, contracts per receipt `k = R/$1 = 1`):
- `ask_i`, `mid_i` from `/v1/book`. `limit_i = min(ask_i + LIMIT_SLIPPAGE (0.02), 0.99)`.
- `cost_per_receipt = Σ ask_i × k`, `fair = Σ mid_i × k`, `spread_paid = cost − fair`.
- `depth_i` = Σ ask qty with `price ≤ limit_i`. **`max_receipts = floor(min_i depth_i / k)`**.
- Card prints: sentence, Gemini rules text (first contract's `description`), cost/receipt, fair, spread, max receipts, vault lock (cap × $1), "if 300 covers × $5" preview (`premium = walk the book for 1500 contracts`, flagged "not fillable" if depth < 1500), probability ("chance customers get paid" = fair).

**Agent decision loop** (event-driven: on create, on a revert-triggered top-up, on timer):
1. `need_i = target_receipts × k − attested_or_allocated_i` (attested for this promise).
2. Guards (all must pass, else abort with reason): `Σ ask_i ≤ PRICE_CEILING × k` (default **0.75**; on the ask, not the limit, D19) · `premium_today + Σ need_i×limit_i ≤ DAILY_BUDGET` (default **$25**; **$40 on Thu Nov 19**, set via env) · `target_receipts ≤ cap` (never hedge more than the liability) · `now < sales_close_ts − 60 s` · books non-empty · agent not halted.
3. `POST /order/batch` with one IOC limit buy per bin (`quantity = need_i` to 2 dp, `price = limit_i`).
4. Record the results. If any bin filled < need, retry **that bin once** at `min(ask+0.02, limit_i)` if guards still pass. Otherwise accept partial capacity.
5. Signal the attestor to run `OPEN` now.

Tranches: initial `target = min(10, cap)`. Top-up target = `min(hedged_capacity + 10, cap)` when (a) `topup_threshold ≥ 0` and `cap − sold > 0` and `hedged_capacity − sold ≤ topup_threshold` (default **3**), or (b) the API saw an `Unhedged` revert within the last 60 s (demand signal; hero beat). **`topup_threshold = -1` disables (a)** (D18): the timer never pre-buys, and only a revert triggers a top-up. Stage promo and Run #2 use **-1**. Unit test: threshold -1, sold 10, capacity 10 → no order on timer; after a revert → order. Never sell to rebalance except in attack #5 (explicit operator action).
**Hero fast path:** on a revert the API calls the agent directly (no timer wait). Books are cached ≤5 s. The agent hands the batch `orderId`s to the attestor, which reads with its own key B (§5.3). A fresh blockhash is kept warm every 20 s, and txs carry a priority fee (`ComputeBudget.setComputeUnitPrice`, 50k µlamports).

**Halt conditions**: any Gemini 401/403/terms error, 3 consecutive 5xx, budget exhausted, or a manual "Stop agent" button. Halt → no new orders. Sales continue only within the already attested capacity.

**Position allocation (multiple promises on one contract):** the store keeps `alloc[promise][symbol]`, filled from that promise's own order fills (FIFO). The attestor attests `min(alloc, totalQuantity − Σ alloc of other open promises on that symbol)`, so one position is never counted twice.

### 5.3 Attestor (`scripts/worker.ts` job `attest`)
Gemini key B (Trader role; the code path calls only `positions` and `orders/history`) + Solana ATTESTOR key.
- **OPEN**: triggered by the agent, and every 5 min while `OPEN && now < sales_close_ts`. Read positions → per-bin qty (allocated, in centi-contracts) → premium from order history (`Σ filledQuantity × avgExecutionPrice` for this promise's orderIds) → `orders_hash = sha256(sorted orderIds joined ",")` → `attest_hedge(0, …)`.
- **OPEN fast path (hero):** read `positions` with key B. If the quantity hasn't moved within 3 s of the fill, read `orders/history` for the given orderIds (also key B) and attest `min(position qty, allocated + filled)`, which is never more than key B itself observed. Log the measured latency per step (revert → batch → read → attest confirmed) on the console.
- **CUTOFF**: at `sales_close_ts + 30 s` (retry every 60 s up to 30 min).
- **Post-close sweep:** every 15 min from CUTOFF until the relayer posts the outcome, post a CUTOFF-phase attestation **only if** the held fraction dropped (keeps `held_bps_min` honest at low tx cost).
- **PRESETTLE** (never cut, D4): at `expected_resolve_ts − 30 min`, or the last sweep before settlement.
- `observed_at` = the time positions were read; the tx must land within 300 s.
- Retries: Solana tx up to 3×. Gemini read 3× with backoff. A failure is logged and shown on the console in red.

### 5.4 Relayer (`worker` job `settle`)
Polls `GET /events/{ticker}` every 60 s from `weather: 10:55Z the day after the date` / `games: startTime + 2.5 h`, until `status == "settled"` and **every** contract has `resolutionSide ∈ {"yes","no"}`. If the event shows any other status (e.g. cancelled, under review) or a missing side, it posts nothing, alerts on Telegram and keeps polling (D9 timeout is the backstop). Then: `winning = strip.find(s => contract(s).resolutionSide == "yes") ?? ""` (also sanity-log the event's full winning contract). `attest_outcome(winning, canonicalHash(event), Date.parse(event.resolvedAt)/1000)`. Gives up polling at `expected_resolve_ts + 48 h` (the program's 72 h timeout takes over).

### 5.5 Canonical resolution hash (`lib/hh/canon.ts`, the same code ships to the browser)
```ts
canonical = JSON.stringify(sortKeysDeep({
  ticker: e.ticker,
  resolvedAt: e.resolvedAt,                         // event-level, string as returned
  contracts: e.contracts.map(c => ({ instrumentSymbol: c.instrumentSymbol, resolutionSide: c.resolutionSide }))
                       .sort((a,b) => a.instrumentSymbol < b.instrumentSymbol ? -1 : 1)
}));   // no whitespace; keys sorted at every level
hash = sha256(utf8(canonical))                      // 32 bytes → onchain outcome_hash
```
Test vector (from §4.1) for `WXHIGH-AUS-2611170459`:
`{"contracts":[{"instrumentSymbol":"GEMI-WXHIGH-AUS-2611170459-50TO51","resolutionSide":"no"},…,{"instrumentSymbol":"GEMI-WXHIGH-AUS-2611170459-HI58","resolutionSide":"yes"},{"instrumentSymbol":"GEMI-WXHIGH-AUS-2611170459-LO49","resolutionSide":"no"}],"resolvedAt":"2026-11-17T11:02:22.055Z","ticker":"WXHIGH-AUS-2611170459"}` → `4c0985315ecd2b18bf22532d8da14eb4a423a4756ca2a7dfa5242084d46dee82`.
Excluded on purpose: volume fields, prices, per-contract `resolvedAt` (they differ by milliseconds), images.

### 5.6 Terms hash
`terms_hash = sha256(JSON sorted-keys {sentence, applies_to, event_ticker, strip, rules_doc, refund_usd, sales_close_iso, merchant_name, risk_note})`, using the same `sortKeysDeep` + `JSON.stringify` (no whitespace) as §5.5.
- `rules_doc` = **contract[0].`description` exactly as the API returns it** (a rich-text object `{nodeType:"document", content:[…]}`), keys sorted deep. No plain-text extraction is hashed, so browser and server can't disagree.
- Display text (not hashed) = depth-first concatenation of every `value` of `nodeType:"text"` nodes; hyperlink nodes contribute their child text only (URL dropped); block nodes (`paragraph`, `heading-*`, `list-item`) end with `"\n"`; then trim.
- `risk_note` = the fixed sentence "If the event is cancelled or Gemini's review runs past 72 h, customers are paid and the merchant bears the cost."
- Unit test: hash the saved Clippers `description` object on server and in a jsdom/WebCrypto run → identical.
The JSON is stored in the store and served at `/p/[id]/terms.json`, so anyone can re-hash it.

### 5.7 Cranker (`worker` job `crank`)
When `status == SETTLED_YES`: `getProgramAccounts(receipt, memcmp promise at offset 8)` → filter `!refunded` → chunks of 10 (or 5, per the G2 size measurement) → one tx each = `ComputeBudget(400k)` + `createAssociatedTokenAccountIdempotent(payer=crank key, owner=holder, mint)` per pair + `refund_crank`. Creating the ATA in the same tx makes a customer-closed ATA irrelevant (D14). Log signatures (stage line: "20 refunds in 2 transactions"). Then `close_receipts` in chunks of 20. Manual "Run crank" button on the console.

### 5.8 Fee-payer co-sign (`/api/cosign`)
Input: base64 tx, partially signed by the customer key. The server **only co-signs** if all hold, else 400:
- the signing customer pubkey is the `holder` of at least one receipt in the store whose promise is `SETTLED_YES` and refunded (only paid customers get gas);
- the message contains exactly: an optional `ComputeBudget`, an optional `createAssociatedTokenAccountIdempotent(payer=merchant, mint=USDC)` (**cash-out only**, not for the merchant destination), and **exactly one** `transferChecked` whose source is that customer's canonical USDC ATA, mint = USDC, and `0 < amount ≤ balance`;
- `feePayer` is the merchant.
Rate limits: **2 co-signs per customer pubkey per day**, at most 1 that creates an ATA, and a **global cap of 60 co-signs/hour**. Worst-case drain is ~0.002 SOL per paid receipt, bounded by the number of real payouts.

### 5.9 Store (`.data/hedgehog.json`, single writer = Next process; the worker writes via an internal API route)
Entities: `promises{id, onchain pda, card, termsJson, status, topupThreshold (−1 = revert-only)}`, `counterSessions{token, promiseId, createdAt}` (set when the merchant opens `/counter/[id]` from the console), `codes{code, promiseId, createdBy: counterSession, createdAt, usedAt, receiptIndex}`, `orders{promiseId, orderId, symbol, side, qty, price, filled, avgPx, ts, raw}`, `attestations{promiseId, phase, sig, capacity, heldBps}`, `budget{date, spent}`, `events log`. One-time codes: 128-bit random, base64url, single use, **created only by a cashier tap** (D13), **90-s TTL**, at most 1 unused code per counter at a time. Issuance per promise is serialized by an in-process mutex (§3.4 #3). Snapshot of the store to `.data/backup/` every 10 min.

### 5.10 Env and keys
```
SOLANA_RPC_URL=https://api.devnet.solana.com
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
KEY_MERCHANT, KEY_ATTESTOR, KEY_RELAYER, KEY_CRANK, KEY_ATTACKER   (or .data/keys/*.json, existing keypair())
HEDGEHOG_PROGRAM_ID=
GEMINI_PUBLIC_BASE=https://api.gemini.com
GEMINI_TRADE_BASE=https://api.gemini.com          # PRODUCTION (sandbox has 0 weather/sports markets)
GEMINI_AGENT_KEY / GEMINI_AGENT_SECRET            # key A, Trader
GEMINI_ATTEST_KEY / GEMINI_ATTEST_SECRET          # key B, Trader (read-only by code), or Auditor if WS works
DAILY_BUDGET_USD=25  PRICE_CEILING=0.75  LIMIT_SLIPPAGE=0.02   # ceiling applies to Σask (D19)
ANTHROPIC_API_KEY, ANTHROPIC_MODEL
PUBLIC_URL=https://<stable host>               # named tunnel or static domain (D16); never *.trycloudflare.com
```
Sandbox (`api.sandbox.gemini.com`, verified 19:25Z: 100 events = 82 Crypto + 18 Commodities, **0 weather/sports**) is used only for CI tests of the order and HMAC code against a sandbox crypto contract.

---

## 6. Frontend screens and exact demo states

Visual rules: mobile-first, no wallet words on customer screens ("money", "$1", "yours"), Explorer links in small grey text. The receipt page carries a footer: "Demo: test dollars (devnet USDC). Hedges are real Gemini contracts."

### 6.1 `/merchant` (laptop)
- **S0 Scan:** textarea placeholder "sports bar on Guadalupe, $6 drafts, ~150 covers on game nights" + [Find promos]. A spinner says "Reading Gemini's live markets…" (≤15 s).
- **S1 Cards (≤3):** each shows the big sentence, the Gemini rules text (collapsed), and a row `Cost/receipt $0.14 · Fair $0.135 · Spread $0.005 · Max receipts 3,270 · Lock $20 · Chance customers get paid 14%`, a scale preview `300 covers × $5: $1,500 tail → $217.50 hedge (fillable now)`, and inputs `cap [20]`, `sales close [7:00 PM tip-off]`. Button [Lock & hedge]. Disabled state: "No Gemini book: can't hedge".

### 6.2 `/merchant/p/[id]` (promise console)
Top: sentence, status pill (`HEDGING` → `SELLING` → `CLOSED FOR SALES` → `SETTLED: CUSTOMERS PAID` / `SETTLED: NO REFUND` → `CLOSED`).
- **Capacity meter:** `Sold 8 · Hedged 10 · Cap 20` (bars), "Next tranche auto-buys on demand".
- **Gemini panel:** rows of orders (`orderId 12345678901 · BUY 10 LAC YES @ ≤0.16 · filled 10 @ 0.14 · IOC`), premium so far, [Stop agent].
- **Attestation timeline:** OPEN ✓ (sig), CUTOFF ✓ 100% / ⚠ 95%, post-close sweeps, PRESETTLE, held_bps_min, OUTCOME (hash, winning symbol).
- **Vault:** balance, Explorer link, [Release] (red error toasts show the program error name).
- **Tabs:** [Counter QR] opens `/counter/[id]`, [Crank], [Attacks].
- **Attack panel:** buttons, each showing the **error name, code and Explorer link of the failed tx**:
  1. "Sell receipt #11 now" (if capacity is not topped up) → `Unhedged (6002)`. The hero uses a real phone; this button is the fallback.
  2. "Merchant pulls the vault" → `release` from merchant → `LiabilityLocked (6003)`.
  3. "Merchant posts NO" → `attest_outcome` signed by the merchant key → `UnauthorizedAttestor (6004)`.
  4. "Receipt after kickoff" → `SalesClosed (6000)` (recorded clip on stage).
  5. "Sell 1 contract back" (Spurs/Clippers only, needs a bid; run **before** tip-off, ~6:50 PM, because in-play trading is unverified) → real IOC sell at bid → OPEN re-attest (capacity 19 < sold 20) → CUTOFF at close records 95% → `held_bps_min` = 9500 → the record shows a hedge break at settlement (recorded clip).
  Failed txs are sent with `skipPreflight: true` so they land onchain as failed transactions with logs.

### 6.3 `/counter/[id]` (tablet or second laptop)
Opened from the console (sets a counter session cookie). Idle state: the sentence and a big **[New sale]** button for the cashier. Tap → full-screen QR of `${PUBLIC_URL}/r/${code}` for 90 s or until scanned (status polled every 2 s with the session token), then back to idle. Code creation and polling both require the session token, so a photo of an old QR or a script without the session gets nothing. Shows the sentence, "Scan for your promise. No app, no signup", `7 promises left at this price`, and a countdown "Sales close in 01:12:03". States: `SOLD OUT`, `SALES CLOSED`, `WAITING FOR HEDGE…` (after an Unhedged revert).

### 6.4 `/r/[code]` (customer phone)
On load: get or create the keypair in `localStorage` (`hh.kp`). Show [Save my backup link] → `${PUBLIC_URL}/w#sk=<base58>` plus [Copy key] (works on any future host if the domain ever changes). POST `/api/receipts {code, holder}`.
- **R0 issuing:** "Locking in your promise…"
- **R1 issued:** big text "**If the Spurs lose tonight, $1 comes back to you.**" Sub: "Receipt #9 · The bar already locked $20 for 20 customers in a vault it can't touch · Hedged on Gemini ✓". Link [How do I know?] expands the vault balance, the Gemini rules text verbatim, the order ids hash, and Explorer links.
- **R1-err Unhedged (hero):** "**No hedge, no promise (yet).** The bar's agent is buying cover on Gemini…" + spinner. The page auto-retries every 3 s for **45 s** (the code stays reserved for this phone during retries). Success → R1 with confetti-free subtle check. Timeout → "Sold out at this price".
- **R1-err SalesClosed:** "Sales closed at tip-off." **SoldOut:** "All 20 promises taken."
- **R2 hedge badge** after CUTOFF: "Hedge held at tip-off ✓" or "**Hedge reduced: your $1 is still in the vault.**"
- **R3 YES:** "**$1.00 is yours.**" Balance `$1.00 test USDC` (read from the ATA; before the crank creates it, "Paying out…" instead of an error), the Explorer link of the crank tx, and buttons:
  - [Spend it here]: builds `transferChecked(customer ATA → merchant ATA, 1.00)`. The customer key signs, `/api/cosign` adds the merchant fee payer, then sends. The screen shows "Sent $1.00 to Guadalupe Watch Party (demo merchant: our team)" with **your balance $0.00 · merchant balance +$1.00** and the line "The shop honors it as $1.25 off your next visit (merchant's choice)".
  - [Cash out]: paste an address → same flow. The destination ATA is created idempotently.
  - [Verify with Gemini]: §6.5.
- **R3 NO:** "The Spurs won. No refund this time. The bar's whole cost was its $0.14 hedge." + [Verify with Gemini].

### 6.4b `/w` (the customer's money-back wallet)
One page per browser key: every receipt this key holds across all promises and merchants (store lookup by holder, then onchain reads), each with its status badge, total balance, and the same Spend / Cash out / Verify actions. It also restores a key from `#sk=`. This is Hedgehog's "money-back wallet". It is deliberately thin: the full revocable-check wallet is the sibling project Spendthrift.

### 6.5 Verify widget (browser only)
Fetch `https://api.gemini.com/v1/prediction-markets/events/{ticker}` (CORS verified). Build the canonical string (§5.5), SHA-256 it via WebCrypto, read `promise.status`, `outcome_hash`, `winning_symbol` and `strip` via RPC, and show **four** ticks:
1. `Gemini says: Clippers YES` (the winning contract from Gemini's JSON).
2. `Hash matches onchain ✓ 4c09…ee82`.
3. **`Gemini's outcome matches the promise ✓`**: `geminiYes = strip.some(s => contract(s).resolutionSide == "yes")`, and the tick requires `geminiYes == (status ∈ {SETTLED_YES} or refunded > 0)`. This catches a relayer that posts the right hash with `winning_symbol = ""` (a false NO).
4. `Your receipt's contract set is the promise strip ✓` (strip read from the terms JSON = strip onchain).
Any mismatch shows a red "Does not match: report". **Gemini unreachable (5xx/timeout):** retry 2×, then use the server's cached copy of the event JSON (saved by the relayer at settlement, served at `/p/[id]/event.json`) and label it "Gemini unreachable; checked against the copy fetched at <time>". Stage rule: run Verify once before the slot to warm it.

### 6.6 `/p/[id]` (public, judges)
Read-only: terms JSON + hash, **`hedge.json`** (every Gemini orderId, symbol, side, qty, fill price, timestamp, and premium, with the line "order ids are private to the merchant's Gemini account; Gemini can confirm them"), vault, receipts list (index, holder short, refunded; from events after `close_receipts`), attestation timeline incl. `held_bps_min`, merchant track record, outcome, Verify. This is the link on the slides and in the README.

---

## 7. Demo script

### 7.1 Five-minute finals pitch (Sat Nov 21)

**Prep (Sat morning, by T-60 min):** pick the finals promo: (1) if the finals slot ends before noon CST → the **Saturday Austin high** (`WXHIGH-AUS-2611220459` expected; a "hot drinks: $1 back if 7X°F or warmer" strip), sales close noon; (2) else the Aggies-OU game (kickoff 2:45 PM CST) or any listed Texas/NBA `-M` with `startTime` after the slot. Pre-create it with **cap 20, tranche 10, `topup_threshold = -1` (revert-only, D18), sales_close_ts = min(slot end + 30 min, event close)**. Pre-issue **8 receipts** to team phones (sold 8 / hedged 10). Open tabs: console, counter, `/p/` of the Thursday weather and Spurs promos, recorded clips (Thursday payout, SalesClosed + hedge-reduced), slides. 2 pre-funded backup phones. Full screen recording of a rehearsal on the laptop desktop.

| Time | Beat | Who taps / says | Screen | Fallback |
|---|---|---|---|---|
| 0:00-0:15 | Opener (§0.2) | Speaker A | Title slide: "Hedgehog: promos for Austin bars, hedged on Gemini, refunds guaranteed onchain" | — |
| 0:15-0:40 | Problem | A | One slide: the bar-promo headlines **that have a saved source URL by H36** (candidates: The Jeffrey, Rizzo's, TallBoy, The Blue Light; currently unsourced in `ideas/`; any headline without a link is dropped, and so is the "~40% more business" quote) + "hand-built · unescrowed · no customer proof" + "a broker won't quote a $6 beer" | if none are sourced: "Money-back-if promos are common; Mattress Mack made them famous" (sourced) |
| 0:40-1:20 | **Proof it pays (recorded)** | A narrates over the clip | Thursday 9 AM-noon at our cart: two promises (iced under 74°F / hot 74°F+), sold to different customers. "One side was certain to pay; we did that on purpose so you could see a real payout." Gemini resolved Fri 5:02 AM → Explorer: **N refunds in ⌈N/10⌉ crank transactions** → phone "$1.00 is yours" → Verify 3 ticks. Then one line on the Spurs: the result as it happened (refunds, or "the bar's whole cost was $2.80") | the clip **is** the fallback; `/p/` pages as stills |
| 1:20-2:00 | Live: one sentence → hedged promise | B types `sports bar on Guadalupe, $6 drafts, game nights` → [Find promos] | Cards in ≤15 s (template fallback silent). B points at the pre-created tonight card: "Lock & hedge happened this morning, and here are the Gemini order ids" | if the LLM is slow, the template cards are instant |
| 2:00-2:50 | **HERO: no hedge, no promise** | B taps **[New sale]** for each judge ("the cashier rings you up"). Two judges scan → receipts #9, #10 ("If <team> loses tonight, $1 comes back to you"; issued one after the other by the server mutex, even if they scan at once). A third judge scans → phone: "**No hedge, no promise (yet)**"; console shows a red `Unhedged (6002)` failed tx. The agent fires an IOC batch on Gemini → order id appears → OPEN attest → capacity 20 → the third phone flips to its receipt (within the 45-s retry window; G4 measures the latency). Line: "A receipt cannot exist until Gemini says the hedge exists." | Gemini 500 / no fill → the phone stays "No hedge, no promise". **That is still the point**: show Thursday's recorded production fill + order ids. Network down → backup phones + screen recording |
| 2:50-3:30 | Try to cheat it | B taps attack 2 (`LiabilityLocked`) and attack 3 (`UnauthorizedAttestor`), red failed txs on Explorer; then a 10-s recorded clip from Thursday's Spurs night: sell 1 contract back on Gemini before tip-off → receipt badge flips to "Hedge reduced: your $1 is still in the vault" and the merchant record shows a break; receipt after tip-off → `SalesClosed`. Line: "The vault is the customer's guarantee. The Gemini contract is the merchant's." | prebuilt failed-tx links from rehearsal |
| 3:30-4:10 | Economics | A, slide | "300 covers, $5 back if the Spurs lose: a $1,500 tail. Unhedged: 14% chance of losing $1,500. On Gemini's book **this afternoon**, 1,500 Clippers contracts cost **$217.50**. The vault is a deposit, not a cost: it comes back every night, from the vault or from Gemini. The only cost is the premium." Small print: "weather books ~100 deep per bin today; book screenshot 2026-11-18 19:21Z; one snapshot, re-checked Sat AM" | — |
| 4:10-4:45 | Vision | A | "Same engine, longer horizons: a taqueria's natural-gas bill, a food truck's diesel, a patio bar's summer heat, a small data room's power-price spike. Insurance replaced by exchange cover, priced live and paid in minutes. Each held hedge goes on the merchant's onchain record, and that record earns a smaller lock next time." | — |
| 4:45-5:00 | Close | A | "Every bar promo in the news was hand-built. Ours is one sentence, hedged on Gemini before the first sale, and paid to the customer automatically." `/p/` QR on the slide | — |

Q&A pocket answers (§7.4) are printed on a card.

### 7.2 Submission video (2:45 target, recorded H40-H45 from Thursday runs only)
1. 0:00-0:12 opener line + title.
2. 0:12-0:30 problem slide.
3. 0:30-1:05 merchant flow screen capture (scan → cards → Lock & hedge → real order ids → OPEN attest → capacity 10), with the Spurs promo captured Thursday afternoon.
4. 1:05-1:30 cashier taps [New sale], phones scan at the watch party. Receipt #11 → Unhedged → top-up → success (captured Thursday).
5. 1:30-1:50 attack montage: LiabilityLocked, UnauthorizedAttestor, SalesClosed, hedge-reduced flip.
6. 1:50-2:20 **payout**: Gemini settles Austin high (5:02 AM Fri) → crank txs → "$1.00 is yours" → Spend it here (balance + transfer) → Verify (4 ticks). **Fallback if Run #1 was skipped or settles late:** the D20 test promise (Gemini settled Nov 18 high ~Thu 5:02 AM, real Gemini hedge, 10 receipts paid in one crank tx), labelled "test promise, $0.10 receipts, all bins, so it was certain to pay".
7. 2:20-2:35 economics slide (the D6 line).
8. 2:35-2:45 close + repo/`/p/` links.
Human voiceover. Captions on. The honesty lines (§7.4 H1-H3) are spoken once.

### 7.3 Thursday runs (source footage)
- **Run #1, weather pair** (H20-H23, Thu 9 AM-noon): promises "Under 74°F → $1 back on iced drinks" and "74°F or warmer → $1 back on hot drinks", cap 20 each, tranche 10, threshold 3. At the team's table near UT, receipts are issued to team and friends. Sales close at noon. Settles H40.
- **Run #2, Spurs lose** (create at H26, sell H28-H30, tip-off H30, settles **H32.7-H35.3**, i.e. 9:40 PM-0:20 AM): cap 20, tranche 10, **`topup_threshold = -1`** so the 11th scan (and only a scan) triggers the hero on camera. **~6:50 PM, before tip-off:** check the Clippers bid, then the 1-contract sell-back → OPEN re-attest (capacity 19 < sold 20) → badge "Hedge reduced". At 7:00 PM: CUTOFF records 95%; SalesClosed attempt on camera. Premium ≈ 20 × 0.15 + 1 contract spread ≈ $3. Settlement filming: the worker cranks/releases automatically; U records the screen on wake (Fri 5 AM) from Explorer and `/p/`, so nobody waits up past 10 PM.
- If the program misses the D20 test window (deploy after ~04:30 Thu) → G3 runs on LiteSVM clock-warp + Run #1 itself. If it misses H19 → skip Run #1; the video's payout beat comes from the D20 test promise if it ran, else from Run #2 (pays only if the Spurs lose, ~14%) or a settled NO + release ("the bar's whole cost was $2.80"). The Friday weather pair settles Sat ~5 AM, after the deadline, so it is finals footage only.

### 7.4 Fixed honesty and Q&A lines
- **H1 (money):** "Hedges are real money on Gemini production. Refunds are devnet test USDC, because we won't put strangers' real dollars through a program written in 47 hours. Switching the mint is a config change. Settling Gemini payouts straight to the vault would use Gemini's USDC withdrawals, which we haven't tested yet."
- **H2 (people):** "Receipts in our runs went to our team and friends. The merchant is our own cart and watch party."
- **H3 (weather pair):** "Two products sold to different customers. One side was certain to pay. That's a demo device so you can see a settled payout, not a hedge strategy."
- **H4 (paying twice):** D6 line.
- **H5 (legal):** "Every customer pays the normal price and gets the same conditional rebate, and anyone can get a receipt free at the counter without buying, so there's no consideration. Nobody picks an outcome or sees odds. It works like the money-back promotions Gallery Furniture made famous in Texas. The only party trading event contracts is the merchant, in its own KYC'd Gemini account, as a hedge. We're not lawyers, and we'd confirm Texas Penal Code ch. 47 and the promo rules with counsel before production."
- **H6 (trust):** "In the demo, our team is the merchant and also runs the attestor and the relayer. That's disclosed. Neither Solana key can move vault funds. If the relayer goes silent, customers get paid after 72 hours. A false 'NO' is publicly checkable from the receipt. The hedge itself is attested, not custodied: we publish the order ids, which Gemini can confirm, and real enforcement needs a locked hedge account at Gemini."
- **H7 (Kalshi):** "We don't compete on the market. We're the layer that turns a market into a promise a customer can trust, and Gemini is the market we built it on."
- **H8 (why not just insurance):** "Brokers quote over days, price at probability plus margin, and have minimums. We priced a $6 beer in 15 seconds off a live book."
- **Pocket (only if a source URL is saved by H36, else cut):** "Mattress Mack hedges his big refund promotions with sports bets. Same playbook at $6." The specific "$516K Kalshi 2026 Astros" figure is **removed** because no source exists in `ideas/`.

---

## 8. README must-haves

**All targets:** what/why in 3 lines; architecture diagram (§2); program ID + Explorer links; live `/p/` links for the Thursday promises; setup (`anchor build/test/deploy`, `npm run worker`, env list); the honesty lines H1-H3; legal framing H5; trust table (§3.6); video link.

**Consumer Apps:** the customer journey in 4 screenshots (scan → receipt → $1 is yours → spend/cash out); "no app, no signup, no gas: the merchant pays fees and rent (~0.004 SOL per receipt)"; key-backup link explanation; daily-use story (a watch-party bar runs this every game night).

**Best use of Solana:** program design (accounts with seeds, sizes, invariants I1-I5); why Solana (cheap pushed refunds to anonymous holders: 10 per tx; fee-payer co-signing; receipt PDAs as the eligibility list); test coverage summary; tx signatures for every attack.

**Gemini Prediction Markets bounty:** endpoints used (§4.1/4.2) with role notes; **production order ids** and the fills table (symbol, qty, avg price, premium); the hedge-gating rule tying Gemini positions to onchain issuance; canonical hash spec + test vector; how `resolutionSide` drives settlement; depth evidence (1,500 Clippers contracts = $217.50); "what Gemini could adopt": settle-to-address payouts, a merchant hedging API, a self-serve promo widget.

**Agent safety (since an agent spends real money):** decision loop (§5.2) and limits: IOC limit orders only, ≤ ask+2c, Σask ≤ 0.75 per $1 ceiling, never hedge more than the liability, $25/day budget, halts on errors, no onchain withdrawal authority, separate keys and nonces.

**DeFi fallback (if the track switches):** economic design (premium vs expected loss, spread paid, capital lock 100% ≤ 72 h, v2 lock ratio from the track record), risk assumptions (oracle/attestor trust, Gemini counterparty, basis risk = 0 by construction, liquidity caps), addresses.

---

## 9. Build plan H0 → H47

Owners: **U** = the user (human, holds the Gemini account, pitch). **F** = optional second human (cart/party logistics, filming). **A1/A2/A3** = Claude Code agents (A1 program, A2 services, A3 frontend). If there is no F, U does the logistics and the agents cover UI polish.

| Window (CST) | H | Work | Owner | Gate |
|---|---|---|---|---|
| Wed 1-2 PM | H0-1 | **Telegram ping to U now** (notify.sh): U1/U2 are on the critical path. **U (deadline H3 = 4 PM):** log in to the Gemini app, confirm Predictions is available for the account (Texas, sports + weather), accept PM terms, fund ≥ $75 by an **instant** method (debit card / existing balance; an ACH hold may block trading), create **key A (Trader)** and **key B (Trader)** + optional **key C (Auditor)**, all **without** Fund Manager; paste into `.env.local`. **A2:** `scripts/h0-gate.ts`: terms status → **one batch of 6 IOC buys, 1 contract in each bin of `WXHIGH-AUS-2611190459`** at ask+0.02 (≈ $1.30; this is also the D20 test hedge, must fill before trading ends ~10:59 PM CST) → positions with key B (time the fill→position latency) → order history → write `h0-gate.log`. **A1:** start the toolchain install **in the background immediately** (Rust, Agave CLI, avm + Anchor 0.31); `anchor init`; generate 5 devnet keypairs; print pubkeys. | U, A1, A2 | — |
| Wed 2-5 PM | H1-4 | Run the H0 gate. Optional 30-min Auditor WS test (key C). **U:** faucet SOL (≥ 8 SOL on deployer, 2 on merchant), Circle USDC (as much as allowed, several wallets), **U6 stable hostname**. **A1:** `scripts/setup.ts` self-mint fallback (30 min, §4.4). If Anchor/Agave isn't building `anchor init` output by H3, fall back to Solana Playground (beta.solpg.io) for build+deploy and keep the TS client local. A2: pricing.ts + tests on saved books (incl. D18/D19 cases); canon.ts + test vector. A3: Next routes skeleton, card UI with live public data. | U, A1-3 | **G1 at H4 (5 PM Wed): a real production fill is visible via key B positions.** NO-GO → switch to the Spendthrift + Shed pair that hour (both have build specs in `ideas/build/`; don't wait on KYC) |
| Wed 5 PM-Thu 3 AM | H4-14 | **A1:** program: 6 core ix (+ `close_receipts` last), errors, events; LiteSVM tests in this order: happy path YES/NO, Unhedged, SalesClosed, LiabilityLocked, UnauthorizedAttestor, dead-ATA skip, cancel (sold 0), then the rest + invariants; measure the crank tx size with 10 ATA-creates; deploy to devnet **by H14 at the latest** (D20 needs it by ~03:30, hard stop 04:30). **H12:** USDC decision (Circle vs self-mint). **A2:** geminiPrivate.ts (2 key profiles), agent loop + guards, attestor/relayer/cranker in worker.ts, cosign route. **A3:** console, counter, receipt page R0-R2, `/p/`. **U:** review at H8, sleep H9-H15 (agents continue; U sets a Telegram ping on gate results). | A1-3 | **G2 at H14: program on devnet, 5 priority tests green, an end-to-end promise created on devnet with a fake attestation.** Slip → G3 |
| Thu 3-8 AM | H14-19 | **D20 test promise (target 03:30, hard stop 04:30 CST):** create on `WXHIGH-AUS-2611190459`, strip = all 6 bins, `refund_units` $0.10, cap 10, `sales_close` = create + 20 min → attestor OPEN from the real H0-gate position (capacity 10) → issue 10 receipts via `/api/receipts` (script + 1 phone, concurrently to test the mutex) → CUTOFF → the **real relayer** posts the outcome at ~05:02-05:30 → crank (ATA creates + 10 refunds in 1 tx) → Spend it here → Verify 4 ticks → `close_receipts`. Film the phone. A3: R3 states, Verify widget, `/w`. | A1-3, U wakes H15 | **G3 at H19 (8 AM Thu): the D20 loop settled and paid on devnet with a real Gemini hedge.** If the deploy missed 04:30 or Gemini resolved before our sales close: G3 = LiteSVM clock-warp replay of `2611170459` + a devnet create→attest→issue with a real fill. NO → skip run #1 (see §7.3) |
| Thu 9 AM-12 PM | H20-23 | **Run #1 weather pair** (U+F at the table; cashier-tap counter; receipts to team/friends; film). `PUBLIC_URL` frozen. Agents fix bugs live. | U, F | **Pre-run check:** `PUBLIC_URL` is the stable host (D16) |
| Thu 12-5 PM | H23-28 | A3: spend/cash-out, attack panel. A2: LLM scan + templates, top-up-on-revert fast path, latency log. A1: attack scripts (skipPreflight). Create the Spurs promo at H26 (3 PM) with threshold -1. | A1-3 | **G4 at H26: hero loop (revert → top-up → retry) works on devnet in < 30 s measured, 3 runs** (else extend the retry to 60 s; if > 60 s, stage = attacks only + recorded hero) |
| Thu 5-10 PM | H28-33 | **Run #2 Spurs watch party**: sales 5-7 PM incl. filmed hero. 6:50 PM: bid check + sell-back + OPEN re-attest. 7 PM: CUTOFF, SalesClosed attempt. Settlement 9:40 PM-0:20 AM is automatic (relayer + crank or release); filmed from Explorer in the morning. | U, F, A2 | — |
| Thu 10 PM-Fri 5 AM | H33-40 | A2/A3: README (§8), slides, economics with live depth screenshot. U sleeps H34-H39. Verify tested against `WXHIGH-AUS-2611170459` and the Spurs event. Buy the Friday weather pair if listed (finals material). | A1-3 | — |
| Fri 5-11:30 AM | H40-46.5 | 5:02 AM weather settles → relayer → crank (record). Record VO, edit the video (2:45), final README, **submit by 11:30 AM**. | U | **G5 at H45: submission package complete**; else submit with the Spurs path as the settled demo |
| Fri PM / Sat | — | Rockets promo (finals footage), pick + pre-create the finals promo, rehearse ×3, backup phones, recording. | U, F | — |

**Cut list, in order (cut from the top first):**
1. LLM scan polish (templates only).
2. Cash out (keep Spend it here). If cut, the cosign ATA-create branch goes too.
3. San Antonio and NCAA catalog entries.
4. Friday/Saturday extra runs.
5. `close_receipts` (then the economics answer counts receipt rent as a cost and names it roadmap).
6. `/p/` public page polish (keep the raw data view + `hedge.json`).
7. Auto top-up threshold (keep revert-triggered top-up only; the stage already uses -1).
8. `/w` multi-receipt view (keep the single-receipt R3 actions).

**Never cut:** vault + LiabilityLocked, Unhedged gate, cashier-tap codes, issuance mutex, real Gemini production fill, CUTOFF + post-close sweep + PRESETTLE (all one code path) + release gate, settle + crank with ATA create + dead-ATA skip, release escapes (D15), 3 live attacks, Verify (4 ticks + cached fallback), stable hostname, honesty lines.

---

## 10. Risks, mitigations, test plan

### 10.1 Risks
| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | Retail Gemini account can't trade PM via API (KYC, state, terms, role, ACH hold) | medium | U1/U2 by H3 with a Telegram ping; G1 at H4. Switch-project rule (Spendthrift + Shed). No sandbox faking (the sandbox has no weather/sports) |
| R2 | Gemini 5xx at create or on stage | medium | No buy retries without a position re-read. Stage hero still works on failure. Recorded fills are the primary evidence |
| R3 | Devnet-vs-real money critique | certain | H1 line, said once. Mint switch documented |
| R4 | Program late → lose run #1 | medium | G2/G3. Spurs path + Friday weather fallback |
| R5 | Spurs win (86%) → no Thursday game payout | high | The weather pair guarantees one payout. Spurs NO is shown as "the bar's cost was $2.80" |
| R6 | Weather resolution later than 5:02 AM | low (measured 11:02Z) | Video shows the attestation with the crank pending. 6 h buffer before submit |
| R7 | Faucet limits (SOL/USDC) | medium | Start at H1. Multiple wallets. Fallback self-mint labelled |
| R8 | Fee-payer drain via /api/cosign | low | Strict instruction allowlist + rate limit (§5.8) |
| R9 | Customer loses localStorage key | medium | Backup link. Early cash-out |
| R10 | Position double-counting across promises | medium | Allocation ledger (§5.2) |
| R11 | Nonce collisions on the Gemini key | medium | Separate keys per process. Monotonic `max(Date.now(), last+1)` |
| R12 | Tunnel/host down on stage | low | Stage laptop runs a local copy on the same keys + store snapshot. Recorded video |
| R12b | Hostname changes between runs (orphans customer keys) | was high, now low | D16 stable hostname mandatory; worker refuses `trycloudflare.com`; [Copy key] backup |
| R15 | Concurrent scans collide on the receipt PDA | high without fix | Per-promise mutex + 1 retry (§3.4 #3); test with 5 parallel issues |
| R16 | QR farming / free receipts | medium | Cashier tap + session token + 90-s TTL (D13) |
| R17 | Hero latency > retry window | medium | Fast path (§5.2, §5.3), priority fee, 45-s retry, G4 measured 3× |
| R18 | Game cancelled / Gemini review | low | D9 disclosed merchant risk; relayer posts only binary outcomes |
| R19 | Toolchain install eats H0-H4 | medium | Background install at H0; Solana Playground fallback at H3 |
| R20 | Problem-slide claims unsourced | certain today | Source by H36 or drop (§7.1, §7.4) |
| R13 | Legal/optics on stage at a regulated exchange | medium | H5 line. Customers never see odds |
| R14 | Real-money overspend | low | $25/day ($40 Thu) budget, $75 hard cap on account funding |

### 10.2 Test plan
**Program (anchor tests, local validator, clock warp):**
- Happy YES: create(cap 20) → attest OPEN 10 → issue 10 → attest CUTOFF → outcome YES → crank 10 → vault = 10 × $1 left → release (refunded==sold) → CLOSED.
- Happy NO: … → outcome NO → release → merchant gets 20.
- Unhedged: issue #11 with capacity 10 → 6002. Then attest 20 → succeeds.
- SoldOut at cap. SalesClosed at `now ≥ sales_close_ts`.
- LiabilityLocked: release while OPEN; while YES with unrefunded receipts; while NO **without** CUTOFF (before +24 h). It succeeds after CUTOFF.
- UnauthorizedAttestor: merchant signs attest_hedge / attest_outcome.
- AlreadyRefunded double crank; ReceiptMismatch with a wrong ATA; a receipt from another promise.
- Relayer timeout: OPEN past `expected_resolve + 72h` → crank pays.
- Strip validation: wrong prefix, >6, duplicate, >48 bytes. Amount validation.
- Held-bps math: sold 10, capacity 9 → 9000. sold 0 → 10000. `held_bps_min` only decreases; a 95% re-attest after a 100% CUTOFF → `hedge_breaks += 1` at `attest_outcome`, never at attest time. Merchant counters move once per promise.
- Overflow: `qty_centi = 500_000`, `refund_units = 10_000` → capacity computed in u64, no panic.
- Dead ATA: crank a batch where one `holder_ata` is uninitialized/closed → that pair emits `RefundSkipped`, the other 9 pay. Worker path: closed ATA recreated in the same tx → all 10 pay.
- Wrong merchant PDA passed to `refund_crank`/`release`/`attest_outcome` → seeds constraint error.
- Release escapes: `sold == 0` while OPEN → succeeds; SETTLED_YES with 1 unrefunded before/after `RELEASE_GRACE`.
- `close_receipts`: unrefunded YES receipt → LiabilityLocked; refunded or NO → closed, rent to authority.
- Settled vector replay: LiteSVM clock set to 2026-11-16 → create on `WXHIGH-AUS-2611170459` → clock to 2026-11-17T12:00Z → `attest_outcome(HI58, 4c09…ee82, 1794913342)` → YES.
- **Fuzz/property** (TS, seeded random ≥200 sequences of create/attest/issue/outcome/crank/release with random clock warps against the local validator, or LiteSVM if available): after every step assert I1-I5 by reading accounts.

**Offchain unit (node:test via tsx):**
- pricing: strip sums, depth walk (1,500 Clippers → $217.50 on the saved 19:21Z book), max_receipts, ceiling/budget guards, tranche math, fractional quantities to 2 dp.
- canon: test vector `4c0985…ee82` from the saved `WXHIGH-AUS-2611170459` JSON; volume changes don't change the hash; key-order independence.
- HMAC: signature matches a known vector (sandbox call in CI).
- cosign allowlist: rejects extra instructions, a wrong fee payer, an over-balance amount, **amount 0**, a non-holder signer, an ATA-create on the merchant path, a non-USDC mint; rate limits per key and global.
- receipts API: 5 parallel issues on one promise → 5 sequential successes; code reuse and expired code (> 90 s) rejected; code creation without a counter session → 401.
- agent: threshold -1 never pre-buys on timer; Σask 0.65 strip passes the 0.75 ceiling; Σask 0.80 is rejected.
- terms hash: rich-text `description` object hashes identically on server and browser.
- scan: invalid LLM output → templates.

**Integration (devnet + production Gemini, manual scripts):** `h0-gate.ts`. `e2e-devnet.ts` runs once for real on the D20 promise (create → attest from the real position → issue 10 → real relayer at ~05:02 → crank → spend → close). Before Run #1 it is re-run 2× in **dry mode** (create → real-position OPEN attest → issue → `release` via the `sold == 0`/cancel path and a NO path on a short-dated promise), because a fresh settled YES event isn't available every hour.

**Stage rehearsal checklist:** cold boot → host up on the stable hostname → [New sale] → counter QR scannable from 3 m → two simultaneous scans both succeed → hero loop timed (target < 30 s; record the number) → attacks produce failed txs → Verify on cellular, and once with Gemini blocked (cached copy path).

---

## 11. Open questions and user-only actions

### Open questions for the user
1. **Track:** this spec picks **Consumer Apps** (siblings are Agentic, and the evidence favors Consumer). Keep it, or go DeFi?
2. **Gemini account:** whose KYC'd account holds the hedges, and is Predictions trading enabled for that account's state? It needs ≥ $75 funded today (ACH can take days; use an instant method if available).
3. **Humans:** is a second person available Thursday 9 AM-noon (cart) and 5-10 PM (watch party), or does the user run both alone?
4. **Spend-it-here bonus:** show "+25% (merchant's choice)" as text only, or drop the bonus line entirely?
5. **Real merchant:** has any business near UT agreed to a recorded quote? If not, the pitch uses "demo merchant: our team" only.
6. **Hosting:** run on this box behind a **stable** hostname (D16). Which one: a domain you own on Cloudflare (named tunnel), or an ngrok free static domain?
7. **Scope of the 3 ideas:** this spec covers Hedgehog only. "Money back if hot" is in it (weather promos), and the money-back wallet appears as Hedgehog's thin `/w` page. The full money-back wallet and grid computing are the sibling specs `ideas/build/Spendthrift.md` and `ideas/build/Shed.md`, and 2 of the 3 ship. Confirm that, rather than merging grid computing into Hedgehog (we don't: no Gemini market for power or compute, and merging would blow the 47 h scope).
8. **Finals slot time on Sat Nov 21:** before or after noon CST? It picks the live promo (Saturday Austin high vs Aggies-OU).
9. **Sources** for the problem-slide headlines and any Mattress Mack hedge claim: do you have links? Otherwise they are cut.

### Actions only the user can do (in order, tonight)
- **U1 (now, deadline H3 = 4 PM Wed):** Gemini: log in, confirm Predictions (sports + weather) for your state, accept the PM terms, deposit ≥ $75 by an instant method (check that buying power isn't on an ACH hold).
- **U2 (deadline H3):** Gemini API keys: **key A Trader**, **key B Trader**, optional **key C Auditor**; *no* Fund Manager/withdrawal; IP allowlist off or set to the host IP. Put them in `.env.local` (never committed; `.gitignore` already present).
- **U3:** Solana devnet SOL via faucet.solana.com (GitHub login) to the deployer (≥ 8 SOL for program deploy, ~3-4 SOL for a ~400 KB program) and merchant (2 SOL) pubkeys that A1 prints.
- **U4:** Circle devnet USDC via faucet.circle.com (Solana Devnet) to the merchant: ≥ $100 total across requests (vault locks: 20+20 weather, 20 Spurs, 20 finals, 20 Rockets, $1 D20 test). If short by H12, the self-mint fallback is used (§4.4).
- **U5:** Anthropic API key in `.env.local` (optional; templates work without it).
- **U6 (REQUIRED, by H19 before Run #1):** a stable hostname: a Cloudflare named tunnel on a domain you control, or an ngrok account with its free static domain (availability unverified for your account; check when signing up). Quick tunnels are not allowed (D16).
- **U7:** Logistics: a table/spot near UT for Thursday 9-12 and a watch-party room Thursday 5-10 PM; 2 spare phones for finals; tell friends to come scan.
- **U8:** Approve the real-money budget: ≤ $75 total premium (expected ≈ $46: weather pair ~$22, Spurs ~$3, finals ~$5, Rockets ~$11, D20 test hedge ~$1.30, other tests ~$2).

---

## 12. Red-team resolutions

Status: **Fixed** = spec changed (section named). **Accepted** = kept as is, with the reason and how it is disclosed. Codes: B = blocker, H = hole, I = inconsistency, U = unverified assumption.

### 12.1 Blockers
| # | Item | Resolution |
|---|---|---|
| B1 | G3 test on the already-settled `2611170459` can't pass (`TooEarly`) | **Fixed.** D20: the devnet end-to-end runs on the fresh `WXHIGH-AUS-2611190459` (verified active 19:38Z). The H0 gate buys 1 contract per bin (all 6 bins, ≈ $1.30), the test promise uses all 6 bins (a certain YES), $0.10 refunds and cap 10, and is created right after deploy with sales close at create + 20 min, ahead of the ~05:02 resolution. The settled vector is replayed in LiteSVM with clock override (§3.1, §10.2). §9 H0-1/H14-19, §4.1 calendar |
| B2 | `topup_threshold = 0` pre-buys at sold=10 and kills the hero | **Fixed.** D18, §5.2: `-1` disables the threshold rule (revert-only). Stage and Run #2 use -1, and a unit test covers it |
| B3 | Ceiling Σ(ask+0.02) = 0.71 > 0.70 blocks the hot-drinks strip | **Fixed.** D19, §5.2: the ceiling applies to Σask, and the default is 0.75. Slippage is bounded by `limit_i` and the budget guard |
| B4 | A customer closes their ATA, so batch cranks fail and `release` locks forever | **Fixed.** D14: lazy ATA; the cranker creates ATAs in the same tx (payer = crank key); the program skips dead ATAs (`RefundSkipped`). D15: `release` on SETTLED_YES after `resolved_at + 7 d`, and any time `sold == 0`. Invariant I7 |
| B5 | A quick-tunnel hostname change orphans keys and QRs | **Fixed.** D16: a stable hostname is mandatory (U6 required by H19), the worker refuses `trycloudflare.com`, and the receipt page has a [Copy key] backup. §2, §5.10, §11 |
| B6 | Concurrent scans collide on the receipt PDA seed | **Fixed.** §3.4 #3: per-promise FIFO mutex in `/api/receipts`, re-read `sold`, retry once, no raw errors on the phone. Test: 5 parallel issues. Rehearsal checks 2 simultaneous scans |
| B7 | Everything rests on G1 (user's KYC'd Gemini API) | **Accepted, escalated.** It is the single biggest risk and can't be engineered away. Telegram ping at H0. U1/U2 deadline moved to **H3 (4 PM)** with an instant funding method (ACH holds named). G1 stays at H4, and the NO-GO target is Spendthrift + Shed, both with build specs ready |
| B8 | `scripts/setup.ts` self-mint fallback doesn't exist | **Fixed.** §4.4: A1 writes it in H1-4 (30 min) behind a `self-mint` cargo feature. Decision at H12 from the merchant balance |

### 12.2 Holes
| # | Item | Resolution |
|---|---|---|
| H1 | Receipts not tied to a purchase; QR farming; legal | **Fixed.** D13: cashier [New sale] tap, counter session token on code creation and polling, single-use 90-s codes, one live code per counter. Legal: free entry at the counter on request, so no consideration (H5 rewritten, "not lawyers") |
| H2 | Cosign: zero-amount and ATA-rent drain | **Fixed.** §5.8: signer must be a paid receipt holder, `0 < amount ≤ balance`, source = their canonical ATA, ATA-create only on cash-out, 2/key/day, global 60/h |
| H3 | Rent never reclaimed; ~1.2 SOL/night | **Fixed.** D14 (no ATA on NO nights) + D17 `close_receipts` (receipt rent returned). Remaining real cost: ATA rent on YES nights only, which goes to customers. Numbers in §13 Q5. If `close_receipts` is cut, the slide counts rent as a cost |
| H4 | First-CUTOFF counters vs a later 90% re-attest | **Fixed.** D4: `held_bps_min` over all post-close attestations; the record is written once at `attest_outcome`. Run #2 sell-back moved before tip-off, so its CUTOFF already reads 95%. Invariant I6 |
| H5 | Hedge attested at one instant; merchant can sell after cutoff | **Partly fixed, rest accepted.** PRESETTLE is now never cut, and post-close sweeps run every 15 min, so any drop goes on the record. Positions in the merchant's own Gemini account can't be enforced by us; we say "attested, not custodied" and name Gemini custody as the ask (D4, H6, §3.6 new row) |
| H6 | `orders_hash` is decorative | **Accepted and relabelled.** It is called a commitment only (§3.2). Order ids + fills are published in `/p/[id]/hedge.json`, and Gemini (the bounty sponsor) can confirm them |
| H7 | Key B is a Trader key, not "cannot move funds" | **Fixed.** §3.6 splits the ATTESTOR Solana key (can't move vault funds) from Gemini key B (Trader: *can* trade; can't withdraw). "Read-only" is never said on stage |
| H8 | Cancelled games: MORP vs 72-h YES timeout | **Accepted, disclosed.** D9: customer-favoring timeout kept; merchant bears the void risk; `risk_note` in the hashed terms; relayer posts only binary outcomes (§5.4); "postponed → NO" claim removed (§3.4 #4) |
| H9 | No cancel path when the hedge fails | **Fixed.** D15: `release` any time `sold == 0` |
| H10 | `merchant` unconstrained in crank/release | **Fixed.** Seeds `["merchant", promise.merchant]` on `refund_crank`, `release`, `attest_outcome`, `issue_receipt`; test for a wrong PDA |
| H11 | u32 overflow in capacity math | **Fixed.** u64 cast + `checked_mul` (§3.4 #2, #1); test with 500,000 centi |
| H12 | Verify doesn't catch a false NO with the correct hash | **Fixed.** §6.5: 4th tick compares Gemini's strip outcome to the onchain status |
| H13 | Hero latency inside the 30-s retry | **Fixed/measured.** Direct agent→attestor trigger with order ids, order-history fallback if positions lag > 3 s (key B's own read), warm blockhash, priority fee, 45-s retry, G4 requires < 30 s measured 3× (§5.2, §5.3, §6.4, §9) |
| H14 | In-play sell-back unverified | **Fixed.** The sell-back runs ~6:50 PM before tip-off (§6.2, §7.3) |
| H15 | Finals live promo uncertain | **Fixed.** Saturday Austin high added as the preferred promo if the slot ends before noon. Aggies-OU otherwise. Slot time is open question Q8 (§4.1, §7.1) |
| H16 | NBA settlement lag 2h40m-4h16m | **Fixed.** `expected_resolve_ts = start + 4.5 h`; relayer polls from start + 2.5 h; settlement is automatic and filmed from Explorer the next morning (§3.2, §4.1, §5.4, §7.3) |
| H17 | Schedule risk H4-H19; fallback weather settles after the deadline | **Partly fixed, rest accepted.** Toolchain installs in the background at H0, with a Solana Playground fallback at H3. D20 gives a **guaranteed settled YES payout with a real Gemini hedge by ~H16**, so the video's payout beat no longer depends on Run #1. Accepted: if G2 slips past ~04:30 Thu, the payout clip depends on Run #1 (H40) |
| H18 | Scope vs the user's three ideas | **Accepted, confirm with the user (Q7).** The three ideas are three specs: Hedgehog (this one, includes "money back if hot" and a thin `/w` wallet), Spendthrift (money-back wallet), Shed (grid computing). 2 of 3 ship. Grid computing is not merged here: Gemini lists no power/compute market, and merging blows the 47-h scope. It appears only as a vision-line example |

### 12.3 Inconsistencies
| # | Item | Resolution |
|---|---|---|
| I1 | Threshold 0 vs top-up rule | Fixed (B2, D18) |
| I2 | Sibling names vs memory | **Accepted, spec was right.** The user's latest focus (memory "USER FOCUS" entry) is Hedgehog + Spendthrift + Shed. The MEMORY.md index line naming Earshot/Edge402 is stale. D1 now cites `ideas/build/*.md` |
| I3 | H1 "Gemini already withdraws USDC on Solana" vs unverified | Fixed (H1 and §4.6 reworded) |
| I4 | "postponed → NO" vs sports rules | Fixed (§3.4 #4, D9) |
| I5 | `description` is rich text | Fixed (§5.6: hash the object itself; the display extraction is specified separately; test) |
| I6 | Counters vs 90% re-attest | Fixed (H4) |
| I7 | Attestor "cannot move funds" vs Trader key | Fixed (H7) |
| I8 | `npm run setup` doesn't exist | Fixed (B8) |
| I9 | Rockets "finals only" vs unknown slot | Fixed: Rockets is optional footage; the live promo rule depends on the slot time (Q8) |
| I10 | PRICE_CEILING rejects the hot strip | Fixed (B3) |
| I11 | "Gate is decorative" answered by D4 while PRESETTLE is cuttable | Fixed: PRESETTLE + sweeps are never cut (same code path as CUTOFF) |

### 12.4 Unverified assumptions
| # | Assumption | Where it is checked, or how it is handled |
|---|---|---|
| U1 | Gemini private-API behavior (access, batch, IOC, fills, fees, funding, ACH hold, roles, terms paths) | G1 at H4 via `h0-gate.ts` (§4.2 list) |
| U2 | Texas resident + age can trade sports/weather | U1 step 1 (in-app check before keys) |
| U3 | Positions freshness after a fill | Measured at G1; order-history fallback (§5.3) |
| U4 | In-play NBA tradeability | No longer needed (sell-back before tip-off); bid checked at 6:30 PM Thu |
| U5 | Faucet limits | Requests start at H1 on several wallets; self-mint decision at H12 |
| U6 | Weather settles at 5:02 AM | D20 observes a second data point Thu morning; the video beat has a fallback; R6 |
| U7 | 100-lot books persist; $217.50 is one snapshot | Slide labels it "one snapshot"; re-checked Sat AM; the card always reprices live |
| U8 | Problem-slide headlines and Mattress Mack/Kalshi figure | Sourced by H36 or dropped; the $516K figure is removed (§7.1, §7.4, Q9) |
| U9 | Toolchain installs and builds; deploy size; CU | Background install at H0, Playground fallback at H3; crank tx size and CU measured at G2 (§3.4 #5) |
| U10 | CORS / Gemini 500s during Verify | Cached event copy fallback with a label; warm-up run before the slot (§6.5) |
| U11 | Quick-tunnel stability | Removed: stable hostname mandatory (D16) |
| U12 | Legal framing | Free entry added (D13); H5 says "not lawyers", names Texas Penal Code ch. 47, and promises counsel before production. Accepted residual: judges may still find sports promos aimed at bar customers awkward; customers never see odds |

---

## 13. Q&A prep (judge questions)

**Q1. The vault already holds 100%. What does Gemini add for the customer, and isn't the merchant posting capital twice in two venues?**
"For the customer, nothing, and that's the point. The vault is their whole guarantee, so they never take Gemini or merchant risk. Gemini is what makes the promise *affordable for the merchant*: it turns a 14% chance of losing $1,500 into a fixed $217.50. Capital isn't doubled. The merchant posts the liability ($1,500, for a few hours) plus the premium ($217.50), about 1.15×. If the Spurs win, the vault comes back that night. If they lose, the vault pays customers and Gemini pays the merchant $1,500 in its Gemini account. The merchant is whole minus the premium, just split across two venues today. Closing that gap is exactly what we'd build with Gemini: USDC payouts to the vault, and a lock ratio that drops as the merchant's onchain hedge record grows."

**Q2. Who runs the attestor and relayer? Gemini order ids are private, so how can anyone check the hedge, and what stops a sale one minute after cutoff?**
"In the demo, our team is the merchant and also runs the attestor and relayer. That's disclosed on `/p/`. The onchain order hash is only a commitment. What's checkable is the order ids and fills we publish in `hedge.json`, which Gemini can confirm in seconds. After sales close, the attestor re-reads positions every 15 minutes and before settlement, and the lowest reading goes on the merchant's permanent record, so selling the hedge shows up as a break. We can't stop the merchant from selling in its own Gemini account: the hedge is attested, not custodied. Customers don't care, because their dollar is in the vault. Custody would need a locked hedge sub-account at Gemini, and that's our ask."

**Q3. Anyone who scans gets a $1 claim. What stops a table of students minting all 20? And with a purchase, isn't prize + chance + consideration a lottery in Texas?**
"A QR only appears when the cashier taps 'New sale'. Each code works once, expires in 90 seconds, and the code endpoints need the counter's session, so a photo or a script gets nothing. On consideration: anyone can ask for a receipt free at the counter, no purchase needed, which is the standard no-purchase-necessary structure, and everyone gets the same conditional rebate. Nobody picks a side or sees odds. It works like the money-back promotions Gallery Furniture made famous in Texas. We're not lawyers, and we'd clear Texas Penal Code chapter 47 with counsel before a real launch."

**Q4. What if the game is postponed or cancelled? Gemini sends that to a review process, but you pay YES after 72 hours.**
"Our relayer only posts a clean yes/no from Gemini. While Gemini shows cancelled or under review, it waits. If nothing settles within 72 hours of the expected result, customers get paid. That's deliberate: the merchant made the promise, so the merchant carries that rare risk, the same as any money-back promotion. It's written into the terms the customer can re-hash. If Gemini later resolves NO, the merchant loses that premium too. For an NBA moneyline that's a fraction of a percent of nights. A v2 relayer could post a 'void' outcome that releases the vault when Gemini voids the market."

**Q5. All-in cost at 300 covers? And have you talked to a real merchant?**
"For 300 covers with $5 back if the Spurs lose: the premium is $217.50 on today's book. That's about $15 of spread over fair. Gemini fees are budgeted at no more than 2 cents a contract, so at most $30, but we haven't measured them yet. On Solana, receipt rent of about 0.58 SOL is a float that `close_receipts` returns. Customer token accounts are created only on payout nights: 0.6 SOL, which goes to the customers, so about 0.09 SOL per night in expectation. Fees are a fraction of a cent per receipt. All-in is roughly $250-265 a night against a 14% chance of a $1,500 loss. The hedge costs about $40-55 more than the expected loss, and in exchange the variance is gone. The weather pair's $1.10 per paired dollar is our demo device for a guaranteed payout, not a product. A single weather promo costs Σask, for example 45 cents. The $1,500 is locked for about 5-8 hours. Merchants: no, not yet. Our merchant is our own cart and watch party, and we say so. The demand evidence is the bar-promo stories (shown only where we have sources), and the next step is three Guadalupe bars."

(SOL figures assume about 0.00193 SOL of rent per receipt and 0.00204 per token account at current devnet rent. Dollar conversions on the slide use the live SOL price on the day.)
