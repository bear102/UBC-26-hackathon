# AI recommendation eval (Hedgehog v2)

How we measured and improved the advisor that turns a small business into a hedge plan
(`advise()`: risk map → creative ideas + industry playbook → candidate markets → matcher → side/date guards → sizing → packages).
Five RUN → EVALUATE → IMPLEMENT iterations on 2026-11-19. A change was kept only if its target metric improved and nothing else regressed beyond LLM noise.

## Setup

**Benchmark set (9 businesses).** The 3 demo presets (Rainey St patio bar, East Austin birria truck, catering with 4 vans) plus 6 deliberately different Austin businesses in `tests/fixtures/eval-businesses.json`: a roofing contractor (rain days, copper, credit line), a same-day courier (fuel, rain), a weekend coffee cart (rain; cold *helps*), a mortgage broker (Fed, CPI; no weather exposure), a short-term-rental host (Longhorns weekends, weather cancellations), and a crypto-paid merch shop (BTC/SOL).

**Harness:** `scripts/eval-ai.ts`.
- `snapshot` freezes the live market universe (Gemini + Kalshi + Polymarket, with per-contract metadata) to `.data/eval/markets*.json`. Every iteration runs against the same snapshot: candidate search is the real `rankCandidates()`, and sizing is the real `sizeQuote()` without live order-book fetches.
- LLM calls go through a **record/replay cache** keyed by `sha256(tier + system + prompt + schema)` and stored in `.data/eval/llm-cache.json`. Unchanged prompts replay for free. A cache miss fails, which exercises the fallback path, unless `--live` is set. Summary calls are never spent live.
- Each run does two passes: the normal path, then a **robustness pass with every LLM call failing**. Outputs and scores go to `.data/eval/<tag>/{main,nollm}/`.

**Metrics** (deterministic, except relevance):

| metric | definition |
|---|---|
| validity | % of plan lines + option choices that pass every check: the id is in the universe, the contract is open and not expired, the ask is ≤ 0.85, the **side pays when the business is hurt** (temperature/price direction, team win/lose by subject parsing, Fed hike/hold/cut, rain YES), the **asset matches** the one the risk names (gold ≠ copper, SOL ≠ BTC), and the contract's observation dates overlap the risk window (±1 day for local weather, ±3 for games, ±45 for macro) |
| coverage | % of direct risks with ≥1 valid, buyable choice (`inPlan` = has a buyable line in the default plan) |
| creativity | number of proxy/creative risks with a valid hedge and a causal story of 20+ characters; `nat` = natural hedges flagged |
| relevance | mean of a human grade per plan line. **2** = tracks a loss driver the owner described, with a sensible strike and date. **1** = plausible but loose (generic demand proxy, off date, lottery-priced, or a pricey near-certain strike). **0** = irrelevant, wrong asset, or contradicts the owner. Grades are in `tests/fixtures/eval-grades.json` (≈170 graded lines; single rater, no LLM-as-judge) |
| price sanity | max ask, # buyable plan lines with ask > 0.60 (prepaying, not insurance), premium/payout, budget use |
| offDay | # weather lines whose observation days are all outside the owner's busy days (e.g. weekend rain for a Mon–Fri roofer) |
| honesty | basis-risk sentence present (≥25 chars, not the heuristic stub); "overstated" = proxy marked *strong* with no hook in the owner's words |
| cost | LLM calls per `advise()` (≤4 invariant), live/missed calls, seconds |
| robustness | the same metrics with every LLM call failing |

## Results per iteration

LLM path = old snapshot (2,961 contracts), industry playbook on (production config). The model was effectively **gemini-3.1-flash-lite**: 2.5-flash's free quota was already used up. Matcher re-samples at temperature 0.3, so ±0.05 relevance and ±1 pricey line is noise.

