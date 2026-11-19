# Money-flow audit: Hedgehog v2 (2026-11-19, ~04:00 CST)

Scope: owner pays USDC on Solana devnet → gets outcome tokens (mock DFlow venue, `lib/venue/mock.ts`) or a Hedgehog Cover
policy (`programs/hedgehog_policy`) → the desk plans a matching Gemini backing order (`lib/venue/geminiHedge.ts`, dry-run)
→ the market settles → the crank (`lib/venue/crank.ts`, `scripts/worker.ts`) pays winners on Solana.
Method: read every file on the path, ran the deployed binary on a local validator with attack scripts, ran
`anchor test`, `scripts/e2e-mock.ts` and `scripts/smoke-api.ts --flow` on devnet. Line refs marked `@HEAD` are to commit
`9166bda`-era code before this audit.

## Verdict

The token path (mock venue) was sound: the desk co-signs a fixed tx (same contract, side, quantity and price as the
quote; memo bound to the position id), confirm checks the landed tx, payouts are `burn + pay` in one atomic tx bounded by
the tokens burned, and the crank is idempotent (memo lookup). It lacked risk limits and a voided-market path.

The Cover path had **two critical holes in the deployed program**, both reproduced against the deployed binary:
anyone could buy a policy at any price they liked, and anyone could drain the vault through a policy of an underwriter
they created themselves. Both are fixed in an in-place devnet upgrade, with tests. There was also no crank for policies
(they were only settled by hand). After the fixes the flow is valid end to end for a devnet demo. The trust assumptions
(the desk, the attestor and the dry-run backing) are listed under "Remaining risks".

## Findings

| # | Sev | Issue | Decision |
|---|-----|-------|----------|
| F1 | critical | Cover `buy_policy` was not co-signed: buyer sets premium/payout/market/expiry | **Fixed** (program + API) |
| F2 | critical | Cross-underwriter `expire_policy`/`settle_policy` drains any vault | **Fixed** (program) |
| F3 | high | No desk exposure ledger or caps for outcome tokens (paid from the desk wallet) | **Fixed** (ledger + caps) |
| F4 | high | No crank for Cover policies; settlement was manual (`scripts/settle-policy.ts`) | **Fixed** (crank) |
| F5 | medium | Voided/cancelled markets: positions stuck `open` forever, no refund | **Fixed** (crank refund) |
| F6 | medium | Backing failure had no consequence (sales continued unbacked) | **Fixed** (circuit breaker, armed when live) |
| F7 | medium | No margin: sold at ask, backed at up to ask + 2¢ ⇒ expected loss | **Fixed** (configurable visible fee, default 0) |
| F8 | medium | Sales allowed after a market's expiry while the venue still says `open` | **Fixed** |
| F9 | medium | Concurrent confirms could place two live backing orders | **Fixed** (in-flight lock) |
| F10 | medium | Cover side kept only off-chain; crank defaulted unknown side to YES | **Fixed** (never guess) |
| F11 | low | Owner shown a stale price (UI quote may be minutes old) | **Fixed** server side (`price_moved`); UI wiring pending |
| F12 | low | No proof-of-reserves view | **Added** `GET /api/reserves` |
| F13 | medium | Kalshi-priced devnet tokens/policies have no backing at all | Document |
| F14 | medium | No Gemini depth check (cap is a flat $ per market) | Later |
| F15 | low | Delegate-approve race (two concurrent buys on one mint) can under-delegate | Document |
| F16 | low | JSON-file store shared by Next + worker, not transactional | Document |
| F17 | low | `/api/qn-webhook` open when `QN_WEBHOOK_SECRET` unset (feed text only, no money) | Set the secret |
| F18 | info | Trust: desk can burn delegated tokens; attestor = quoter = settler (one hot key) | Document |

