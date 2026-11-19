# Venue expansion: disasters, snow, drought and "hold the contract on ANY exchange"

Research memo, 2026-11-19 ~04:30 CST. Research only, no code changed. Inventory numbers come from `lib/markets/catalog.json` (the catalog agent's live pull of the Gemini, Kalshi and Polymarket public APIs at 2026-11-19 08:54 UTC), plus my own live Polymarket Gamma probe (`/events?tag_slug=weather`, same morning). Volumes are lifetime USD traded on the listed events.

## TL;DR

**Don't extend desk backing to Polymarket before the deadline. Do widen the menu on Kalshi now.**

- Nearly all the "missing" disaster and climate markets are on **Kalshi**, not just Polymarket: city snowfall, snow days, tornado counts, Lake Mead, Bay Area and LA rain, ERCOT power, heating degree days, earthquakes and ski-resort snowfall. Kalshi already runs through our existing path (DFlow on Solana mainnet, mock venue on devnet). Adding them is mostly new rows in `SERIES` plus a few peril tags. That is **in-track** work. It even strengthens the Solana story, since the owner can hold real SPL outcome tokens via DFlow.
- **Polymarket backing is a bad fit for the hackathon:**
  1. polymarket.com is **close-only for the US on both the frontend and the API**, so a US desk can't open hedges there.
  2. Polymarket US (QCEX, a CFTC-licensed DCM) needs KYC and a separate API, and its catalog is narrower (sports, politics, econ). I found no confirmation that it lists weather or disaster markets.
  3. It points the "hedged on ___" story at a Gemini competitor, the opposite of what the Gemini bounty rewards.
  4. It adds a Polygon bridge leg and a lot of demo risk.
- **Polymarket's unique disaster markets** are Mississippi River low water, Lake Powell, Great Salt Lake, Cat-4 US landfall, big earthquakes, tornado totals and "Natural Disaster in 2026". They're fine as **read-only reference lines** in the explorer and AI, labeled "reference, not buyable". That's what we already do for temperatures.
- **Hurricanes are out of season.** The Atlantic season ends Nov 30, so every hurricane market resolves within about 2 weeks. Don't build a demo around them. **Winter perils are in season:** December snowfall by city, snow days, freezes, heating degree days and ERCOT winter power.
- **Wildfire, flood and drought-index markets basically don't exist on any of the three venues today.** Neither the catalog nor my probe found a live wildfire or flood contract. The closest are water-level markets (Mead, Powell, Mississippi). We should say so in the UI ("not hedgeable on any venue today") instead of implying that coverage exists.

## 1. Inventory: business-relevant market types we don't index

Our index today (`lib/markets/dflow.ts` `SERIES` + `lib/markets/polymarket.ts`):
- Kalshi: daily highs and lows (Austin plus 7 cities), rain (daily, weekend, Thanksgiving, Austin monthly), gas, WTI, Fed, CPI, games.
- Gemini: daily highs (its only weather type), games, commodities, crypto.
- Polymarket (read-only): moneylines, Fed, inflation, oil, US-city daily temperatures.

The `Peril` union is `heat|cold|rain|game|oil|gas|fed|cpi|crypto|other`, so there is no snow, storm, quake, water or power peril yet.

### 1a. Kalshi (all reachable on Solana via DFlow as SPL tokens). Live = an open event in the catalog pull today.
| Theme | Series (examples) | Live now | Volume / liquidity | Settles on | Time to settle | Geography | Who it helps |
|---|---|---|---|---|---|---|---|
| **City snowfall, monthly** | `KXCHISNOWM`, `KXNYCSNOWM`, `KXBOSSNOWM`, `KXDENSNOWM`, `KXPHILSNOWM`, `KXDETSNOWM`, `KXMKESNOWM`, `KXMSPSNOWM`, `KXSEASNOWM`, `KXDCSNOWM`, `KXPITSNOWM` (~40 types) | Yes, Dec 2026 events, median ask 0.25–0.75 | $4k–80k per city ($207k theme); strikes priced | The Weather Company / NWS climate report | Month end (Jan 1) | 11+ US metros | Restaurants and retail (snow closures), delivery, salons, gyms, daycare. Plow contractors hedge the *opposite* side (no snow) |
| **Snow days / holiday snow** | `KXSNOWDAYS` (Dec 1–Apr 1), `KXSNOWTHANKSGIVING`, `KXNYCSNOWXMAS` | Yes | $0.6k–9k, thin | TWC / NWS | Days to a season | Multi-city | Same as above, season-long cover for one premium |
| **Ski season** | `KXTSNOWFALLBIGSKYM`, `KXPARKCSNOW`, `KXMAMMOTHSNOW`, resort opening-date series (Alta, Snowbird, Steamboat…) | Yes (32 live events) | $1.35M theme; Big Sky Dec snowfall $146k | OnTheSnow, resort reports | Dec 24 / month end | Mountain towns | Ski and rental shops, ski-town bars and lodging, shuttles. A strong new niche story |
| **Tornadoes** | `KXTORNADO` (monthly US count) | Yes | $12.6k | NOAA SPC | Month end | US (national) | Plains and Southeast retailers, mobile-home parks. Weak basis (national count) |
| **Earthquake** | `KXEARTHQUAKECALIFORNIA` (M8+), `KXBIGGESTQUAKEMONTH`, `KXBIGGESTQUAKE` (daily) | Yes | CA M8 $648k; daily and monthly thin | USGS | Daily → years | CA / global | CA businesses with uninsured interruption (catastrophe tail; ask ~0.21 is expensive) |
| **Water / drought** | `KXMEAD` (Lake Mead monthly level), `KXIDGROUNDWATER` | Yes | $31k, $65k | US Bureau of Reclamation | Month | Lake Mead / Idaho | Lake Mead marinas and boat rentals, farms (curtailment) |
| **Monthly rain, more cities** | `KXRAINLAXM`, `KXRAINSFOM`, `KXRAINNAPAM` (Nov–Mar season total), `KXRAINPHXM`, `KXRAINLVM`, `KXRAINMIAM`, `KXRAINSEAM`… (~42) | Yes | $7k–61k each ($428k theme) | TWC / NOAA | Month end | 15+ metros | Landscapers, roofers, painters, golf, car washes; Napa vineyards (drought ↔ season rain) |
| **Daily rain, more cities** | `KXRAINDCHI`, `KXRAINDPHIL`, `KXRAINDDAL`… (~30 groups) | Yes, mostly unpriced | <$200 each, very thin | TWC | Next day | Many metros | Patio and outdoor events outside Austin (`KXRAIN` multi-city already covers the liquid version) |
| **Temperature period** | `KXHDDCVG` (Cincinnati heating degree days, Q4), `KXHMONTH` (hottest Nov) | Yes | $24k, $81k | TWC / NCEI | Quarter / month | City / global | HVAC, propane dealers, greenhouses, laundromats (heating bills) |
| **Power / grid** | `KXERCOTNORTHM/W`, `KXERCOTWESTW`, `KXTXERCOTPEAK`, `KXPJM*W`, `KXMISOINDW`, `KXPOWERKWH`, `KXCPIELECYOY` (~26) | Yes | ERCOT peak $1.1M; hub prices $1–4k (thin) | ERCOT / PJM / MISO / BLS | Week / month / year | TX, PJM, MISO, US | Texas restaurants, laundromats, cold storage (Uri-style winter price spikes). Strong Austin fit |
| **Hurricanes** | `KXHURCTOTMAJ`, `KXHURCITYTPA`, `KXHURRLANDFL4`, `KXHURPATHNC`, `KXHURPATHHAWAII`, `KXTROPSTORM` (~22) | Technically yes, but **season ends Nov 30** | $10k–250k | NOAA / NHC | ≤2 weeks (most), Hawaii/NE by Dec 31 | Gulf / Atlantic coast | Coastal tourism, marinas. **Re-list for June 2027** |
| **Diesel** (in PLAYBOOK) | `KXDIESELW` | Yes | ~$78k | EIA | Weekly | US | Fleets, trucking, farms |

### 1b. Polymarket (Polygon; read-only for us). Live via Gamma `tag_slug=weather`, my probe this morning
| Theme | Event (examples) | Volume / liquidity | Settlement source | Ends | Who it helps | Also on Kalshi? |
|---|---|---|---|---|---|---|
| **Mississippi low water** | "Lowest Mississippi level at St. Louis / Baton Rouge by Nov 30?" | $121k / $7k liq; $89k / $15k | USGS NWIS | Dec 2 | Barge, grain and river shippers, farm co-ops | **No (unique)** |
| **Western reservoirs** | "How low will Lake Powell / Lake Mead drop?", "Lowest Great Salt Lake elevation" | $101k / $21k; $24k; $62k | USBR / USGS | Jan–Apr 2027 | Marinas, houseboat rentals, Utah/Arizona tourism, farms | Mead monthly only |
| **US hurricane landfall** | "Cat 4 / Cat 5 landfall in the US before 2027?", "Where will a hurricane make landfall?" | $353k / $1k liq; $145k; $49k | NHC | Dec–Jan | Gulf/Atlantic coastal businesses (out of season now) | Similar (state-level) |
| **Earthquakes** | "How many 7.0+ in 2026", "M6.5+ in LA before 2027", weekly/monthly 5.5/6.5 | $1.55M; $22k; $5–7k | USGS | Weekly → Jan | LA businesses (LA-specific is unique) | CA M8 only |
| **Tornadoes / natural disaster** | "How many tornadoes in the US in 2026?", "Monthly Tornadoes US", "Natural Disaster in 2026?" | $87k / $23k liq; $2k; $256k | NOAA SPC | Dec–Mar | Plains/Southeast (national, weak basis) | Monthly count |
| **Snow** | "First snow of the 2026 season", "Which cities will get more snow" | $70k | NWS | Dec 4 | Northern-city retail and services | Yes, deeper on Kalshi |
| **ENSO / climate** | "Peak RONI for 2026–27 El Niño", "2026 hottest year rank" | $180k; $3.9M / $251k liq | NOAA CPC / NOAA | Mar–Apr 2027 | Seasonal planning (El Niño = wet Gulf winter) | Partly |
| **Rain / precip** | "Where will it rain today?", "Monthly Precipitation", "Precipitation in Hong Kong" | $3k–28k | NWS / HKO | Days–months | Mostly non-US cities | Kalshi deeper in the US |
| Daily temperatures (US cities) | Already indexed read-only | | | | | |

### 1c. Gemini
The catalog finds **one weather type: daily high by city** (66 live events, ~$20k lifetime volume). Its other types are sports (58), economics (28 types, 9 live), commodities (6), crypto, politics, tech, business and culture. **There are no snow, storm, quake, water or power markets on Gemini.** So all "disaster" coverage is necessarily Kalshi- or Polymarket-priced.

### 1d. Solana-native prediction markets
None has weather or disaster depth. The Solana route to these markets *is* Kalshi via DFlow (also used by Jupiter's prediction UI). [The Block](https://www.theblock.co/amp/post/380983/kalshi-tokenizes-thousands-of-its-prediction-markets-using-solana), [Blockhead](https://www.blockhead.co/2025/12/02/kalshi-launches-tokenized-prediction-markets-on-solana-through-dflow-integration).

### 1e. Genuinely missing on all venues
There are no wildfire (acres burned, red-flag days, PSPS power shutoffs), river or flash flood, hail, US Drought Monitor index, or AQI/smoke contracts. Kalshi lists AQI/air-quality series historically, but none is live (the catalog `air_quality` theme is empty). The AI should tell those businesses "not hedgeable today: buy traditional cover" instead of forcing a bad proxy.

## 2. Execution paths: what "Hedgehog desk backs it on venue X" requires

| Path | How it works | Access / KYC | Capital and plumbing | Status |
|---|---|---|---|---|
| **Gemini (current primary)** | Desk places an IOC limit order on Gemini PM (Trader API, HMAC) | Gemini account; CFTC-regulated DCM | USD on Gemini; offchain treasury rebalance | Built (dry-run) |
| **Kalshi via DFlow (Solana)** | Owner (or desk) buys the **real SPL outcome token** via the DFlow Trade API; redeem onchain | DFlow **Proof KYC is required on the wallet that *receives* outcome tokens** (buy enforced from 2026-02-20). Unverified wallets can still sell. Geoblocking is also required. [DFlow KYC docs](https://pond.dflow.net/prediction-markets/kyc), [buy recipe](https://pond.dflow.net/prediction-markets/recipes/buy-outcome-tokens) | USDC on Solana mainnet; no bridge; same chain as our policy program | Adapter built (`lib/venue/dflow.ts`); mainnet buy is the optional last step |
| **Kalshi direct (desk)** | Desk account on Kalshi, REST orders, USD | Entity KYC on Kalshi (CFTC DCM) | USD wire; offchain like Gemini | Not built; no advantage over DFlow for our story |
| **Polymarket international (polymarket.com CLOB)** | Desk buys CTF tokens on Polygon | **US is "close-only" on the frontend AND the API: no new positions** ([Polymarket geoblock docs](https://docs.polymarket.com/developers/CLOB/geoblock)). A US-based desk can't legally or technically open hedges | USDC on Polygon. Polymarket announced a switch from USDC.e to native USDC with Circle in Feb 2026 ([The Block](https://www.theblock.co/post/388670/polymarket-to-swap-bridged-usdc-e-on-polygon-for-native-usdc-via-circle-partnership)), and a June 2026 report mentions "pUSD / CTF V2" (collateral token in flux). The Solana→Polygon leg would be CCTP burn/mint (minutes; fast-transfer fee) | **Blocked for a US operator** |
| **Polymarket US (QCEX)** | Desk account on the CFTC-licensed US exchange; separate REST/FIX API (Ed25519-signed, keys from polymarket.us/developer after KYC) ([API reference](https://apidocs.polymarketexchange.com/api-reference), [Dwellir guide](https://www.dwellir.com/guides/polymarket-api-guide)) | Full KYC; some states (e.g. NY) reportedly blocked; settlement via FCM/USD by some accounts | USD/FCM, offchain | Sports first (Jan 2026), econ and politics added ~Apr 2026; **I found no evidence its weather/disaster markets (Mississippi, Powell…) are listed** ([pm.wiki](https://pm.wiki/uk/projects/polymarket-us), [defirate](https://defirate.com/learn/what-are-prediction-markets/)). Unverified, needs an account to check |

**Legal framing (post-hackathon issue, but judges may ask):**
- Selling a parametric payout that is *not* tied to the buyer's proven loss looks like an event contract or swap (CFTC), not state-regulated indemnity insurance. The insurable-interest test drives the split. See [Insurance Business on Kalshi weather contracts](https://www.insurancebusinessmag.com/us/news/catastrophe/is-a-kalshistyle-weather-contract-insurance-look-to-insurable-interest-596536.aspx) and [Better Insurance on parametric and Dodd-Frank](https://betterins.substack.com/p/climate-risk-parametric-insurance).
- In March 2026 the CFTC issued an ANPRM, and on 2026-06-10 an NPRM on event contracts that frames them as hedging tools ([GT Law](https://www.gtlaw.com/en/insights/2026/3/cftc-regulatory-developments-on-prediction-markets-and-event-contracts), [Mayer Brown](https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2026/06/cftc-prediction-markets-proposed-rules.pdf%3Frev=267eeac07c4d4b76bbf6894751a91be4)).
- **Implication:** Hedgehog acting as a counterparty that writes cover and lays it off is the legally heavy part (swap dealer, or an insurer with a reinsurance-style hedge). The *cleanest* path is the business holding the regulated contract itself. That means Kalshi SPL tokens via DFlow in the owner's wallet (KYC'd), or the owner's own Gemini account. Adding an offshore venue (polymarket.com) to the desk makes this strictly worse.

## 3. Prize / track impact

| Option | Gemini PM bounty | Best use of Solana | DeFi & Onchain track | QuickNode | Demo risk |
|---|---|---|---|---|---|
| **A. Kalshi disaster/winter series added (DFlow path, devnet mock-buyable)** | Neutral to slight minus (more Kalshi lines). Mitigated: these perils have **no Gemini market at all**, so it's "Gemini where it lists, Kalshi-on-Solana elsewhere", which is already the DESIGN §1 rule | **Plus**: more real SPL outcome-token markets; mainnet-real via DFlow | **Plus**: broader "risk router", real winter perils; README economics unchanged | Plus: more DFlow mints to stream | Low (same code path as KXRAIN) |
| **B. Polymarket disaster markets indexed READ-ONLY (explorer + AI "reference")** | Neutral (same as current read-only temps) | Neutral | Small plus (coverage map, honest basis notes) | — | Low |
| **C. Polymarket lines devnet-buyable via mock venue, backing "Polymarket (planned)"** | **Minus**: the sale is now priced off a Gemini competitor *and* backed there, contradicting "Sold on Solana, hedged on Gemini" | Neutral (still devnet mock tokens) | Mixed: judges will ask how a US desk hedges on a venue that blocks US opens, and we have no good answer | — | Medium (new price source, no real backing story, mispricing on thin books) |
| **D. Real Polymarket backing (CCTP to Polygon + CLOB)** | Strong minus | Minus (money leaves Solana) | Minus (US regulatory problem) | — | High; also illegal for a US operator on polymarket.com |

**Read:** The Gemini bounty pays for depth of Gemini integration, and 1st place gets a finals slot. Every Polymarket-*execution* feature dilutes that and raises regulatory questions that DeFi judges can poke at. Kalshi-via-DFlow expansion doesn't have that problem. It's the venue the design already uses for "perils Gemini doesn't list", and it's natively Solana.

## 4. Effort estimates

### (a) Read-only indexing of the best N new types (no new buy path)
- **Kalshi, ~10 series → buyable in the existing flow:** append to `SERIES` in `lib/markets/dflow.ts`.
  - Peril handling: either extend `Peril` with `"snow" | "power" | "water" | "quake" | "storm"`, which touches `lib/types.ts`, ranking in `lib/markets/index.ts`, AI prompt perils in `lib/ai/*`, explorer filters and badges, roughly 6–10 files. Or, faster: map them to `"other"` plus a `subPeril`/label field.
  - Bound parsing: snowfall-inch and MWh/$ strikes use the same `parseBounds` "above X / between X–Y" format as rain totals.
  - **Estimate: 1–1.5 h** with the `other`+label shortcut; 2–3 h with first-class perils and tests.
- **Polymarket disaster events read-only:**
  - Add `PolySource` entries by tag (weather tag 103040 is already used) or by slug (Mississippi, Powell, Mead, Great Salt Lake, tornado counts, quakes).
  - These are multi-outcome "bucket" events, so they need a small normalizer (threshold → bounds), which mirrors what was just done for daily temperatures.
  - **Estimate: 1–1.5 h.**
- **Explorer "not hedgeable anywhere today" note** for wildfire, flood, hail and AQI: **15 min** (static copy).

### (b) Devnet-buyable via mock venue with "backing venue: Kalshi via DFlow" / "Polymarket (planned)"
- **Kalshi:** effectively free once (a) is done. The mock venue already mints for any Kalshi contract at its live price, and the crank settles from Kalshi `result`. Add a "backing: Kalshi via DFlow (mainnet: owner holds the real token)" label. **+15–30 min.**
  - Caveat: the monthly and seasonal series (snow in Dec, snow days to Apr 1) won't settle before the demo. Show them as open positions. Dailies like `KXBIGGESTQUAKE` and `KXRAIN` settle overnight.
- **Polymarket:**
  - Needs a CLOB price/quote adapter for the mock (Gamma `bestAsk` or the CLOB `/book` per token).
  - Needs settlement from Gamma `umaResolutionStatus`/outcome prices in the crank.
  - Needs "backing: planned" plumbing in `geminiHedge.ts`/desk.
  - **Estimate: 2.5–4 h** plus prize downside (§3 C). **Not recommended.**

### (c) Real cross-venue backing after the hackathon
- **Kalshi via DFlow (mainnet), recommended first:**
  - Proof KYC for the desk or owner wallets.
  - DFlow API key, mainnet USDC float, a geoblock check, then live orders through the existing `DflowVenue`.
  - **2–4 days** incl. monitoring and redemption.
  - Better variant: the owner's own KYC'd wallet holds the tokens directly, with Hedgehog as advisor/router rather than counterparty.
- **Polymarket US (QCEX):**
  - Entity account and KYC, Ed25519 API client, USD/FCM treasury, market-mapping layer.
  - **1–2 weeks** plus legal review, *and only if* the US exchange lists the disaster markets (unverified).
- **polymarket.com (international):** **don't**. US close-only; only a non-US entity could use it, which brings counterparty, jurisdiction and AML questions.
- **Legal** (any desk model): swap-dealer and insurance-producer analysis, state insurance-department exposure if marketed as "insurance". Budget counsel before real money.

## 5. Recommendation

### Do now, for the hackathon (≤ 2–3 h, low demo risk)
1. **Add the in-season Kalshi winter and climate series to `SERIES` (Solana via DFlow, devnet mock-buyable):**
   - `KXCHISNOWM`, `KXNYCSNOWM`, `KXBOSSNOWM`, `KXDENSNOWM`, `KXPHILSNOWM` (city December snowfall)
   - `KXSNOWDAYS` (season snow days)
   - `KXTSNOWFALLBIGSKYM` / `KXPARKCSNOW` (ski towns)
   - `KXERCOTNORTHM` / `KXTXERCOTPEAK` (Texas power, an Austin story)
   - `KXHDDCVG` (heating degree days)
   - `KXMEAD` (Lake Mead)
   - `KXRAINLAXM` / `KXRAINSFOM` / `KXRAINNAPAM` (West Coast rain)
   - `KXDIESELW` (already recommended in PLAYBOOK)

   Use the `other`+label shortcut unless the lead wants first-class perils. Label the venue line "Kalshi via DFlow (Solana-native on mainnet)". About 1.5 h.
2. **Polymarket disaster and water events as READ-ONLY reference lines** in `/markets` and the AI candidates, ranked below buyables like today: Mississippi St. Louis/Baton Rouge, Lake Powell, Lake Mead, Great Salt Lake, US tornadoes 2026, M6.5+ LA, Cat-4 landfall. Badge: "Reference only: Polymarket isn't open to US desks". About 1 h. If time is short, do only the explorer listing (30 min).
3. **One line on /how-it-works and in the README:**
   - "Gemini first; Kalshi-on-Solana for perils Gemini doesn't list (snow, power, water); Polymarket as reference."
   - "Not hedgeable on any venue today: wildfire, flood, hail."

   This is honest, shows the routing logic, and answers the judge question "why not Polymarket?". 15 min.

Skip anything hurricane-specific (season ends Nov 30), and don't make Polymarket lines buyable.

### After the hackathon
1. Real Kalshi-via-DFlow execution with Proof-KYC'd owner wallets: the owner holds the real token, and Hedgehog routes and advises. This is the cleanest legal posture.
2. First-class perils (`snow`, `power`, `water`, `quake`, `storm`) with per-peril basis-risk notes and settlement-station mapping.
3. Evaluate Polymarket US (QCEX) once there's an account: check whether it lists the weather and disaster markets, then API, KYC and FCM. Treat it as a third backing venue only if it does, and only after legal review.
4. Seasonal re-listing: hurricanes from June 2027 (`KXHURCITY*`, `KXHURRLAND*`, Polymarket landfall events).
5. Watch for wildfire, flood and AQI contracts, and add them when a venue lists them.

## Sources
- Inventory: `lib/markets/catalog.json` (sources: `api.gemini.com/v1/prediction-markets/events`, `api.elections.kalshi.com/trade-api/v2/series` + `/events`, `gamma-api.polymarket.com/events/keyset`), plus a live probe of `https://gamma-api.polymarket.com/events?tag_slug=weather&active=true&closed=false` (2026-11-19). DFlow's dev metadata host wasn't reachable from this sandbox (DNS), so **check that each new series has DFlow mints** (`/events?seriesTickers=…&withNestedMarkets=true`) when implementing. Kalshi says "thousands" of markets are tokenized, not all.
- Polymarket geoblock (US close-only): https://docs.polymarket.com/developers/CLOB/geoblock
- Polymarket US / QCEX: [The Block](https://www.theblock.co/amp/post/363623/polymarket-plans-to-re-enter-us-with-acquisition-of-derivatives-exchange-qcex), [CryptoSlate](https://cryptoslate.com/?p=490519), [pm.wiki](https://pm.wiki/uk/projects/polymarket-us), [Polymarket US API ref](https://apidocs.polymarketexchange.com/api-reference), [Dwellir guide](https://www.dwellir.com/guides/polymarket-api-guide), [defirate list](https://defirate.com/learn/what-are-prediction-markets/)
- Polymarket native USDC / Circle: [The Block](https://www.theblock.co/post/388670/polymarket-to-swap-bridged-usdc-e-on-polygon-for-native-usdc-via-circle-partnership), [PaymentExpert](https://paymentexpert.com/2026/02/06/circle-polymarket-deal-cftc-shift/)
- DFlow / Kalshi on Solana and KYC: [DFlow KYC](https://pond.dflow.net/prediction-markets/kyc), [DFlow buy outcome tokens](https://pond.dflow.net/prediction-markets/recipes/buy-outcome-tokens), [QuickNode guide](https://www.quicknode.com/guides/solana-development/3rd-party-integrations/kalshi-prediction-markets-with-dflow), [The Block](https://www.theblock.co/amp/post/380983/kalshi-tokenizes-thousands-of-its-prediction-markets-using-solana)
- Regulation: [Insurance Business](https://www.insurancebusinessmag.com/us/news/catastrophe/is-a-kalshistyle-weather-contract-insurance-look-to-insurable-interest-596536.aspx), [Better Insurance](https://betterins.substack.com/p/climate-risk-parametric-insurance), [GT Law](https://www.gtlaw.com/en/insights/2026/3/cftc-regulatory-developments-on-prediction-markets-and-event-contracts), [Mayer Brown](https://www.mayerbrown.com/-/media/files/perspectives-events/publications/2026/06/cftc-prediction-markets-proposed-rules.pdf%3Frev=267eeac07c4d4b76bbf6894751a91be4)
