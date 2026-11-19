# Settlement: lags, crank, evidence

Measured 2026-11-19 ~22:00 UTC from the venues' own timestamps (scripts in the session scratchpad; method below).

## How long after the event each venue reports a result

| Venue | Market | Measure | Lag (min / median / max) |
|---|---|---|---|
| Gemini | BTC/ETH/SOL/XRP 5m-hourly-daily | `resolvedAt − expiryDate` (n≈600) | 6 s / 8 s / 2.3 min |
| Gemini | WXHIGH daily highs (60+ cities) | `resolvedAt − expiryDate` (n=1000) | 6.0 h / 6.0 h / 6.1 h (one outlier 4.5 days). Status reads `under_review` before that |
| Gemini | NBA moneyline | `resolvedAt − startTime` (n=22) | 138 / 156 / 256 min |
| Kalshi | KXNBAGAME | `settlement_ts − game start` (n=30) | 131 / 152 / 187 min (≈2 min after the market's early close) |
| Kalshi | KXHIGH* daily highs | `settlement_ts − close_time` | 6.1 / 6.2 / 6.3 h |
| Kalshi | KXRAINWKND weekend rain | `settlement_ts − close_time` | 7.5 / 7.5 / 7.7 h |
| Polymarket | NBA moneyline | `closedTime − gameStartTime` (n=30) | 145 / 165 / 198 min (about 13 min after Kalshi) |

Expect a game to pay out about 2.5 h after tip-off, a crypto price within a minute, and a daily weather high about 6 h after local midnight.

## How the crank works (`lib/venue/crank.ts`, `npm run worker`)

- Every 60 s (`CRANK_INTERVAL_MS`) it lists the open onchain policies and calls `getContract(marketRef)` on the venue.
- If the result is YES or NO, it calls `settle_policy(outcome = result == side)`, signed by the attestor. A hit pays the owner from the vault. Otherwise the policy closes with no payout.
- After `expiry + grace` (grace = 3600 s onchain) with no result, it calls `expire_policy`, which refunds the premium. Policies bought now carry `expiry = market expiry + 48 h` (`COVER_RESOLUTION_BUFFER_H`).
- **New:** while the venue still shows the market as open, closed or under review, the crank keeps the policy open for up to `COVER_RESULT_WAIT_H` (72 h) past its expiry. `settle_policy` has no onchain deadline. A venue API error never triggers a refund; the crank retries on the next pass. A market that settles with no result (voided) is refunded right away.
- How each venue's result is read: Kalshi `result` yes/no or status `settled`/`finalized`/`determined`; Gemini `resolutionSide` (now case-insensitive); Polymarket `closed` with `outcomePrices[0]` ≥ 0.99 (YES) or ≤ 0.01 (NO).

### Bugs fixed (tests in `tests/settlement.test.ts`)
1. **Polymarket results were never seen.** Gamma `/markets?slug=` leaves out closed markets, and a resolved market is closed. `getContract` returned null, so policy #6 would have been refunded instead of settled. The lookup now retries with `&closed=true`. Checked live: `polymarket:nba-uta-lal-2026-11-18` → settled YES.
2. **Kalshi weekend rain would have refunded before Kalshi settled.** Policy #1 (bought before the 48 h buffer existed) expires at the market close (Nov 23 06:00Z), while Kalshi settles about 7.5 h later. The crank now waits for the result (see above).
3. An API error at the deadline no longer refunds a policy.
4. Policy #0 had no `side` recorded locally, so the crank would only have refunded it. I backfilled `side: "no"`, because its trigger is "San Antonio Spurs lose" on the SAS-wins contract (the matching hedge `pos_mwn72olvy1m3iz` is NO). The note is in `.data/policies.json`.

## Open real-market policies and when they should settle

All are owned by the merchant test wallet, so they are hidden from the public feed but still settle. Times are in UTC (CST = UTC−6).

| # | Market | Side | Venue result expected | Policy refund deadline |
|---|---|---|---|---|
| 0 | kalshi:KXNBAGAME-26NOV19LACSAS-SAS | NO | ≈ Nov 20 03:30 | Nov 22 02:00 |
| 2 | gemini:GEMI-NBA-2611200100-LAC-SAS-M-LAC | YES | ≈ Nov 20 03:35 | Nov 21 14:00 |
| 5 | kalshi:KXNBAGAME-26NOV19GSWMEM-GSW (400 USDC) | YES | ≈ Nov 20 03:30 | Nov 24 02:00 |
| 6 | polymarket:nba-gsw-mem-2026-11-19 | YES | ≈ Nov 20 03:45 | Nov 22 02:00 |
| 3 | gemini WXHIGH-LTAC-2611192059 | YES | ≈ Nov 20 03:00 | Nov 21 22:00 |
| 4 | gemini WXHIGH-EFHK-2611192159 | YES | ≈ Nov 20 04:00 | Nov 21 23:00 |
| 8 | gemini WXHIGH-EDDM-2611192259 | YES | ≈ Nov 20 05:00 | Nov 22 00:00 |
| 9, 12 | gemini WXHIGH-SAEZ-2611200259 | YES | ≈ Nov 20 09:00 | Nov 22 04:00 |
| 10, 11, 13–16 | gemini WXHIGH AUS/DEN/DFW/HOU-2611200459 | YES | ≈ Nov 20 11:00 | Nov 22 06:00 |
| 1 | kalshi:KXRAINWKND-26NOV21-AUS | YES | ≈ Nov 23 13:30 | held by the crank wait |

Everything except #1 should settle before the Devpost deadline (Nov 20 18:00Z). Check with `tail .data/worker.log`, or with the `policy_settled` feed event (`?owner=J4Fo…` shows the test wallet's events).

## Real-market settlements so far

**None yet.** Every earlier settle tx is test data. Policy #7 is on a Hedgehog parametric market (`hedgehog:hail:…`), and `e2e:devnet-smoke` is an e2e fixture. The e2e "BTC YES paid" positions were settled against a mocked contract (the real `GEMI-BTC2611192200-HI63250` resolved NO at 22:00:08Z). Add the sigs here when tonight's games settle: `https://explorer.solana.com/tx/<sig>?cluster=devnet`.

## Fallback for the demo video

If tonight's payouts lag or go wrong, do not show #7 or the e2e settlements as real-market payouts. Use one of these instead:
1. **Best:** the #2, #5 or #6 settle tx from tonight. Games end by about 04:00Z, so these exist by Nov 20 morning.
2. If they are missing, the Gemini weather policies (#10–#16) settle about 11:00Z Nov 20, still well before the deadline.
3. Last resort (about 2 minutes, devnet only): buy a 1-contract Cover policy on the next Gemini hourly BTC market (e.g. `GEMI-BTC26112xHH00-HI…`). Gemini resolves about 8 s after expiry, so the crank settles within 1–2 minutes. That gives a real-market settle tx on camera.