### F1 (critical): unpriced Cover sales. Fixed.
- Evidence: `buy_policy` took `premium`, `payout`, `market_ref`, `expiry` from instruction args with no signer other than
  the owner (`programs/hedgehog_policy/src/lib.rs:86 @HEAD`). `/api/cover/buy` passed the client's `premiumUsd`/`payoutUsd`/
  `expiry` straight through (`app/api/cover/buy/route.ts:1,22,33 @HEAD`). Reproduced on a local validator with the deployed
  `.so`: a $1 premium for a $400 payout was accepted. A client-chosen `expiry` also let a buyer set an early expiry and
  later refund a losing policy via `expire_policy`.
- Fix: new `quoter: Signer` account on `buy_policy`, `require_keys_eq!(quoter, underwriter.attestor)` (error
  `NotQuoter`). `/api/cover/buy` now prices from the live market: `payout = contracts × $1`,
  `premium = contracts × live ask (cents up) + fee`, `expiry = market expiry + 48 h` (`COVER_RESOLUTION_BUFFER_H`), and
  partially signs as quoter. The quoter signature is bound to a recent blockhash, so **the quote expires in about 60-90 s**.
  `premiumUsd` from the client is only used as "what the owner saw" (see F11). The API stays backward compatible
  (`payoutUsd` is still accepted as the contract count).
- Tests: `tests/cover.test.ts` "F1: a sale not co-signed by the underwriter's quoter is rejected"; devnet smoke
  "cover with a forged $0.01 premium refused".

### F2 (critical): vault drain via a foreign underwriter. Fixed.
- Evidence: `init_underwriter` is permissionless (`lib.rs:25 @HEAD`), Policy PDAs were `["pol", business, id]`
  (`lib.rs:399 @HEAD`), and `SettlePolicy`/`ExpirePolicy` never tied the policy to the underwriter passed in. Attack:
  create a junk mint and an underwriter for it, sell yourself a 99-junk-premium policy, then call `expire_policy` with
  **Hedgehog's** underwriter and vault. Reproduced on a local validator with the deployed `.so`
  (tx `3RGjA3wx87pQkKg6d1ZoFLJSK1nAHvA1DUcpe87veN6zR6cYaDyZvgkm9T7rtcYfWtqmWBzFoo485QXMFqsZBpRs` on localnet):
  Hedgehog vault 501 → 402, attacker +99 real test-USDC. Repeatable until the vault is empty.
- Fix: new policies use seeds `["pol", underwriter, business, id]`. `settle_policy`/`expire_policy` re-derive the address
  from the passed underwriter (`check_policy_underwriter`, error `WrongUnderwriter`). The 4 pre-upgrade policies keep
  working through a legacy branch that is allowed **only** for the devnet underwriter `721j9Ywe…` (the only one that ever
  sold policies). No account layout changed.
- Tests: `tests/cover.test.ts` "F2: a policy cannot be refunded or settled from another underwriter's vault". On devnet
  after the upgrade, simulating `settle_policy` on legacy policy `5kuhGdt6…` passes the check, and `expire` fails only with
  `NotExpired`.

### F3 (high): desk exposure for outcome tokens. Fixed.
- Evidence: the Cover program checks exposure against the vault, but token payouts come from the desk wallet
  (`mock.ts:216 @HEAD` mints any shortfall because the desk is the test-dollar mint authority). Nothing limited how much
  the desk sold.
- Fix: `lib/venue/risk.ts` keeps a ledger: worst-case $1 × contracts for every confirmed open/won devnet position, plus
  buys built in the last 3 min that may still land. Caps are checked in `MockDflowVenue.buildBuyTx`:
  `DESK_MAX_PER_MARKET_USD` (default 100) and `DESK_MAX_EXPOSURE_USD` (default 500). Breaching one returns 409 `capacity`
  with the number of contracts left. Concurrent builds can overshoot by at most one order (no lock); that is fine at
  these sizes.
- Tests: `tests/venue-risk.test.ts` (ledger, caps); devnet smoke "per-market desk cap → 409".

### F4 (high): no crank for Cover policies. Fixed.
- Evidence: `scripts/worker.ts @HEAD` handled positions only. Policies were settled by hand.
- Fix: `crankPolicies` in `lib/venue/crank.ts`, wired in `scripts/worker.ts` (`coverCrank()`, signed by
  `keys/attestor.json`). For each open on-chain policy: if the market settled YES/NO, it calls
  `settle_policy(outcome = resolution == policy side)`. Otherwise, after expiry + grace, it calls `expire_policy`
  (premium refund). Idempotent: it only lists open policies, and the program rejects `AlreadySettled`.
