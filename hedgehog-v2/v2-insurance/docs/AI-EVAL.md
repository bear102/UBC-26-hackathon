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