| # | change | target | LLM path before → after | LLM-down path before → after | kept? |
|---|---|---|---|---|---|
| 0 | baseline (+ industry playbook landed mid-setup) | — | valid 96%, cov 83%, rel 1.00, >0.6: 7, offDay 5, creat 19, prem/pay 0.19 | valid 98%, cov 72%, rel 1.12 | — |
| 1 | **Asset-aware candidate retrieval** (`rankCandidates` + `underlyings()`): a risk that names BTC/copper/natural gas/WTI only gets contracts on that underlying; exact name +1 (WTI before Brent) | coverage | cov 83→**93%**, valid 96→98%, rel 1.00→1.05, >0.6 7→5 | unchanged | ✅ |
| 2 | **Side guard** (`guardSide`): threshold contracts must use the side that pays in the bad direction; a wrong side is flipped if the other side is ≤0.85, otherwise dropped; NO on a range bucket is dropped | validity | valid 98→**100%**, cov 93→**100%** (a mis-sided heat risk became coverable), rel 1.05→1.02 (one extra so-so line) | unchanged | ✅ (0 LLM calls) |
| 3 | **Prompt rules**: tie every risk to the owner's words; weather risks must fall on busy days; asks 0.10–0.50 preferred, >0.60 only as "broad" | relevance, offDay | rel 1.02→**1.07**, offDay 7→5, >0.6 5→4, prem/pay 0.18→**0.13**; cov 100→86% (2 of 4 drops were honest "no weekend market" results, 1 came from the new `metals` peril vs the frozen snapshot) | — | ✅ |
| 4 | **Grounding guard** (`groundedRisk`): drop direct gas/oil/Fed/CPI risks that have no hook in the description (flash-lite ignored rule 3 for a mortgage broker and a coffee cart) | irrelevant macro lines | grade-0 macro lines in plan 2→**0** (mortgage broker's $185 gas hedge gone); validity and coverage flat | — | ✅ |
| 5 | **Fallback quality + dedupe**: business-aware fallback risk map; heuristic honors "X wins" vs "X loses"; rain fallback picks event markets on busy days; Fed fallback understands hold/cut/hike labels; YES buckets on the wrong side of the trigger rejected; idea candidates within 60 days; matchup-aware game dedupe | robustness | duplicate Spurs double-buy removed; otherwise flat (cov 85%, rel 1.05) | valid 98→**100%**, cov 72→**83%**, rel 1.12→**1.35** | ✅ |
| 5b | re-baseline on the **new universe** (4,311 contracts after the market expansion; replay only, so this is the deterministic/fallback path) | — | — | valid 96→**100%** and cov 87→**97%** after one fix: Gemini's new `"Cut >25bps"` labels fooled the fallback (`>` read as "above"), so it bought a cut for a "no cut" risk | ✅ |

**Overall:**
- LLM path: validity 96→100%, coverage 83→85% (peaked at 100% in iteration 2, then traded for honest "no market on your busy day" answers), relevance 1.00→1.05, lines priced above 0.60 7→6, premium/payout 0.19→0.14.
- LLM-down path: validity 98→100%, coverage 72→83% (97% on the new universe), relevance 1.12→1.35.
- Every `advise()` still uses ≤4 LLM calls, every pick is still a real candidate id, and `npm test` passes 100/100 (regressions are pinned in `tests/ai-eval.test.ts`).

## Before / after examples

- **Roofer, "copper price spike":** before, the hedge was **gold** ≥ $3,725 at 54¢ ($180). Copper wasn't in the top-12 candidates. After: Copper ≥ $6.30 on Nov 30 at 10¢.
- **Crypto merch, "Bitcoin drop":** before, *uncovered*, because the candidates were ZEC/XRP/SOL. After: NO on "BTC ≥ $63,500" at 49¢.
- **Crypto merch, "US gas spike":** before, the matcher bought **NO** "gas above $3.64", which pays when gas does *not* spike. The side guard now flips or drops it.
- **Coffee cart, "cold ≤ 44°F":** before, YES on the **45–46°F** bucket, which can't pay at ≤ 44°F. That pick is now rejected.
- **Mortgage broker:** before, $185 of a $500 budget went to "US gas prices this week" (relevance 0). After, that risk is dropped and the budget goes to Fed-hold (4¢) and CPI.
- **Patio bar:** before, the Spurs–Clippers game was bought twice: a direct risk on Gemini and a playbook "our team loses" idea on Kalshi. Now it's one line. "Southern Utah vs Texas" (basketball) no longer suppresses "Arkansas vs Texas" (football).
- **LLM down, courier:** before, a Fed-hike idea came from the word "credit**s**" (late-delivery credits) and landed on the **Apr 2027** meeting. Both are fixed.

## Remaining weaknesses (from the last outputs)

1. **Matcher variance on flash-lite.** The same prompt can pick a 0.39 or a 0.81 CPI strike. Pricey lines (>0.60) persist (6 of 37 plan lines).
2. **Lottery and same-day lines:** "rain in Austin *today*" at 1¢, "Southern Utah upsets Texas" at 2¢. They are valid but rarely worth buying, and "today" risks are mostly already decided.
3. **Sport/date mismatch for team risks:** a Longhorns *football weekend* risk gets hedged with a Longhorns *basketball* game.
4. **Playbook misfires:** a coffee cart gets "Diesel for tractors and hauling"; a mortgage broker gets "monthly rainfall > 5 in".
5. **Weekday weather gaps:** live markets cover today/tomorrow, weekends and Thanksgiving, so Mon–Fri businesses often show "no market on your busy day". That is honest, but it lowers coverage.
6. **Single rater.** Relevance grades are one reviewer's judgment. Deterministic metrics carry most of the evidence.

## Next 3 things worth doing

1. **Deterministic "insurance price" rule in plan selection:** when the recommended choice asks more than 0.60 and a cheap-tail choice exists, default to the cheap tail. Also run the matcher at temperature 0. This removes most of the variance in (1) without an LLM call.
2. **Min-value filter:** drop or demote asks below 0.03 and same-day markets that have already started, unless they are the only hedge.
3. **League-aware team matching** (football vs basketball, using `contractMeta.league`) in `rankCandidates`, plus a stricter industry match for playbook seeds.

## Reproduce

```bash
npx tsx scripts/eval-ai.ts snapshot --snap markets-v2.json        # freeze the market universe
npx tsx scripts/eval-ai.ts run mytag --playbook --snap markets-v2.json   # replay (free); add --live to spend LLM calls on cache misses
```
LLM budget used for this study: 83 successful live calls (79 on gemini-3.1-flash-lite, 4 on 2.5-flash), about 21 `advise()`-equivalents, plus 2 calls that failed with a 503. A final live re-run on the new universe was blocked by the permission system and was not done.

## Long-term & creative hedges loop

Goal: stop thinking only in 7-day windows. Let a sports bar hedge a whole season (missing the playoffs, an early exit, a weak win total), and let fuel, rate and recession exposure use month-to-year markets. Same harness and grading as above. LLM quota is tiny, so the metrics come from replays and deterministic checks.

### Iteration 1: put long-dated markets in the universe (kept)

**Change.** New `lib/markets/futures.ts` (pure: ticker→league/kind, 2026-27 league calendar, team taken from the rules text, wins-ladder sanity, Kalshi series rows) and `lib/markets/futuresFetch.ts` (Gemini futures fetched by ticker with a 10-minute cache, since the category feed never returns them; a search over futures-tagged events is the fallback). Small hooks:
- `normalize.ts`: futures events are no longer dropped as "props". They get `meta.futureKind`, a real `eventEnd` and the team named in the rules.
- `dflow.ts`: SERIES now includes 17 Kalshi futures series (fetched only on request) and 8 long-dated macro series: diesel month-end and year-end, US and Texas year-max gas, Henry Hub month-end, max 30-yr mortgage rate, shutdown, recession.
- `index.ts`: `listMarkets` merges Gemini futures whenever games are requested. Kalshi futures load only when a risk names a team. A future gets −2 for a window under 21 days, so this week's game still wins a "lose this week" risk. `slotKey` includes the futures kind.

Data-quality guards, all verified on live data:
- Gemini `NBAPLAYOFFS26-27` has swapped rows: label "Sacramento" with rules "If San Antonio qualifies…", and the reverse. Both rows are dropped.
- A wins rung priced above a lower rung is dropped. Example: Texans "14+ wins" YES 0.12 against "12+ wins" 0.05.
- `eventEnd` comes from the league calendar, never from Kalshi's placeholder 2029 close dates.

**Before → after (deterministic).**

| check | before | after |
|---|---|---|
| futures contracts in the snapshot | 0 (markets-v2) | **1,259** (Gemini 491, Kalshi 768) in markets-v3 (6,492 open contracts) |
| latest game `eventEnd` | ≤ 31 days out | **2027-06-25** (Stanley Cup); 0 contracts dated ≥ 2028 |
| Texas teams with a futures NO ask ≤ 0.85 | 0/7 | **7/7**: Spurs 15, Rockets 12, Mavs 9, Texans 8, Cowboys 10, Stars 2, Longhorns 5 |
| new macro series live in the snapshot | — | **8/8** (KXDIESELMON 21, KXDIESELYE 19, KXAAAGASMAX 13, KXAAAGASMAXTX 10, KXNATGASMON 40, KXMORTGAGERATE 20, KXGOVTSHUTDOWN 1, KXRECSSNBER 2) |
| markets-v2 replay, LLM path and fallback | valid 100%, cov 97%, rel 1.50 | **identical**, row by row. prem/pay 0.15→0.16 and budget 54→48% came from the concurrent best-price router commit (9cb8702); a clean HEAD export without this change gives the same numbers |
| fetch cost | — | Gemini futures ~0.9 s (19 tickers in parallel); Kalshi futures ~1.0 s (17 series); no 429s at pool 6 when fetched alone. The full snapshot needed `HEDGEHOG_KALSHI_POOL=3` to avoid one 429 miss |
| tests | 115 | 121 pass, 0 fail (+6 in `tests/futures.test.ts`); `tsc` clean |

**Examples** (`rankCandidates` over markets-v3 for season-long risks, no LLM):
- Houston sports bar, "Rockets miss the playoffs" (window to Apr 20): Gemini **NO "Houston" [Pro Basketball Playoff Qualifiers] @0.05**, ends 2027-04-17. $50 buys 1,000 contracts, which pay **$1,000** if the Rockets miss. The ranker still lists the title future first, so kind-aware ranking is the next step.
- Rainey St bar, "Spurs miss a deep playoff run": Gemini **NO "San Antonio" [West Champion] @0.68**, ends 2027-05-31, or Kalshi **NO "San Antonio reaches the West finals" @0.41**. Example sizing: $205 → **$500** if the Spurs don't make the conference finals.
- Live replay on markets-v3 (fallback path): the patio bar's "Spurs lose on a home-game night" still picks the Nov 19 Clippers–Spurs game (NO @0.13). The futures penalty keeps this week's games first.

**Still open** (for iterations 2-3):
- The risk-map prompt still writes 7-day windows, so the LLM never asks for season risks.
- Ranking ignores the futures kind ("miss the playoffs" should prefer `playoffs` over `title`) and sport (a Longhorns football risk also sees NCAAM title futures).
- KXMORTGAGERATE 2027 is quoted YES ask 1.00 / bid 0.04, so it's not buyable as a hedge yet.

Reproduce: `HEDGEHOG_KALSHI_POOL=3 npx tsx scripts/eval-ai.ts snapshot --snap markets-v3.json`, then `npx tsx scripts/census-futures.ts markets-v3.json`, then `npx tsx scripts/eval-ai.ts run it-fut1 --playbook --snap markets-v2.json`. LLM calls spent: 0.

### Iteration 2: horizon-aware pipeline (window parsing, ranking, futures side, fallback season risks, sizing, metrics). KEPT

**Change.** New `lib/ai/horizon.ts` (pure):
- `parseHorizon` reads months ("December", "Nov-Dec"), quarters, "next N months", "by/through <month or date>", "this winter", and league seasons through `LEAGUE_CALENDAR`. For example, "through the NBA playoffs" ends 2027-06-20. Short windows still return null, so the old parser handles them.
- `horizonFit`, `futuresSide` (own-team future: NO for a revenue risk, YES for a win-funded promo), `stageWanted` ("miss the playoffs" maps to playoffs/wins; "run ends before the West finals" maps to round/conference) and `monthsOfCover`.
- `futuresFallbackRisks`: a crowd business that names a team gets a season risk. A contender (make-playoffs ≥ 0.85, deep-run NO an insurance price) gets "run ends before the conference finals"; any other team gets "miss the playoffs". Loss = playoff nights × the lift a playoff night brings. Up to 2 teams.
- `periodFallbackRisks`: crews get "a soaked <month>" (monthly rain total).

Hooks in existing files:
- `index.ts`: `parseWindow` delegates to `parseHorizon`. `rankCandidates` on month/season windows:
  - adds +2×fit;
  - gives −1.5 to single-day contracts, except a price printed at the window's end (diesel on Dec 31 for "through December");
  - ranks futures by stage, with a league filter;
  - drops single games for season game risks;
  - prefers insurance-priced strikes when no strike is named;
  - widens the gap allowance only for windows of 30 days or more.
  On short windows, a year-end/season contract gets −1.5. This fixed iteration 1's KXAAAGASMAX "this week" picks (lng7 5→0).
- `advisor.ts`:
  - `sanitizeRisks` caps losses at 7 days of revenue for event risks and 30 days for month/season risks.
  - `guardSide` enforces the futures side.
  - `heuristicPick` handles season risks: stage, then price ≤ 0.60 nearest 35¢, then ≤ 0.70, skipping books under 50 contracts. It never hedges a season with a single game. Month risks use strike totals.
  - Long-horizon fallback risks merge on both paths, but only when the market list has a matching future or period contract.
  - `sameExposureX` keeps different horizons apart.
  - The options mapping survives the best-price router re-pointing a leg.
  - Playbook ideas use their own resolved contract and side.
  - On long risks, the default plan skips a choice with a book only a few contracts deep.
  - The generic fallback uses the profile city, and fuel risk runs "through December" when prices are fixed by contract or bid.
- `quote.ts` / `client/quote.ts`: a season or month-total line is charged premium ÷ months of cover (max 6) against the monthly budget, and the line gets `premiumPerMonth`. `ideas.ts`: futures ladder (same team's other stages or wins rungs), no "other side" on futures, no 60-day far penalty on long ideas, and directional picks skip thin books.
- Playbook: `team-misses` side, plus `sports-playoff-run-miss` (Gemini + Kalshi season futures incl. CFP), `fleet-diesel-month` (KXDIESELYE/MON), `broker-rate-path` (KXMORTGAGERATE), and `dc-shutdown` (KXGOVTSHUTDOWN, new `gov-contractor` industry), with at most 2 ideas per peril. All four resolve offline on markets-v3. A separate CFP entry was folded into `sports-playoff-run-miss`.
- Harness: new columns `hz30`, `season`, `period`, `futSide`, `$/mo` and `lng7` (a long contract on a ≤14-day risk). The futures side rule was added to `paysWhenHurt`, which also learned miss/eliminated/fail to make/knocked out. 5 new businesses: Spurs bar (San Antonio), Texans/Cowboys wing shop (Houston), UT Drag bar, landscaper, diesel box-truck fleet. The existing mortgage broker covers the broker case.

**Before → after.** `npx tsx scripts/eval-ai.ts run <tag> --playbook --snap markets-v3.json`; 14 businesses; replay misses, so both tables show the deterministic fallback path. rel is re-scored on both runs with the same grade file (+78 grades, written by the agent).

| metric | lt-v3-base | it-hz2 |
|---|---|---|
| hz30 (plan lines settling > 30 days out) | 9% (5/53, all lng7 mismatches) | **17%** (11/64) |
| season (long risk with a valid futures/period line) | 0/6 | **6/6** (the 4 new team/landscaper businesses 4/4) |
| period weather lines (≥ 25-day window) | 0 | **2** (landscaper, roofer: KXRAINAUSM >5 in) |
| futSide | — | **100%** |
| lng7 (long contract for a this-week risk) | 5 | **0** |
| validity / coverage / inPlan | 99% / 84% / 84% | **100% / 89% / 83%** (old 9: cov and inPlan equal or better per business) |
| rel, all / old 9 | 1.00 / 1.22 | **1.36 / 1.42** (no old business lower) |
| offDay | 3 | 3 |
| $/mo (premium per month of cover ÷ budget) | 46% | 87% (max 100% per business; upfront 129%: season hedges are bought once) |
| tests | 121 | **143 pass**, 0 fail (+5 `tests/horizon.test.ts`, +3 ai-eval pins); `tsc` clean |

**Live check (1 run, gemini-3.1-flash-lite, 3 calls).** Spurs bar: the matcher picked NO "San Antonio" [West Finals Qualifiers] @0.41, the right stage. That book holds only 4 contracts, so the plan bought $4 of cover. Fixed in code (the default plan skips books that thin on long risks). Replayed: **NO "San Antonio" [Western Conference Champion] Kalshi @0.66 × 2,013 = $1,329 up front (~$221/month over 6 months) → pays $2,013 if the Spurs don't win the West.** The ladder offers NO "Playoff Qualifiers" @0.04 as a cheap tail.

**Examples (fallback path, no LLM).**
- Forty Acres Taphouse (UT Drag), "Longhorns miss the College Football Playoff": **NO "Texas" [CFP Qualifiers] Gemini @0.08 × 2,400 = $192 → $2,400**. The ladder offers Kalshi NO @0.05 as a cheap tail and NO "Top 4 Seeds" @0.71 as broad cover.
- Bayou Wings, "Cowboys miss the playoffs": **NO "7+ wins" [Dallas Total Wins] @0.23 × 1,670 = $384 → $1,670**; ladder 6+ NO @0.09 / 8+ NO @0.49. The Texans line (8+ NO @0.36) doesn't fit a $250 budget.
- Hill Country Freight, "Diesel stays high until contracts reprice": **YES "Above $6.20" [Diesel price at year-end 2026] @0.17**.
- Hill Country Home Loans: **YES "Above 7.6%" [How high will the 30-year mortgage rate get in 2026] @0.16**, a depth-limited 100-contract book.

**Caveats.**
- The risk-map and brainstorm prompts are unchanged (still 7-day framing). Season risks reach the LLM path only through the deterministic merge. Iteration 3 should teach the prompts horizons.
- Contenders' deep-run NO is pricey (Spurs West NO 0.66), and the honest cheap legs (WCF NO 0.41) are thin.
- Upfront premium can exceed the monthly budget (amortized ≤ 100%). The UI should show "$X up front, ~$Y/month".
- Grades for new lines were written by this agent.

### Iteration 3: teach the LLM horizons and futures (prompts, catalog, universe, docs). KEPT; live check is partial

**Change.**

New `lib/ai/longContext.ts` (pure, no network):
- `teamFutures`: one line per own team with every stage, both venues and the implied odds, settling on `meta.eventEnd` and never on the 2029 placeholder. Example: "Spurs (NBA): make playoffs 0.97 | wins 60+ 0.60 | reach West finals 0.60 | win West 0.35 [gemini 0.37] | title 0.22 | settle Apr-Jun 2027".
- `longUniverse`: the "SEASON FUTURES & PERIOD MARKETS" section of the risk-map universe. It has its own per-peril budget, so game nights no longer crowd it out.
- `seasonCalendar`: league dates and the next 3 FOMC decisions.
- `isLongContract`, `settleDay`, `lineScore`.

`advisor.ts`:
- **Risk map (`RISK_SYSTEM`).** It now asks for near-term days and season or month exposures. The window is either 7 days or the period the owner actually feels, with an optional `horizon` field. `lossUsd` for a long window is the extra loss over that window. New rule: a team, a busy season, monthly totals, fuel contracts or a loan reset require at least 1 month or season risk. Four one-line examples: the Spurs West finals, a landscaper's December rain, month-end diesel, the 2027 mortgage-rate high.
- **Matcher prompt.** Two lines on futures: own-team NO pays if the run stops, the stage must match the risk, and the hedge covers months and can be sold before it settles.
- **Candidate lines.** They show "settles <eventEnd> (season future: <kind>)" instead of the 2029 expiry.
- **Fallback Fed risk.** It is now "Fed hikes more than priced at the meeting before your rate resets". The old one was "No Fed rate cut", which is stale in a hiking market: Dec "Hike 25bps" trades at 0.93.

`ideas.ts`:
- `buildCatalog` has one futures line per own team.
- Long series say "settles <Mon YYYY>".
- The 45-line cap is now fair across perils: the own-team futures lines always stay, and long lines rank by relevance.
- `BRAINSTORM_SYSTEM` has a "think past this week" bullet.

Fixes made this iteration:
- **Interrupted earlier attempt.** It left 3 failing `tests/ai.test.ts` tests. Cause: `isLongContract` treated any contract without meta and with a far expiry as long, and the test universe uses expiry 2099. Fix: such a contract counts as long only when its title names no single day or game.
- **"other"-peril ranking.** The live broker run exposed it: "Government shutdown on Dec 12" got NASDAQ-100 year-end candidates and no shutdown market. Fix in `rankCandidates`: the risk's own words must appear in the title, and when any contract matches, only matching contracts are kept.

Other updates:
- `lib/markets/catalog.json`: `indexed` was flipped by hand on 23 types (futures families, monthly rain, snow days, ERCOT, HDD, Lake Mead, tornadoes, long macro).
- `docs/MARKET-CATALOG.md` §8: a table of Texas-team futures plus the search-only, label-swap, stale-rung and placeholder-expiry gotchas.
- `docs/PLAYBOOK.md`: season and month sizing and tiering.

**Prompt size against the HEAD export** (system + user characters, Spurs bar and landscaper):

| Call | Change |
|---|---|
| Risk map | -2% / +7% |
| Brainstorm | +24% / +26% |
| Matcher | +29% / +21% |
| Total per advise() | **+16% / +17%** |

Part of the growth comes from other agents' parametric and clarify lines.

**Before → after.** `npx tsx scripts/eval-ai.ts run <tag> --playbook --snap markets-v3.json`, 14 businesses.
- **Before** (`it-hz3-before`): the iteration-2 code, where replay misses everywhere, so it is the fallback path.
- **After** (`it-hz3`): the replay now includes the 2 live recordings.
- `tests/ai.test.ts` was red at the start (3 failures from the interrupted attempt); it is green after.

| metric | before | after (replay) | after (fallback path) |
|---|---|---|---|
| validity | 100% | **100%** | 100% |
| coverage / inPlan | 89% / 83% | **92% / 84%** | 89% / 83% |
| rel | 1.36 | **1.36** | 1.36 |
| creative ideas | 31 | **34** | 31 |
| offDay | 3 | 3 | 3 |
| hz30 / season / period / futSide | 17% / 6/6 / 2 / 100% | 16% / 6/6 / **3** / 100% | 17% / 6/6 / 2 / 100% |
| tests | 144 pass, **3 fail** | **148 pass, 0 fail** (+5 `tests/long-context.test.ts`); `tsc` clean | |

**Live (2 advise() runs, 6 calls, gemini-3.1-flash-lite; the summary was not live).**

Spurs bar (Baseline & Bourbon), compared with `it-hz2`:
- The risk map wrote **"Spurs fail to reach the Western Conference finals", window "through the 2026-27 NBA playoffs", $16,000**, and **"Heavy rain in San Antonio in November"**, alongside this weekend's rain and this week's Pelicans game.
- The brainstorm added an ERCOT November power average line.
- Plan: **NO "San Antonio" [Western Conference Champion] Kalshi @0.66 × 2,540 = $1,676 up front (about $279/month), pays $2,540 if the Spurs don't win the West.**
  - Balanced: NO [West Finals Qualifiers] @0.41, but that book holds only 4 contracts.
  - Cheap tail: NO [Playoff Qualifiers] @0.04.
- Metrics: coverage 75% → **100%**, rel 1.00 → **1.33**, creative 2 → 4, offDay 0, futSide 100%.

Mortgage broker (Hill Country Home Loans):
- The risk map wrote a rate path "through the Dec 9 2026 FOMC", a November CPI risk and a Dec 12 shutdown.
- The brainstorm added **"Mortgage rate surge in 2027" (YES "Above 8.00%" on KXMORTGAGERATE 2027 @0.40)** and the 2026 high (YES "Above 7.6%" @0.16).
- The matcher hedged the Fed risk with YES "Hike >25bps" @0.08, the right side of "more than priced".
- That line took the whole $500 budget (6,250 contracts). `sizeQuote` keeps the best payout per premium first, so the 2027 rate line was only offered as an option.
- After the "other" ranking fix, the shutdown risk gets the shutdown market. Replaying with the heuristic matcher (the match prompt changed, so it misses the cache) gives 3 plan lines, including the 2027 mortgage-rate line: coverage 67% → 100%, hz30 0% → 33%.
- The heuristic matcher put the Fed risk on "Fed maintains rate" (graded 0), so rel is 1.33 against 1.40 in `it-hz2`.

**Keep decision.** Kept.
- The team business got a valid season line on the right side.
- The broker's long-dated lines are valid and on the right side. With the live matcher they appeared only as options, because the budget ran out; after the ranking fix one is in the plan.
- Validity is 100%, relevance is flat, and the fallback path is unchanged.

**Pending (quota).** I was limited to 1-2 live runs, so the landscaper and a regression business (food truck or Rainey bar) were not run live with the new prompts. Their replays miss the cache and show the fallback path. Run `npx tsx scripts/eval-ai.ts run it-hz3live2 --live --only eval-landscaper,east-austin-food-truck --playbook --skip-nollm --snap markets-v3.json` when quota allows. If the food truck starts proposing season hedges or its offDay rises, soften only the `RISK_SYSTEM` "at least 1 month or season risk" rule.

**Open issues.**
- `sizeQuote` spends the budget on the best payout-per-premium line first, so one cheap tail can take a whole small budget and starve long-dated lines. A per-line cap (about 50% of budget when other lines wait) is the next sizing change. The existing test `sizeQuote: budget keeps best payout-per-premium…` pins the current behaviour.
- The live risk map for the Spurs bar dropped the near-term "Spurs lose this week" direct risk; it moved to a creative proxy. That is acceptable, but watch it.
- Grades for the 10 new lines were written by this agent.