- Tests: `tests/venue-risk.test.ts` "crank: … Cover policies settle by side, expire after grace; idempotent". A live
  `worker --once` on devnet listed 5 open policies, none due yet. The policy bought in the smoke run on
  `GEMI-WXHIGH-LTAC-2611192059-15TO15` settles automatically once Gemini resolves it, **if the worker is running**.

### F5 (medium): voided or cancelled markets. Fixed.
- Evidence: the crank skipped anything without a YES/NO resolution (`crank.ts:32 @HEAD`), so tokens stayed `open`
  forever and there was no refund.
- Fix: `isVoided` = settled with no YES/NO, more than 24 h past expiry. `MockDflowVenue.refund` burns the still-burnable
  tokens and refunds the premium pro rata, with memo `hedgehog:refund:<id>` for idempotency. The position becomes
  `redeemed` with `voided: true` and `payoutUsd` = the refund. Cover policies on a voided market are refunded by
  `expire_policy` once expiry + grace has passed.
- Evidence (devnet): `scripts/e2e-mock.ts` step 8, buy `53gjdw3X…` and refund `vWKHSmbK…` ($1.20 back, no double refund).

### F6 (medium): backing-failure policy. Fixed.
- Evidence: `backOnGemini` recorded `error`, `rejected` or `partial` and sales continued.
- Fix: `checkBacking` (circuit breaker). If an earlier backing order on a Gemini contract errored, was rejected or only
  partially filled, new sales of that contract return 409 `backing_failed`. It is armed when backing is live (or with
  `DESK_BACKING_BREAKER=1`). In dry-run nothing is really hedged, and a transient Gemini 429 at confirm time must not pause
  a demo market. Reset with `DESK_IGNORE_BACKING=1` or by deleting the hedge row.

### F7 (medium): no margin. Fixed as a configurable, visible fee.
- Evidence: the owner pays exactly `ask × contracts` (cents rounded up). The backing limit is `ask + 2¢` IOC
  (`geminiHedge.ts:13 @HEAD`), so every fill above the ask is a loss for the desk, and Gemini fees (unverified) come on
  top.
- Fix: `HEDGEHOG_FEE_BPS` (default **0**, clamped to 2000), applied in `priceBuy`. Every price is returned as
  `marketCostUsd + feeUsd = costUsd` (`pricing` in the `/api/hedge/buy` and `/api/cover/buy` responses, and
  `Position.marketCostUsd/feeUsd`). `/api/reserves` shows the setting.
- **Recommended value: keep 0 for the demo.** Turn it on (300 bps) only after the UI shows "market price + Hedgehog fee".
  Today the checkout shows `line.premiumUsd` (market price only) and does not send `maxCostUsd`, so a non-zero fee would
  charge more than shown. Why 300 bps: insurance-like contracts trade at 10-40¢. When the top of the Gemini book covers
  the size, the IOC fills at the ask (0 slippage). Expected slippage on thin books is about 0.5-1¢, which is 1-3% of a
  20-30¢ premium. A flat bps fee cannot cover the 2¢ worst case on a 10¢ contract (20%). The production answer is a
  per-contract spread (≥1¢) plus depth-aware sizing (F14).

### F8 (medium): buying after expiry. Fixed.
`priceBuy` now refuses when `Date.now() >= contract.expiry`, even if the venue still reports `open` (400
`market_expired`). It already refused `closed`/`settled` markets and asks above 0.85.

### F9 (medium): duplicate live backing orders. Fixed.
`backOnGemini` was idempotent by row (`geminiHedge.ts:113 @HEAD`), but two concurrent confirms both read "no row" and
would both place orders. It now shares an in-flight promise per hedge id. Test: "concurrent confirms place ONE order"
(order function injected; no network).

### F10 (medium): unknown Cover side. Fixed.
The paying side lives only in `.data/policies.json`. `/api/cover/confirm` and the old settle path defaulted a missing
side to YES (`cover/confirm/route.ts:34 @HEAD`). The crank now refuses to settle a policy whose side is unknown, so the
owner gets the premium back after expiry + grace instead of a wrong-side payout. One legacy policy (`9Z4sJW33…`, created
before `side` existed) falls in this group.

### F11 (low): stale price shown to the owner. Fixed server side.
- Quote expiry was already implicit for tokens: the desk's partial signature is bound to a blockhash (about 60-90 s).
  Cover now has the same property (F1). Prices are read fresh from Gemini at build time (`eventByTicker(t, 0)`).
- New: `/api/hedge/buy` accepts `maxCostUsd`, and `/api/cover/buy` treats `premiumUsd` as the shown price. If the server
  price is higher than 1.01 × shown + 1¢, the request returns 409 `price_moved` ("refresh the quote"). Both responses
  include `quoteExpiresAt`.
- UI follow-up (not done, because `components/**` belongs to another agent): `components/CheckoutDialog.tsx` should send
  `maxCostUsd: line.premiumUsd` in `hedgeBuy(...)` and display `pricing.feeUsd` when it is non-zero.

### F12: proof of reserves. Added.
`GET /api/reserves` returns:
- the Cover vault vs on-chain exposure (enforced by the program);
- the desk wallet vs token exposure and the caps;
- the backing mode and any unbacked sales;
- the fee.

Devnet now shows a vault of $503.74 against $12 of exposure, and $18 of token exposure (caps 100/500). Suggested
how-it-works line (UI owner): "Every dollar Hedgehog owes is visible: `/api/reserves`."

### F13 (medium): Kalshi-priced devnet sales are unbacked. Document.
The desk backs Gemini contracts only. Kalshi-priced devnet tokens and policies are capped (F3, and the vault for Cover)
but not hedged. On mainnet the owner buys the real DFlow/Kalshi token directly, so there is no Hedgehog exposure at all.

### F14 (medium): no depth check. Later.
The cap is a flat $100 per market. A real desk should cap each sale at the Gemini depth available at or below
`ask + slippage` (`lib/markets/geminiPm.book`). This only matters once backing is live.

### F15 (low): delegate approve race. Document.
`approve(prior delegated + n)` is computed at build time (`mock.ts:136 @HEAD`). Two concurrent buys on the same outcome
mint can leave the delegation short, and then the auto-payout pays only the delegated amount. The owner keeps the
remaining tokens, but the mock venue has no owner-signed redeem. Revoking the delegate or moving the tokens also forfeits
the automatic payout (already stated in `mock.ts`).

### F16 (low): JSON-file store. Document.
`.data/*.json` uses read-modify-write from two processes (Next and the worker), so a lost update is possible. The crank
recovers missing `txSig` values from the memo on chain, and payouts are bounded on chain. Acceptable for a demo; it would
need a database for production.

### F17 (low): webhook auth. Set the secret.
With `QN_WEBHOOK_SECRET` unset, anyone can POST feed events. Only feed text is affected; no money path reads it. Set the
secret for the demo URL. The `?secret=` query form can leak into logs, so prefer the header.

### F18: trust model (state it plainly)
- **Desk** (`keys/desk.json`): mint authority of every outcome mint and of the devnet test dollar. It holds a delegate
  over owners' outcome tokens so it can auto-pay, which means it could also burn them early. This is a devnet stand-in
  for DFlow. On mainnet, owners hold real Kalshi tokens and redeem them themselves.
- **Attestor** (`keys/attestor.json`): one hot key that quotes (F1) and settles Cover policies. Its decision comes from
  Gemini's or Kalshi's official resolution through the crank, not from an oracle network. The safety valve: if it never
  settles, anyone can refund the premium after expiry + grace.
- **Upgrade authority**: `keys/deployer.json` (single key).
- **Backing is dry-run**: no real Gemini orders are placed (`HEDGE_LIVE` is unset). On devnet the desk's "solvency" is
  synthetic, because it mints the test dollar.

### Checked and OK (no change needed)
- **Price math:** cents are rounded up with float guards (`centsUp`). Raw amounts go through integer cents
  (`usdToRaw`). Cover uses 1e6 units. Payout is exactly $1 × burned tokens, and refunds are floored to the cent. Overflow:
  `checked_add`/`saturating_*` on every u64 path.
- **Side semantics:** the owner buys the side that pays when the business is hurt (from the advisor line). Tokens pay
  when `resolution === pos.side`, and Cover pays when `resolution === policy side`. Backing buys the same symbol, outcome
  and quantity as was sold (verified on devnet: sold 2 YES `GEMI-WXHIGH-LTAC…15TO15`, planned BUY 2 YES same symbol @
  0.60; Cover 3 → BUY 3).
- **Confirm forgery and replay:** the desk signature covers the whole message, the memo binds the position id, and
  confirm checks owner signer, outcome mint, memo and `meta.err`. A signature replayed on another position is rejected
  (devnet smoke: "tx memo does not match the position"). Confirm is idempotent and returns the same backing row.
- **Double payout:** burn and pay happen in one tx. A crank crash mid-redeem is recovered by the memo lookup (devnet
  e2e: second pass and direct re-redeem return the same sig). Even without the memo, the payout is bounded by tokens
  burned.
- **Program authorization:** settle is attestor-only (`NotAttestor` test). Expire is anyone, but only after expiry +
  grace and only as a premium refund to the policy owner's ATA. Token program and mint are pinned by `has_one`,
  `token::mint` and `address = underwriter.token_program`. `owner_token` authority = `policy.owner`.
- **Failure modes:** RPC sends are retried until the blockhash dies. An unsigned or expired buy stays unconfirmed, drops
  out of exposure after 3 min and out of the UI after 10 min. If Gemini is down, buys fail closed, the crank retries, and
  backing is recorded as `error` (visible).

## Devnet evidence (2026-11-19)
- Program upgrade (in place, same id `4H7QHtz7…`, buffer rent refunded): `QMqdnnFJX619YskzTvE8ceLoop5D9xJYEkVZp81QsxhuCTbS9UJisxfuqvzACkq1qBsy5u9XDrcuo5srzGrZ2WW`
- `anchor test` (local validator, new binary): 9/9 including F1 and F2.
- `scripts/smoke-api.ts --flow` through the API: token buy `2nHENKrR6qxuvaK19jQTnaivCFSrh4JMiVKtFPjXMYSQBFWxxbg5MCt4zSUFEsVajorjBTzcEEGVYJxZxp8uYrVD`;
  quoted, co-signed Cover policy `3QF2KLdzGzfjEDWwYWbJzAP4y921TcfASYAC3ZGGeosdAyqV4ZaHvqVjqoak86h33grK6H3kKh2DXWhjrhy4yPC6`
  ($1.74 premium for a $3 payout at ask 0.58; expiry = market + 48 h). Also covered: replay rejected, `price_moved`,
  `capacity`, forged premium refused.
- `scripts/e2e-mock.ts`: buyYes `5jsLszS3…`, buyNo `5QZdDaJ1…`, redeem `cTpyNW3J…` ($3 paid, tokens burned, no double
  payout), buyVoid `53gjdw3X…`, refund `vWKHSmbK…`.

## Ops notes for the demo
- Run the worker (`npm run worker`) next to `next dev`. Without it, nothing settles automatically (tokens or policies).
- Env knobs: `HEDGEHOG_FEE_BPS` (0), `DESK_MAX_PER_MARKET_USD` (100), `DESK_MAX_EXPOSURE_USD` (500),
  `COVER_RESOLUTION_BUFFER_H` (48), `DESK_BACKING_BREAKER` / `DESK_IGNORE_BACKING`, `QN_WEBHOOK_SECRET`.
- `scripts/settle-policy.ts` still works for manual settlement. Any external script that builds `buy_policy` must now
  pass `quoter` (the attestor keypair) to `CoverClient.buildBuyTx`.
