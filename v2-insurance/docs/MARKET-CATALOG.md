# Prediction-market catalog: what Gemini, Kalshi and Polymarket list, and what a small business can hedge with it

Snapshot: 2026-11-19 ~08:40 UTC, pulled from the three public read-only APIs (no keys, no orders).
Machine-readable version: `lib/markets/catalog.json` (637 market types plus 52 themes). To rebuild it, run `npx tsx scripts/catalog-markets.ts --refresh`.

This catalog lists market **types** (a series, ticker family or recurring group), not individual contracts. Each type carries: venue, category, series id, title/example, frequency, locations, settlement source, live events/contracts, volume, median YES ask, and whether Hedgehog indexes it today. Each type also belongs to a **theme**. The theme holds the business relevance, the kinds of business that could hedge with it, and the causal story.

## TL;DR for the advisor and playbook agents

- **Size of the universe:** Gemini has 1,620 active events across 201 types (most of them sports). Kalshi has 16,702 series, of which 4,956 are live, with 21,223 open events and 180k contracts. Polymarket has 18,932 open events.
- **Gemini is narrow.** Outside sports and crypto it lists the following:
  - daily highs in about 62 cities (`WXHIGH`)
  - six daily commodities: WTI, Brent, natural gas, gold, silver, copper
  - a few macro events: the Fed in December, GDP 2026, max unemployment in 2026, recession 2026, S&P year-end
  - seasonal monthly "US gas prices this month?" events (`GASFEB`/`GASMARCH`, none live now)
  - "Government shutdown by Jan 31" (settled)

  It has **no** low-temperature, rain, snow, hurricane, electricity, food, housing or travel markets. Kalshi is where almost every small-business peril lives.
- **Gemini markets we list but do not index:** Hedgehog fetches only Gemini's Weather, Sports, Commodities and Crypto categories, so it misses Gemini's own `FED`, `CPI`, `GDP*`, `UNEMP*`, `RECESSION`, `GAS*` and `GOVSHUTDOWN`. Fed and CPI hedges therefore currently route to Kalshi, which works against the "Gemini-first" story. Adding the `Economics` and `Politics` categories is a one-line change (see "Worth indexing next", item 1).
- **High-relevance Kalshi families that Hedgehog does not index:**
  - weather: monthly rain totals for 36 cities, daily lows in 24 live cities, daily highs in 16 more cities than we index, monthly snow totals for 13 cities, snow-day counts for 22 cities, opening dates for 20 live ski resorts plus resort snowfall, hurricane landfall by city/state
  - energy and food: diesel, state gas prices, ERCOT/PJM/MISO power prices, chicken wings, eggs, FAO food index, menu prices
  - money and housing: 30-year mortgage rate weekly, housing permits and home sales
  - demand and travel: TSA throughput (daily and weekly), state visitor counts, Carbon Arc card-spend and foot-traffic markets per restaurant/retail chain
  - policy: government shutdown, tariff rates, minimum wage, cannabis rescheduling
- **Polymarket** (read-only for us) mirrors the macro set and adds daily high/low temperatures for about 50 mostly international cities, `median-home-price-<city>` (Austin, Dallas, NYC, LA, ...), weekly box-office openings, US gas price (daily/weekly/monthly), egg prices and Hormuz/oil tails.
- **Settlement sources:** for weather the sources are NWS station or The Weather Company. Economics settles on BLS, BEA, the Fed, AAA, EIA or USDA. Kalshi also uses NY Fed "Economic Data" and Carbon Arc for many state/sector series. Polymarket mostly uses its UMA resolution text.

## 1. Venue overviews (counts by category)

### Gemini Predictions (paged per category; active + newest ≤1000 settled per category)

| Category | Market types (series) | Live types | Active events | Recently settled events | Volume (listed+settled) |
|---|---:|---:|---:|---:|---:|
| Sports | 58 | 58 | 1394 | 2924 | $9.5M |
| Crypto | 19 | 19 | 102 | 1000 | $400k |
| Weather | 1 | 1 | 66 | 1000 | $20k |
| Politics | 43 | 17 | 19 | 222 | $5.8M |
| Commodities | 6 | 6 | 18 | 1000 | $660k |
| Economics | 28 | 9 | 9 | 31 | $3.0M |
| Business | 12 | 6 | 6 | 6 | $488k |
| Tech | 13 | 3 | 3 | 12 | $588k |
| Culture | 18 | 3 | 3 | 15 | $332k |
| Fun/Culture | 1 | 0 | 0 | 1 | $2k |
| Other | 2 | 0 | 0 | 18 | $0k |
| **Total** | 201 | 122 | 1620 | 6229 | $20.8M |

### Kalshi (all series from /series; live = has an open event)

| Category | Series | Live series | Open events | Open contracts | Lifetime volume of open events |
|---|---:|---:|---:|---:|---:|
| Sports | 4304 | 1241 | 8111 | 96709 | $862.4M |
| Entertainment | 2657 | 372 | 829 | 10295 | $88.3M |
| Elections | 2610 | 695 | 8837 | 35601 | $724.6M |
| Politics | 2540 | 865 | 922 | 4060 | $165.8M |
| Financials | 1288 | 648 | 1043 | 19126 | $85.1M |
| Economics | 922 | 445 | 585 | 4703 | $102.5M |
| Climate and Weather | 536 | 202 | 248 | 1411 | $5.9M |
| Mentions | 502 | 153 | 153 | 2185 | $1.0M |
| Science and Technology | 397 | 157 | 197 | 1340 | $78.4M |
| Crypto | 303 | 89 | 136 | 2432 | $125.0M |
| Companies | 192 | 36 | 52 | 458 | $2.3M |
| World | 137 | 0 | 0 | 0 | $0k |
| Commodities | 120 | 51 | 108 | 1958 | $12.7M |
| Health | 94 | 0 | 0 | 0 | $0k |
| Social | 48 | 1 | 1 | 1 | $3k |
| Transportation | 34 | 0 | 0 | 0 | $0k |
| Exotics | 14 | 0 | 0 | 0 | $0k |
| Culture | 2 | 0 | 0 | 0 | $0k |
| Education | 1 | 0 | 0 | 0 | $0k |
| Business | 1 | 1 | 1 | 1 | $1k |
| **Total** | 16702 | 4956 | 21223 | 180280 | $2254.0M |

### Polymarket (all active, open events via /events/keyset; category = first matching primary tag)

| Category | Open events | Recurring series | Volume |
|---|---:|---:|---:|
| Sports | 11214 | 229 | $362.9M |
| Crypto | 3806 | 87 | $308.4M |
| Politics | 1327 | 49 | $3168.1M |
| Finance | 798 | 219 | $117.6M |
| Geopolitics | 445 | 188 | $1255.3M |
| Weather | 301 | 90 | $40.9M |
| Tech | 289 | 159 | $42.4M |
| Economy | 244 | 112 | $179.5M |
| Culture | 243 | 30 | $91.1M |
| Movies | 169 | 14 | $60.1M |
| Business | 35 | 12 | $16.2M |
| Science | 15 | 4 | $84.3M |
| NFL (All) | 7 | 0 | $2.4M |
| World | 4 | 0 | $313k |
| Fed | 3 | 1 | $1.8M |
| UK | 2 | 0 | $1.1M |
| other (28 tags) | 30 | 2 | $4.7M |
| **Total** | 18932 | 1196 | $5737.0M |


### What each venue actually lists (types, not contracts)

**Gemini Predictions**. Category list from `/v1/prediction-markets/categories`: Live, Sports, Pro Football, Crypto, College Football, Commodities, Economics, Economy, Fun/Culture, Media, Politics, Tech, Business, Weather, Culture, Other, Finance. The unfiltered `/events?status=active` listing is truncated at about 1,000 events, so the script pages each category separately.
- *Weather*: one series, `WXHIGH` ("Highest temperature in <city> on <date>?"), daily, 1-2°F (or 1°C) brackets, 62 cities. These include Austin, San Antonio, Dallas, Houston and most large US metros, plus London, Munich, Tel Aviv, Ankara, Toronto, Mexico City and Sao Paulo. No lows, no rain, no snow.
- *Commodities*: `WTI`, `BRENT`, `NGAS`, `XAU`, `XAG`, `COPPER`. Each is a daily "price on <date>?" ladder that expires 5pm ET, and each has about 166 settled events, so they are reliably recurring.
- *Economics*: `FED` (each FOMC), `CPI` (monthly, seasonal listing), `GDP2026`, `GDPD`/`GDPW`/`GDPMON` (GDP nowcast index, daily/weekly/quarterly), `UNEMP2026` and `UNEMPD/W/MON`, `JOBSFEB`, `RECESSION26`, `GASFEB`/`GASMARCH` ("US gas prices this month?"), `HORMUZ*`, and S&P/Nasdaq year-end/high/low.
- *Politics*: elections (`SEN`, `HOUSE`, `GOV`, `PRES2028`, ...), `GOVSHUTDOWN` (settled), `DHSFUND`, `CRYPTOSTRUCT`, `SAVEACT`, cabinet and Fed chair.
- *Sports*: games named `<LEAGUE>-<yymmddhhmm>-<AWAY>-<HOME>-<suffix>`. Suffix `M` is the moneyline, which is all Hedgehog indexes. `T`/`S`/`REGT`/`REGS`/quarter suffixes are totals and spreads, and the rest are player props. Leagues: NFL, NCAAF, NCAAM, NBA, NHL, MLS, EPL, La Liga, Liga MX, UCL, plus golf top-10s. Futures: NFL team win totals for all 32 teams, divisions, AFC/NFC, Super Bowl, MVP/ROY/COY, CFB conference champions, CFP, Heisman.
- *Crypto*: BTC/ETH/SOL/XRP at 5-minute, 15-minute and hourly intervals, plus HYPE/ZEC.
- *Tech/Business/Culture/Other*: AI model releases, IPO timing, Rotten Tomatoes/Metacritic scores, Oscars, and the GPU compute / AI token price indexes (`GPU_*`, `TOKEN_*`, settled only).

**Kalshi** has 16.7k series. Each series has `category`, `tags`, `frequency` and `settlement_sources`.
- *Climate and Weather* (536 series, 202 live). See the table in section 2. In brief:
  - daily high (`KXHIGH*`, `KXHIGHT*`) and daily low (`KXLOWT*`): 24 live US cities each, about 55 series each when dormant international cities are included
  - "Where will it rain" for 36 cities daily (`KXRAIN`), weekend (`KXRAINWKND`) and Thanksgiving; per-city daily rain (`KXRAIND*`); monthly rain totals for 36 cities (`KXRAIN<city>M`); Napa seasonal rain
  - monthly snow totals for 13 cities (`KX<city>SNOWM`), snow days per city for 22 cities (`KXSNOWDAYS`), white-Christmas markets
  - opening dates for 20 live ski resorts (`KX<resort>OPEN`) and resort snowfall
  - hurricanes: counts, landfall by state/city, names; tornadoes per month; earthquakes and volcanoes; Lake Mead level; heating degree days (`KXHDDCVG`); AQI (`KXAQICITY`, dormant)
- *Economics* (922 series, 445 live):
  - Fed and central banks; CPI/PCE and sub-indexes; unemployment and jobless claims
  - gasoline: AAA national weekly/monthly/min/max, plus per-state series for TX, CA, FL, NY, NJ and others; diesel weekly/monthly
  - mortgage rate weekly; housing permits by state; existing and new home sales; home prices by state/city
  - tourism: visitors to FL, NV, HI; Orlando hotel demand; TSA weekly (`KXTSAW`) and daily (`KXTSAD`); airport passenger counts
  - ports: TEU at NY/NJ, Savannah, Virginia, SC, Mobile, Baltimore
  - farm: corn yield, milk, maple, lobster, cattle
  - state industry employment: WA aerospace, AZ semiconductors, MI autos
  - power: ERCOT peak demand, PJM emergency days, retail electricity price; plus chicken wings, the FAO food index, paper price index and fertilizer
- *Commodities*: WTI, Brent, gold, silver, copper and natural gas (daily, weekly and monthly), ERCOT/PJM/MISO hub power prices (weekly, monthly), Aluminum Midwest premium, and AI token prices.
- *Financials/Companies*: index ranges, FX (USD/MXN, USD/BRL, DXY, ...), IPOs and M&A.
  - Carbon Arc "point of sale", "credit card spend", "foot traffic" and "app downloads" markets for about 150 consumer brands: Chick-fil-A, Olive Garden, Chipotle, LongHorn, Costco, ALDI, Dollar General, Macy's, Nordstrom, Sephora, Pepsi/Coke/Dr Pepper/energy drinks, coffee-chain foot-traffic array.
  - Fiscal.ai company KPIs: airline load factors, Carnival berth days, Chipotle store count, Wendy's/CAVA same-store sales.
- *Politics*: tariffs (rates by country, sectors, revenue), shutdown (date, length, count), minimum wage (federal, NYC, PA, WI, CT, ...), cannabis (rescheduling, 280E, SAFE Banking, state legalization, THC drinks), taxes (gas-tax holiday, NYC Mamdani taxes, capital gains), data-center moratoria, immigration.
- *Science and Technology*: measles, H5N1, screwworm, pandemics, dengue, GPU rental prices (Ornn H100/H200/B200/RTX5090).
- *Entertainment*: Rotten Tomatoes, Spotify/Billboard, Netflix ranks, wide-release count (`KXSLATECOUNT`), Broadway attendance, Coachella/Stagecoach headliners, tour cancellations.
- *Sports*: 4.3k series. Game-winner series exist for NFL, NCAAF, NBA, NCAAMB, NCAAWB, NHL, MLS, NWSL, USL, AHL, NCAAH, MLB/WNBA (off-season) and about 60 international leagues. Futures cover playoffs, titles, wins, MVPs and `KXCITYCHAMPS`. There are hundreds of prop/total/spread series.
- *Elections and Mentions*: thousands of one-offs. They have no hedge value except as regulatory proxies.

**Polymarket** (Gamma). 18.9k open events. 1,196 recurring "series" slugs carry a `recurrence` field (daily/weekly/monthly/5m/15m/hourly).
- *Sports*: 11.2k events. Daily series per league: `nba-2026`, `nfl-2026`, `cfb-2026`, `nhl-2026`, `ncaa-cbb`, `cwbb`, `mls-2025`, `ahl-2026`, and about 150 international leagues. Each event carries many prop markets.
- *Crypto*: 3.8k events; 5-minute, 15-minute and hourly up/down for 8 coins.
- *Weather* (301): `<city>-daily-weather` (high) and `<city>-daily-lowest-temperature` for about 50 cities, mostly international; `monthly-precipitation` (Seattle, NYC, London, HK, Seoul); `rain-daily`; monthly tornadoes; earthquakes; hottest year. Polymarket tags measles and hantavirus as "Weather".
- *Economy/Finance*: Fed (`fomc`, rate-cut counts), CPI/PCE monthly, unemployment, GDP by country, Treasury yields (2/5/10/30y high/low), `median-home-price-<city>` (US, NYC, LA, SF, Chicago, DC, Miami, Austin, Dallas, Denver), gas (`gas-price-hits` monthly/weekly, `us-gas-price-daily`), `egg-prices-monthly`, ground beef, WTI/gold/silver/natgas hit-price and up/down, GPU rental prices, FX up/down.
- *Movies/Culture*: `box-office-openings` (weekly opening-weekend ladders), `box-office-total-gross`, `biggest-opening-weekend`, Rotten Tomatoes, Netflix/Spotify charts.
- *Geopolitics/Politics*: elections, Hormuz/Bab el-Mandeb, tariffs (Canada, China rate), data-center moratoria by state.

## 2. Cross-venue map (theme × venue)

Cell = market types (series/groups) · live events · volume · Hedgehog indexed? (`yes`/`partial`/`read-only`/`no`). `—` = venue has nothing live for this theme.

| Theme | Relevance | Gemini | Kalshi | Polymarket |
|---|---|---|---|---|
| US team game winner (moneyline) (`sports_game_us`) | high | 5 · 247 ev · $5.8M · yes | 14 · 701 ev · $10.0M · yes/no | 9 · 2165 ev · $29.4M · read-only/no |
| Season futures: wins, playoffs, titles, awards (`sports_futures`) | medium | 34 · 65 ev · $1.1M · no | 371 · 984 ev · $784.2M · no | 15 · 785 ev · $268.4M · partial |
| Game lines & props (totals, spreads, quarters, players) (`sports_props`) | low | 10 · 1062 ev · $2.7M · no | 387 · 3285 ev · $34.7M · no | 85 · 3327 ev · $10.1M · partial |
| Other sports (intl soccer, tennis, golf, MMA, esports, cricket, motorsport) (`sports_other`) | low | 9 · 20 ev · $29k · partial | 471 · 3141 ev · $33.6M · no | 123 · 4937 ev · $55.0M · partial |
| Ski resort opening dates & resort snowfall (`ski_season`) | high | — | 49 · 32 ev · $1.3M · no | — |
| City snowfall (monthly totals, snow-day counts, white Christmas) (`snow_city`) | high | — | 69 · 27 ev · $205k · no | 1 · 2 ev · $75k · no |
| Hurricanes & named storms (counts, landfall by city/state) (`hurricane`) | high | — | 66 · 38 ev · $1.4M · no | 1 · 9 ev · $954k · no |
| Daily high temperature by city (`temp_high_daily`) | high | 1 · 66 ev · $20k · yes | 69 · 29 ev · $283k · yes/no/partial | 50 · 145 ev · $1.1M · read-only |
| Daily low temperature / freeze by city (`temp_low_daily`) | high | — | 81 · 32 ev · $68k · no/yes | 30 · 87 ev · $81k · read-only |
| Weekly/monthly average temperature, degree days (`temp_period`) | medium | — | 3 · 3 ev · $120k · no | 1 · 1 ev · $21k · no |
| Monthly / multi-day rainfall totals by city (`rain_period`) | high | — | 44 · 42 ev · $428k · no/partial | 1 · 5 ev · $28k · no |
| Daily / weekend / holiday rain by city (`rain_daily`) | high | — | 46 · 30 ev · $249k · yes/no/partial | 1 · 2 ev · $3k · no |
| Tornado counts, natural-disaster declarations (`severe_storm`) | medium | — | 1 · 1 ev · $13k · no | 2 · 3 ev · $345k · no |
| Earthquakes, volcanoes, tsunami (`quake_volcano`) | medium | — | 6 · 8 ev · $754k · no | 5 · 14 ev · $4.1M · no |
| Water levels & drought (Lake Mead/Powell, Mississippi) (`water_drought`) | medium | — | 2 · 2 ev · $97k · no | 1 · 5 ev · $351k · no |
| Air quality (AQI) (`air_quality`) | high | — | 1 · 0 ev · $0k · no | — |
| Climate & ENSO (El Niño, hottest year, sea ice, CO2) (`climate_macro`) | low | — | 15 · 18 ev · $1.2M · no | 4 · 8 ev · $4.8M · no |
| Natural gas price (`natural_gas`) | medium | 1 · 3 ev · $80k · partial | 7 · 7 ev · $288k · no | 4 · 119 ev · $4k · no |
| Retail gasoline price (AAA national & state) (`gasoline`) | high | 2 · 0 ev · $0k · no | 142 · 73 ev · $7.2M · no/yes | 4 · 4 ev · $117k · read-only/no |
| Diesel price (`diesel`) | high | — | 12 · 7 ev · $761k · no | 3 · 6 ev · $2.5M · read-only/no |
| Electricity price / grid stress (ERCOT, PJM, MISO, CPI electricity) (`electricity`) | high | — | 26 · 23 ev · $1.9M · no | 1 · 1 ev · $8k · no |
| Crude oil (WTI, Brent) & oil chokepoints (`crude_oil`) | medium | 4 · 7 ev · $415k · no/yes | 29 · 32 ev · $28.5M · no/partial | 28 · 152 ev · $140.7M · read-only/partial |
| Food & grocery prices (eggs, beef, wings, coffee, FAO index, menu prices) (`food_prices`) | high | — | 40 · 13 ev · $129k · no | 2 · 3 ev · $47k · read-only |
| Farm & fishery output (corn yield, milk, cattle, lobster, maple, cotton) (`ag_production`) | medium | — | 30 · 30 ev · $2.8M · no | — |
| Metals & materials (gold, silver, copper, aluminum, lumber, paper) (`metals_materials`) | medium | 5 · 9 ev · $527k · partial/no | 34 · 90 ev · $1.7M · no | 17 · 244 ev · $5.3M · no |
| Shipping & ports (container volume, freight index) (`freight_trade_flows`) | medium | — | 13 · 14 ev · $1.6M · no | 7 · 10 ev · $372k · read-only/no |
| Tariffs & trade deals (`tariffs_trade`) | high | — | 71 · 34 ev · $2.0M · no | 4 · 8 ev · $877k · no |
| Minimum wage & labor rules (`min_wage_labor`) | high | — | 22 · 17 ev · $183k · no | 1 · 1 ev · $27k · no |
| Government shutdown & federal funding (`shutdown_fiscal`) | high | 2 · 0 ev · $154k · no | 21 · 10 ev · $935k · no | 1 · 2 ev · $134k · no |
| Cannabis legalization & banking (`cannabis`) | high | — | 11 · 10 ev · $1.3M · no | 2 · 2 ev · $839k · no |
| Tax policy (tips, gas tax, property & corporate tax, IRS) (`tax_policy`) | medium | — | 27 · 27 ev · $1.1M · no | 5 · 7 ev · $258k · no/read-only |
| Local/state rules & ordinances (rent freeze, bans, moratoria, permits) (`regulation_local`) | medium | — | 73 · 93 ev · $1.9M · no | 17 · 31 ev · $11.5M · no |
| Immigration enforcement & visas (`immigration`) | medium | — | 9 · 9 ev · $224k · no | 3 · 6 ev · $550k · no |
| Mortgage rates & Treasury yields (`mortgage_rates`) | high | — | 75 · 142 ev · $1.0M · no | 9 · 18 ev · $3.5M · no |
| Fed / central-bank rate decisions (`fed_rates`) | medium | 2 · 1 ev · $2.0M · no | 58 · 101 ev · $38.8M · yes/no | 27 · 70 ev · $122.2M · read-only/partial |
| Housing (permits, starts, home prices, rents, home sales) (`housing`) | high | — | 62 · 46 ev · $1.1M · no | 10 · 10 ev · $480k · no |
| Travel & tourism (TSA throughput, airport passengers, visitors, hotels, cruises, parks) (`travel_tourism`) | high | — | 65 · 50 ev · $2.4M · no | 2 · 2 ev · $98k · no |
| Consumer spend & traffic (card spend, foot traffic, POS, retail sales, sentiment) (`consumer_spend`) | high | — | 196 · 180 ev · $2.7M · no | 1 · 1 ev · $59k · no |
| Jobs, unemployment, jobless claims, state/industry employment (`jobs_labor`) | medium | 5 · 1 ev · $22k · no | 45 · 72 ev · $4.0M · no | 6 · 7 ev · $683k · no |
| GDP & recession (`gdp_recession`) | medium | 6 · 2 ev · $205k · no | 29 · 99 ev · $8.5M · no | 11 · 19 ev · $4.2M · no |
| Inflation (CPI, PCE, Truflation, category CPIs) (`cpi_inflation`) | medium | 1 · 0 ev · $50k · no | 36 · 80 ev · $5.2M · yes/no | 13 · 25 ev · $3.6M · read-only |
| FX & dollar index (`fx`) | medium | — | 20 · 95 ev · $693k · no | 15 · 22 ev · $293k · no |
| Equity indices (S&P 500, Nasdaq) & largest company (`equity_index`) | low | 6 · 4 ev · $261k · no | 28 · 45 ev · $21.6M · no | 16 · 22 ev · $13.2M · no |
| Disease outbreaks (measles, H5N1, pandemics, dengue, screwworm) (`health_outbreak`) | medium | — | 17 · 19 ev · $5.5M · no | 7 · 17 ev · $31.5M · no |
| GPU rental & AI token prices (`gpu_ai_costs`) | medium | 2 · 0 ev · $0k · no | 17 · 62 ev · $976k · no | 15 · 25 ev · $880k · no |
| Box office, film slate, streaming & music charts (`box_office_media`) | medium | 6 · 2 ev · $33k · no | 71 · 199 ev · $18.9M · no | 32 · 80 ev · $27.6M · no |
| Concerts, tours, festivals, Broadway, halftime (`live_events`) | medium | 1 · 0 ev · $8k · no | 15 · 18 ev · $2.6M · no | 1 · 7 ev · $307k · read-only |
| Company KPIs, IPOs, M&A, CEOs (`company_kpi`) | low | 9 · 4 ev · $444k · no | 340 · 399 ev · $55.8M · no | 29 · 91 ev · $128.1M · no |
| Crypto prices (`crypto`) | low | 21 · 104 ev · $848k · partial | 109 · 184 ev · $136.1M · no | 102 · 3570 ev · $187.1M · no |
| Elections, appointments & politics (`elections_politics`) | low | 36 · 14 ev · $5.0M · no | 1064 · 9355 ev · $854.5M · no | 75 · 1379 ev · $3380.8M · partial |
| Geopolitics & conflict (`geopolitics`) | low | 2 · 1 ev · $196k · no | 42 · 42 ev · $24.5M · no | 154 · 308 ev · $793.8M · partial |
| Mentions, awards, celebrity & novelty (`mentions_culture`) | none | 31 · 8 ev · $942k · no | 914 · 1173 ev · $147.9M · no | 367 · 1168 ev · $500.6M · partial |

## 3. Business relevance by theme (causal stories)

Relevance is **direct** when the market settles on the loss driver itself (rain at your city, a freeze, the AAA gas price). It is **proxy** when the market moves with your revenue but isn't the cause (TSA throughput, a chain's card spend, mortgage rates). Each `types[]` row in `catalog.json` carries its `theme`; the full text is in `themes[]`.

| Theme | Relevance | Hedge kind | Who can hedge | Causal story |
|---|---|---|---|---|
| `sports_game_us` US team game winner (moneyline) | **high** | direct | sports bars, restaurants/bars near arenas & campuses, team-merch shops, parking lots, pedicabs/rideshare drivers, promo-running retailers | Direct: a home loss (or a game that doesn't happen) cuts post-game crowds and celebration spending; a shop running a 'free X if we win' promo is short the win. Buy the side that pays when revenue is bad (opponent wins) or the side that funds the promo. |
| `sports_futures` Season futures: wins, playoffs, titles, awards | **medium** | proxy | stadium-district bars/restaurants/hotels (extra home playoff dates), merch shops, local TV/radio ad sellers, promo-running brands ('free tacos if the Spurs make the playoffs') | Proxy: deep playoff runs add home dates and foot traffic; missing the playoffs removes them. Also funds season-long promos with a known worst case. |
| `ski_season` Ski resort opening dates & resort snowfall | **high** | direct | ski/snowboard rental & tune shops, ski-town restaurants, bars, lodging, ski schools, shuttle operators | Direct: a late opening or thin early-season snowfall wipes out the Thanksgiving-Christmas peak. Buy 'opens after <date>' or 'snowfall below X'. |
| `snow_city` City snowfall (monthly totals, snow-day counts, white Christmas) | **high** | direct | restaurants & retail (snow-day closures), daycare, delivery/couriers, salons, gyms; plow/snow-removal contractors and hardware stores (hedge the opposite: a snowless winter) | Direct: heavy snow closes storefronts and kills foot traffic; plow operators lose contract income in a dry winter. Monthly 'snow above X in' markets settle on NWS station totals. |
| `hurricane` Hurricanes & named storms (counts, landfall by city/state) | **high** | direct | coastal restaurants, hotels & short-term rentals, marinas, charter fishing, beach retail, event venues in FL/TX/LA/Carolinas/Gulf | Direct: a landfall near you means evacuation, closures and cancelled bookings. City/state landfall markets ('hurricane hits Tampa/Texas coast') are the closest thing to parametric storm cover. |
| `temp_high_daily` Daily high temperature by city | **high** | direct | patio bars & restaurants, food trucks, outdoor markets/events, ice-cream & shaved-ice stands (hedge cool days), landscapers & roofers (lost heat days), golf courses | Direct: extreme heat (or an unseasonably cold day for cold-treat sellers) cuts outdoor traffic. Binary 'high >= X' settles on the NWS station reading for that day. |
| `temp_low_daily` Daily low temperature / freeze by city | **high** | direct | plant nurseries & farms (frost), outdoor dining, food trucks, car washes, event rentals; plumbers/HVAC benefit (hedge mild winters) | Direct: a hard freeze kills nursery stock and empties patios. 'Low <= 32F' is a parametric frost cover. |
| `temp_period` Weekly/monthly average temperature, degree days | **medium** | direct | HVAC contractors, utilities-cost-heavy shops (bakeries, laundromats, greenhouses), seasonal apparel retailers, propane/heating-oil dealers | Direct: a warm winter (few heating degree days) hurts heating-fuel dealers and coat sellers; a hot month raises cooling bills. Settles on a period average, so it hedges a season not a day. |
| `rain_period` Monthly / multi-day rainfall totals by city | **high** | direct | landscapers, painters, roofers & builders (lost workdays), golf courses, outdoor venues, car washes; farms/vineyards (drought side: hedge too little rain) | Direct: a wet month means rained-out workdays and empty patios; a dry one hurts growers. 'Rain above X inches in <month>' settles on the NWS/Weather Company station total. |
| `rain_daily` Daily / weekend / holiday rain by city | **high** | direct | patio bars, outdoor events & weddings, food trucks, farmers markets, amusement parks, bike/kayak rentals, car washes | Direct: rain on your one big day (Saturday market, festival, Thanksgiving) is the classic parametric event cover. |
| `severe_storm` Tornado counts, natural-disaster declarations | **medium** | direct | Plains/Southeast retailers & farms, mobile-home parks, outdoor venues; roofers & restoration firms benefit | Direct (city 'natural disaster hits X' markets) or proxy (national tornado counts) for storm-driven closures. |
| `quake_volcano` Earthquakes, volcanoes, tsunami | **medium** | direct | California/Pacific NW/Hawaii businesses with uninsured interruption risk, Big Island tourism (Kilauea) | Direct but low-probability/catastrophic: a cheap YES on 'M8+ in California' is a tail hedge for business interruption. |
| `water_drought` Water levels & drought (Lake Mead/Powell, Mississippi) | **medium** | proxy | Lake Mead/Powell marinas & boat rentals, Mississippi barge/grain shippers, farms, golf courses facing watering limits | Proxy: low water shuts boat ramps and raises barge freight; drought means irrigation cuts. |
| `air_quality` Air quality (AQI) | **high** | direct | outdoor dining, tour operators, youth sports camps, gyms with outdoor classes | Direct: smoke days (AQI > 150) cancel outdoor activity. Kalshi has listed city AQI markets (KXAQICITY); none open right now. |
| `natural_gas` Natural gas price | **medium** | direct | restaurants & bakeries (gas ranges/ovens), greenhouses, laundromats & dry cleaners, heating-cost-heavy shops | Direct cost proxy for gas utility bills (Henry Hub feeds retail tariffs with a lag). |
| `gasoline` Retail gasoline price (AAA national & state) | **high** | direct | delivery & courier services, rideshare/taxi drivers, food trucks, landscapers, mobile groomers, plumbers/HVAC/electrician fleets, lawn care | Direct cost hedge: YES on 'AAA average above $X' pays when fuel costs spike. State markets exist for TX, CA, FL, NY, NJ. |
| `diesel` Diesel price | **high** | direct | truckers & freight brokers, farms, construction contractors, moving companies, food distributors, fishing boats | Direct cost hedge on the fuel that runs commercial vehicles; settles on EIA/AAA diesel averages. |
| `electricity` Electricity price / grid stress (ERCOT, PJM, MISO, CPI electricity) | **high** | direct | restaurants & bars (refrigeration, kitchens), laundromats, ice makers, cold storage, small manufacturers, crypto/AI micro-datacenters, greenhouses | Direct: real-time power price or grid-emergency spikes (Texas summer) drive bills; ERCOT peak demand is also a heat proxy. |
| `crude_oil` Crude oil (WTI, Brent) & oil chokepoints | **medium** | proxy | anything fuel- or plastics-heavy: delivery fleets, airlines-exposed travel agencies, plastics/packaging buyers | Proxy: crude leads gasoline/diesel by ~2 weeks; Hormuz/Red Sea markets are tail hedges for an oil shock. |
| `food_prices` Food & grocery prices (eggs, beef, wings, coffee, FAO index, menu prices) | **high** | direct | restaurants, bakeries, cafes, diners, wing bars, food trucks, caterers, grocery/convenience stores | Direct input-cost hedge: YES on 'egg/beef/wing price above X' pays when the menu margin gets squeezed. |
| `ag_production` Farm & fishery output (corn yield, milk, cattle, lobster, maple, cotton) | **medium** | direct | farms & ranches, co-ops, farm-supply stores, seafood restaurants/markets (lobster, salmon), maple producers, distilleries | Direct for producers (low yield/landings), proxy for buyers (scarcity = higher input prices). |
| `metals_materials` Metals & materials (gold, silver, copper, aluminum, lumber, paper) | **medium** | direct | jewelers (gold/silver), electricians & HVAC (copper), craft brewers/canners (aluminum premium), builders (lumber), print shops (paper index) | Direct input-cost hedge: YES on 'gold above X' offsets a jeweler's restocking cost; 'aluminum Midwest premium above X' offsets can costs. |
| `freight_trade_flows` Shipping & ports (container volume, freight index) | **medium** | proxy | importers, e-commerce sellers, furniture/appliance retailers, customs brokers, port-adjacent trucking | Proxy: freight-rate spikes raise landed cost; port volume falls signal slower local logistics work. |
| `tariffs_trade` Tariffs & trade deals | **high** | direct | importers & retailers of imported goods (apparel, electronics, furniture), auto-repair (parts), craft brewers (aluminum), restaurants buying imported produce/wine, Canadian/Mexican cross-border shops | Direct: YES on 'US tariff rate on China/Canada above X' pays exactly when landed costs jump. |
| `min_wage_labor` Minimum wage & labor rules | **high** | direct | restaurants, retail, childcare, cleaning services, home-care agencies (wage-heavy cost base) | Direct: 'state/city raises minimum wage to X' resolves YES when payroll costs rise. |
| `shutdown_fiscal` Government shutdown & federal funding | **high** | direct | businesses near federal workforces (DC, military bases), national-park gateway towns, government contractors, SBA-loan applicants | Direct: a shutdown halts federal paychecks, closes parks, freezes SBA lending. 'Shutdown by <date>' / 'shutdown length > X days' pay exactly then. |
| `cannabis` Cannabis legalization & banking | **high** | direct | dispensaries, hemp/THC-drink shops, grow suppliers, smoke shops | Direct: rescheduling/280E relief changes the tax bill; a state legalization creates competition (hedge with YES) or opportunity. |
| `tax_policy` Tax policy (tips, gas tax, property & corporate tax, IRS) | **medium** | direct | restaurants (tip taxation), landlords (property tax), fuel retailers (gas tax holiday), NYC businesses (Mamdani tax plans) | Direct where a tax change hits the P&L; stimulus/tariff-dividend checks are a demand proxy for retail. |
| `regulation_local` Local/state rules & ordinances (rent freeze, bans, moratoria, permits) | **medium** | direct | landlords & property managers (rent freeze), NYC retailers, businesses in states debating data-center/sports-betting/raw-milk rules | Direct: buy YES on the rule that would hurt you (e.g. 'rent freeze enacted'). |
| `immigration` Immigration enforcement & visas | **medium** | proxy | construction, agriculture, landscaping, restaurants & hotels relying on immigrant labor | Proxy for labor-supply shocks. |
| `mortgage_rates` Mortgage rates & Treasury yields | **high** | direct | realtors, mortgage brokers, home builders & remodelers, movers, title companies, furniture & home-improvement stores | Direct demand hedge: transactions dry up when the 30-yr rate rises; YES on 'rate above X' pays when deal flow falls. |
| `fed_rates` Fed / central-bank rate decisions | **medium** | direct | any business with a variable-rate loan, SBA 7(a) loan or line of credit; equipment lessors | Direct: SBA 7(a) loans float on Prime (Fed funds + 3%); YES on 'no cut'/'hike' offsets higher interest. |
| `housing` Housing (permits, starts, home prices, rents, home sales) | **high** | direct | contractors & trades, realtors, landlords, building-supply yards, interior designers, cleaners/movers | Direct: fewer permits/sales = fewer jobs for trades; state-level permit markets (CA, CO, VT, CT) map to local builders. |
| `travel_tourism` Travel & tourism (TSA throughput, airport passengers, visitors, hotels, cruises, parks) | **high** | proxy | hotels/B&Bs, tour operators, souvenir shops, airport shuttles & parking, restaurants in tourist districts (Orlando, Las Vegas, Hawaii, Florida, national-park gateways) | Proxy with local resolution: 'Florida/Nevada/Hawaii visitors below X', 'Orlando hotel demand up?', 'Canadian trips to US down 20%' track exactly the crowds a tourist-town shop sells to. |
| `consumer_spend` Consumer spend & traffic (card spend, foot traffic, POS, retail sales, sentiment) | **high** | proxy | restaurants (Chick-fil-A/Olive Garden/Chipotle/LongHorn spend), coffee shops (coffee-chain traffic array), discount & sporting-goods retail (Dollar General, Academy, Dick's), beauty (Sephora), energy-drink/soda distributors | Sector proxy: Carbon Arc card-spend / foot-traffic markets on big chains move with the same local demand a small competitor sees. Buy 'below X' to hedge a sector slowdown. |
| `jobs_labor` Jobs, unemployment, jobless claims, state/industry employment | **medium** | proxy | discretionary retail & restaurants (demand), staffing agencies, businesses in one-industry towns (aerospace in WA, autos in MI, semis in AZ/OR) | Proxy: rising local unemployment cuts discretionary spend; state-industry employment markets track company-town demand. |
| `gdp_recession` GDP & recession | **medium** | proxy | discretionary businesses: restaurants, salons, gyms, boutiques, travel agencies, event planners | Proxy tail hedge: 'recession in 2027' pays in the scenario where discretionary revenue falls. |
| `cpi_inflation` Inflation (CPI, PCE, Truflation, category CPIs) | **medium** | proxy | fixed-price sellers (contractors with bids, subscription businesses), restaurants (menu pricing lag) | Proxy: high inflation squeezes fixed-price margins. Category CPIs (used cars, electricity, groceries) are tighter. |
| `fx` FX & dollar index | **medium** | direct | importers/exporters, border-town retailers (Canadian/Mexican shoppers), tourism businesses reliant on foreign visitors | Direct: a strong dollar keeps foreign tourists home and cheapens imports. |
| `health_outbreak` Disease outbreaks (measles, H5N1, pandemics, dengue, screwworm) | **medium** | proxy | event venues & tour operators (pandemic), poultry farms & egg buyers (H5N1), Florida tourism (dengue), daycare | Proxy: outbreaks trigger closures or supply shocks (bird flu -> egg prices). |
| `gpu_ai_costs` GPU rental & AI token prices | **medium** | direct | small AI/SaaS startups, render farms, agencies reselling AI services | Direct cost hedge on compute: YES on 'H100 hourly above $X' pays when inference costs rise. |
| `box_office_media` Box office, film slate, streaming & music charts | **medium** | proxy | independent movie theaters (opening weekend, wide-release count), cinema-adjacent restaurants, record stores/music venues | Proxy: a weak tentpole opening or a thin release slate means empty seats and concessions. |
| `live_events` Concerts, tours, festivals, Broadway, halftime | **medium** | proxy | venues, hotels/bars/restaurants near festivals & theaters, merch printers | Proxy: 'Broadway attendance', 'Coachella headliner', 'tour cancellations' track local event-driven traffic. |


## 4. Top 30 business-relevant market types

Venue · series · what it settles on · who could hedge · whether Hedgehog indexes it. "Vol" is the lifetime volume of the currently listed events. "Mid" is the median YES ask.

| # | Venue · series | Settles on | Who hedges (direction) | Indexed |
|---|---|---|---|---|
| 1 | Gemini · `WXHIGH` (62 cities, daily, 1-2°F brackets) | NWS station daily max | patio bars, food trucks, ice cream, roofers/landscapers in any big US metro (YES on hot bracket / NO on cool) | yes |
| 2 | Kalshi · `KXHIGH*`/`KXHIGHT*` (24 live cities, daily) | NWS/Weather Co. daily max | same as #1; second venue to cross-check Gemini price | 8 cities yes, rest no |
| 3 | Kalshi · `KXLOWT*` (24 live cities, daily) | daily min temperature | nurseries/farms (frost), food trucks, outdoor dining; **Gemini has no lows** | Austin only |
| 4 | Kalshi · `KXRAIN` / `KXRAINWKND` / `KXRAINTHANKSGIVING` (36 cities) | any measurable rain at city station that day/weekend | farmers markets, patio bars, outdoor events, car washes | yes |
| 5 | Kalshi · `KXRAIN<city>M` (36 cities, monthly, "above 1/2/3 in") | monthly rainfall total | landscapers, roofers, painters, builders (lost workdays), golf; growers take the dry side | Austin only |
| 6 | Kalshi · `KX<city>SNOWM` (13 cities incl. CHI, NYC, BOS, DEN, DC, MSP, DET, PIT, SEA, PHL) | monthly snowfall "above X in" | shops and restaurants (snow-day closures); plow contractors take the NO side (snowless month) | no |
| 7 | Kalshi · `KXSNOWDAYS` (22 cities, Dec 1-Apr 1) | count of snow days per city | daycare, salons, gyms, delivery: a season-long closure-days hedge | no |
| 8 | Kalshi · `KX<resort>OPEN` (20 live resorts) + `KXTSNOWFALLBIGSKYM`, `KX<resort>SNOW` | resort opening date / snowfall | ski-town rental shops, lodging, restaurants (late opening = lost holiday peak) | no |
| 9 | Kalshi · `KXHURPATH*`, `KXHURCITY*`, `KXHURRLANDFL4`, `KXHURCTOTMAJ` | NHC landfall by state/city, season counts | coastal FL/TX/LA/Carolinas restaurants, rentals, marinas (season ends Nov 30; relists for 2027) | no |
| 10 | Kalshi · `KXAAAGASW` / `KXAAAGASM` + state `KXAAAGASMAX/MIN{TX,CA,FL,NY}` | AAA national/state average | delivery, rideshare, landscaping fleets, mobile services | national yes; state no |
| 11 | Kalshi · `KXDIESELW` / `KXDIESELMON` / `KXDIESELMAXY` | AAA/EIA diesel average | truckers, farms, movers, contractors, food distributors | no |
| 12 | Kalshi · `KXERCOT{NORTH,HOU,WEST}{W,M}`, `KXTXERCOTPEAK`, `KXPOWERKWH` | ERCOT hub real-time price / peak MW / BLS kWh price | Texas restaurants, bars, cold storage, laundromats; ERCOT peak doubles as a heat hedge | no |
| 13 | Gemini · `NGAS` daily; Kalshi · `KXNATGASW` | Henry Hub settle | restaurants & bakeries (gas ovens), greenhouses, laundromats | Gemini partial (fetched as "other") |
| 14 | Kalshi · `KXCHICKENWINGM`, `KXEGGS`, `KXFAOFPI`, `KXGROCERYCPI`; Polymarket · `egg-prices-monthly`, ground beef | USDA wholesale wing price, BLS egg CPI, FAO index | wing bars, diners, bakeries, caterers (input cost) | no |
| 15 | Kalshi · menu-price series `KXMCDSBIGMAC`, `KXCFACHICKSAND`, `KXCHIPBURRITO`, `KXPOPCHICKSAND`, `KXCOSTCOHOTDOG` | competitor menu price | independent restaurants (pricing cover / signal when chains raise prices) | no |
| 16 | Kalshi · Carbon Arc `KX<brand>CC`/`FT`/`POS` (`KXCFILCC`, `KXOLIVEGARDENCC`, `KXDGFT`, `KXCOFFEEARRAY`, ~150 brands) | monthly card spend / foot traffic vs threshold | same-sector small businesses (cafe ↔ coffee-chain traffic, casual dining ↔ Olive Garden spend) | no |
| 17 | Kalshi · `KXTSAD` (daily) / `KXTSAW` (weekly) | TSA checkpoint throughput | airport-area hotels, parking, shuttles, travel agencies | no |
| 18 | Kalshi · `KXFLVISITORCOUNT`, `KXNVVISIT`, `KXHIVISITORS`, `KXORLHOTELDEMAND`, `KXCANUSTRIPS` | state/region visitor statistics (NY Fed econ data) | tourist-town retail/restaurants (Orlando, Vegas, Hawaii, border towns) | no |
| 19 | Kalshi · `KX30YMORTW`, `KXFM30YMTG`, `KXMORTGAGERATE`; Polymarket · Treasury-yield ladders | Freddie Mac PMMS / Treasury yields | realtors, mortgage brokers, movers, remodelers, furniture stores | no |
| 20 | Kalshi · `KX{CA,CO,VT,CT}…PERMITS`, `KXEHSALES`, `KXNHSALES`; Polymarket · `median-home-price-{austin,dallas,…}` | Census permits, NAR sales, Zillow home value | trades and contractors, realtors, building supply | no |
| 21 | Kalshi · `KXGOVTSHUTDOWN` (Dec 12), `KXGOVTSHUTLENGTH`; Gemini · `GOVSHUTDOWN` (relists) | OMB/OPM shutdown | DC-area and military-town businesses, park gateway towns, gov contractors | no |
| 22 | Kalshi · `KXTARIFFRATEPRC`/`CAN`/`MEX`/`EU`, `KXTARIFFSECTOR`, `KXNEWTARIFFS` | effective tariff rate / announcements | importers, retailers, auto repair (parts), brewers (aluminum) | no |
| 23 | Kalshi · `KXALMWP` (Aluminum Midwest premium), `KXPAPER` (paper PPI), `KXLUMBERPPIHIGH`; Gemini · `XAU`/`XAG`/`COPPER` | CME premium, BLS PPI, spot | craft brewers/canners, print shops, builders, jewelers, electricians | Gemini partial |
| 24 | Kalshi · `KXMINWAGE`, `KXNYCMINWAGE`, `KXPAMINWAGE`, `KXWIMINWAGE`, `KXCTMINWAGE` | minimum-wage enactment/level | restaurants, retail, childcare | no |
| 25 | Kalshi · `KXMJSCHEDULE`, `KXMARIJUANA280E`, `KXSAFEBANK`, `KXTXMARIJUANA`, `KXTHC3MG` | federal rescheduling / state legalization / hemp-THC rules | dispensaries, THC-beverage makers, smoke shops | no |
| 26 | Kalshi · `KXNBAGAME`, `KXNFLGAME`, `KXNCAAFGAME`, `KXNHLGAME`, `KXNCAAMBGAME`, `KXMLSGAME`; Gemini · `<LEAGUE>-…-M` | official game result | sports bars, stadium-district restaurants, promo-running shops | NBA/NFL/NCAAF/MLS yes; NHL/NCAAMB/NCAAWB/AHL/USL no (Gemini NHL/NCAAM ML yes) |
| 27 | Kalshi · `KXJOBLESSCLAIMS` (weekly), `KXU3` (monthly); Gemini · `UNEMP*` | DOL/BLS | discretionary retail, staffing agencies | no |
| 28 | Kalshi · `KXFEDDECISION`/`KXFED`; Gemini · `FED` | FOMC target range | anyone with an SBA 7(a)/variable-rate loan | Kalshi yes, Gemini **no** |
| 29 | Kalshi · `KXSLATECOUNT`; Polymarket · `box-office-openings` (weekly) | Box Office Mojo wide releases / opening weekend | indie theaters, cinema-adjacent restaurants | no |
| 30 | Kalshi · `KXBWAYATTENDANCE`, `KXHEADLINE` (Stagecoach), `KXROLEATEVENTCOACHELLA`, `KXTOURCANCEL` | Broadway League attendance, lineup announcements | theater-district restaurants, festival-town hotels/bars | no |

Honourable mentions: `KXHDDCVG` (Cincinnati heating degree days, for propane/HVAC dealers), `KXMEAD` (Lake Mead elevation, for marinas), `KXTORNADO`, `KXEARTHQUAKECALIFORNIA` (cheap tail cover), `KXMEASLES`/`KXH5N1COUNT` (event venues; egg supply), `KXH100MS` and Polymarket `h100-rental-price` (AI startups' compute cost), `KXUSDMXNMAX` (border retail), `KXHOLIDAYRETAIL` / `KXCYBERMONSPEND` (holiday demand), `KXDISLANDPRICE` (Anaheim tourism).

## 5. Non-obvious hedge ideas these markets enable

- **Snow-removal contractor:** buy NO on `KXCHISNOWM` "above 6 in" (or YES on "below") for each winter month. A snowless winter is their revenue loss.
- **Ski-town rental shop:** buy YES on `KXASPENMTNOPEN` "opens after Nov 29" plus YES on low `KXTSNOWFALLBIGSKYM`.
- **Plant nursery:** buy YES on `KXLOWT<city>` "≤ 32°F" for the nights after spring planting. Only Kalshi offers lows.
- **Roofer/painter:** buy YES on `KXRAIN<city>M` "above 3 in" to cover a month of rained-out jobs.
- **Texas bar or restaurant:** buy YES on `KXERCOTNORTHM` "above $X/MWh" to cover summer power bills and grid-stress heat. Combine with `WXHIGH` Austin.
- **Wing bar:** buy YES on `KXCHICKENWINGM` "above 95¢/lb". Wholesale wing prices are its biggest food cost.
- **Craft brewery:** buy YES on `KXALMWP` "≥ 80¢" (Midwest aluminum premium, i.e. can cost) and YES on tariff-rate markets.
- **Independent café:** buy NO on `KXCOFFEEARRAY` above threshold. A sector-wide traffic slump hits it too.
- **Realtor or mover:** buy YES on `KX30YMORTW` "above 7.0%". High rates mean fewer closings.
- **Orlando souvenir shop:** buy NO on `KXORLHOTELDEMAND` (demand up YoY) or NO on `KXFLVISITORCOUNT` above X.
- **Shop near a military base or in DC:** buy YES on `KXGOVTSHUTDOWN` / `KXGOVTSHUTLENGTH` "> 14 days".
- **Hotel near an airport:** buy NO on `KXTSAW` above the seasonal norm for the holiday week.
- **Indie movie theater:** buy NO on `KXSLATECOUNT` "≥ N wide releases" for the quarter, or on Polymarket opening-weekend ladders.
- **Restaurant on a variable-rate SBA loan:** buy YES on Gemini `FED` "maintains" or "hike". This needs Gemini Economics indexed.
- **Dispensary:** buy YES on `KXTXMARIJUANA`. New competition arriving is the risk; `KXMARIJUANA280E` is the tax-relief upside.

## 6. Worth indexing next (ranked by value × ease)

Effort scale: XS is under 30 minutes of config, S is about an hour, M is half a day. "Peril" means the `Peril` union in `lib/types.ts`. New perils touch shared types, so until a new peril is added, map them to `other` with a label.

| # | What | Why | How (effort) |
|---|---|---|---|
| 1 | **Gemini `Economics` + `Politics` categories** (`FED`, `CPI`, `GDP*`, `UNEMP*`, `RECESSION`, `GAS*`, `GOVSHUTDOWN`) | Gemini-first story: Fed/CPI/gas hedges route to Gemini instead of Kalshi; Gemini lists these but we don't fetch them | add `fed: "Economics", cpi: "Economics", gas: "Economics"` to `GEMINI_CATEGORY` in `lib/markets/index.ts` (it's a Partial<Record>, so make it multi-valued or fetch both Commodities+Economics for gas); `perilFromText` already maps fed/cpi/gas. **XS** |
| 2 | **Kalshi daily highs & lows for all cities** (`KXHIGHT{ATL,BOS,DC,LV,SEA,SFO,SATX,PHX,OKC,NOLA,MIN,…}`, `KXLOWT*`: 24 live cities each) | Lows are Kalshi-only (frost/freeze cover); highs give a second venue for every `WXHIGH` city | append `SeriesSpec` rows (`peril: "heat"/"cold"`, `location` from city, `low: true`) in `lib/markets/dflow.ts`; or auto-derive: any `Climate and Weather` series whose title matches /Highest|Lowest temperature in (.+)/. **XS** |
| 3 | **Kalshi monthly rain** `KXRAIN<city>M` (36 cities) + per-city daily `KXRAIND<city>` | Construction/landscaping/outdoor-venue cover; only Austin indexed today | `SeriesSpec` rows, `peril: "rain", period: "month"`; brackets are "Above N inches" (`parseBounds` handles). **XS** |
| 4 | **Snow**: `KX<city>SNOWM` (13), `KXSNOWDAYS` (22 cities in `yes_sub_title`), ski `KX*OPEN` (20 live) / `KX*SNOW` | Winter is next: biggest uncovered weather peril for northern + ski-town businesses | add peril `snow` (or map to `cold`), `SeriesSpec` with `location: "subtitle"` for `KXSNOWDAYS`; opening-date ladders are "Before <date>" → parse date bounds. **S** |
| 5 | **Diesel + state gas** (`KXDIESELW/MON/MAXY/MINY`, `KXAAAGAS{MAX,MIN}{TX,CA,FL,NY}`, `KXAAAGASEOYNJ`) | Fleet businesses; state-level resolution matches local cost | `SeriesSpec` rows `peril: "gas"` (diesel could be its own label), `location: state`. **XS** |
| 6 | **Electricity / grid** (`KXERCOT{NORTH,HOU,WEST}{W,M}`, `KXTXERCOTPEAK`, `KXPJM*`, `KXMISOIND*`, `KXPOWERKWH`, `KXCPIELECYOY`) | Texas demo city; energy is a top-3 cost for restaurants/bars | new peril `power` (or `other`), region from hub name. **S** |
| 7 | **Food inputs** (`KXCHICKENWINGM`, `KXEGGS`, `KXFAOFPI`, `KXGROCERYCPI`, menu-price series; Poly `egg-prices-monthly`) | Restaurants are the core persona; input-cost hedges are intuitive | new peril `food`; monthly thresholds ("Above 90¢ per pound"). **S** |
| 8 | **Mortgage / housing** (`KX30YMORTW` weekly, `KXFM30YMTG`, `KXEHSALES`, state permits; Poly `median-home-price-austin`) | Realtors, movers, trades; weekly mortgage market is liquid ($124k) | peril `rates`/`housing`. **S** |
| 9 | **Travel/tourism** (`KXTSAD`, `KXTSAW`, `KXFLVISITORCOUNT`, `KXNVVISIT`, `KXHIVISITORS`, `KXORLHOTELDEMAND`) | Tourist-town businesses; TSA daily/weekly fits short windows | peril `travel`; TSA brackets are passenger counts. **S** |
| 10 | **More game leagues** on Kalshi (`KXNHLGAME`, `KXNCAAMBGAME`, `KXNCAAWBGAME`, `KXAHLGAME`, `KXUSLGAME`, `KXNWSLGAME`; MLB/WNBA in season) + widen `TEAMS` beyond Texas | Sports bars anywhere; Kalshi NCAAMB alone has 166 open games | `SeriesSpec` rows (`league`); extend `TEAMS` table/regex. **XS–S** |
| 11 | **Policy one-offs** (`KXGOVTSHUTDOWN`, `KXGOVTSHUTLENGTH`, `KXTARIFFRATE*`, `KXMINWAGE*`, `KXMJSCHEDULE`, `KXTXMARIJUANA`) | Distinctive "AI found a hedge you didn't know existed" demo moments | curated allow-list + peril `policy`; mostly YES/NO binaries or date ladders. **S** |
| 12 | **Gemini commodities relabel** (`NGAS`→natgas, `XAU`/`XAG`→jewelers, `COPPER`→trades) + Kalshi `KXALMWP`, `KXPAPER` | Already fetched from Gemini as `other`; just needs peril/labels so the advisor can match | label mapping in `normalizeGeminiEvents`. **XS** |
| 13 | **Consumer-spend proxies** (Carbon Arc `KX*CC`, `KX*FT`, `KX*POS`, `KXCOFFEEARRAY`, `KXHOLIDAYRETAIL`) | Clever sector hedges, but thin volume (mostly < $10k) and monthly one-offs | needs a brand→sector map (~150 series). **M** |
| 14 | **Hurricanes** (`KXHURPATH*`, `KXHURCITY*`, `KXHURCOASTTEX`, counts) | Huge for Gulf businesses but season is over; most landfall series are dormant until 2027 | peril `hurricane`, location from title/state. **S** (park until spring) |
| 15 | **Jobs** (`KXJOBLESSCLAIMS`, `KXU3`, Gemini `UNEMP*`) | Macro demand proxy; Gemini has it (ties to #1) | peril `jobs`. **XS** after #1 |

Not worth it for Hedgehog: elections (except as regulatory proxies), Mentions, awards, crypto 5-minute/15-minute markets, intl sports props, company IPO/CEO markets.

## 7. Caveats

- Volume is the lifetime traded volume summed over **currently listed** events. On Gemini it also includes the recently settled events the script pulled. It indicates liquidity, not a depth guarantee. Use `getBook` / `depthYes` before quoting.
- Many Kalshi state/sector series (NY Fed "Economic Data", Carbon Arc, Fiscal.ai) are annual one-offs with thin books ($1k-$50k). Weather city series often have $1k-$10k per day.
- "Dormant" means the series exists but has no open event right now. Examples: `KXAQICITY`, most hurricane landfall series, `KXEGGPRICEW`, `KXUSGBEEF`, MLB/WNBA games, international temperature series. Dormant high-relevance series appear only inside the theme rollups (`memberSeries`).
- Theme assignment is regex-based (`THEMES` in `scripts/catalog-markets.ts`, first match wins) and has been spot-checked. A few misfiles remain in low-volume rollups, for example political "tsunami" combos. Fix them by editing `THEMES` and re-running. No network is needed when the cache is warm.
- The Gemini unfiltered events listing caps at about 1,000 events, so the script pages each category. Settled history per category is capped at the newest 1,000.
- Polymarket offset paging caps at about 2,000 events, so the script uses `/events/keyset` with `after_cursor`.

## Appendix A. Representative live types per theme (top 2 by volume per venue)

| Theme | Venue · series | Example event (what settles) | Freq | Live ev | Vol | Median YES | Indexed |
|---|---|---|---|---:|---:|---:|---|
| sports_game_us | gemini · `NCAAF-games-moneyline` | Wake Forest vs Georgia Tech | hourly | 65 | $2.6M | 0.52 | yes |
| sports_game_us | gemini · `NFL-games-moneyline` | Cincinnati vs Washington | daily | 13 | $2.4M | 0.57 | yes |
| sports_game_us | kalshi · `KXNFLGAME` | Carolina vs Tampa Bay | custom | 29 | $5.0M | 0.57 | yes |
| sports_game_us | kalshi · `KXNCAAFGAME` | Sacramento St. vs Hawai'i | custom | 186 | $3.4M | 0.56 | yes |
| sports_game_us | polymarket · `nba-2026` | NBA 2026 | daily | 111 | $19.3M | 0.41 | read-only |
| sports_game_us | polymarket · `cfb-2026` | CFB 2026 | daily | 207 | $8.1M | 0.5 | no |
| ski_season | kalshi · `KXASPENMTNOPEN` | When will Aspen Mountain open for the 26/27 winter season? | annual | 1 | $510k |  | no |
| ski_season | kalshi · `KXBIGSKYOPEN` | When will Big Sky open for the 26/27 winter season? | annual | 1 | $409k |  | no |
| snow_city | kalshi · `KXPHILSNOWM` | Snow in Philadelphia in Dec 2026? | monthly | 1 | $80k | 0.31 | no |
| snow_city | kalshi · `KXSEASNOWM` | Snow in Seattle in Dec 2026? | monthly | 1 | $28k | 0.12 | no |
| snow_city | polymarket · `theme:snow_city:Weather` | First snow of the 2026 season / Which cities will get more snow than ave | one_off (mixed) | 2 | $75k | 0.33 | no |
| hurricane | kalshi · `KXHURRICANENAMES` | What named storms will be hurricanes in the Eastern Pacific this year? | custom | 3 | $407k | 0.25 | no |
| hurricane | kalshi · `KXHURCTOTMAJ` | How many major Atlantic hurricanes will there be in 2026? | annual | 1 | $252k | 0.05 | no |
| hurricane | polymarket · `theme:hurricane:Weather` | Will any Category 4 hurricane make landfall in the US in before 2027? /  | one_off (mixed) | 9 | $954k | 0.05 | no |
| temp_high_daily | gemini · `WXHIGH` | Highest temperature in Ankara on November 19, 2026? | daily | 66 | $20k | 0.18 | yes |
| temp_high_daily | kalshi · `KXHIGHLAX` | Highest temperature in Los Angeles on Nov 19, 2026? | daily | 2 | $143k | 0.4 | yes |
| temp_high_daily | kalshi · `KXHIGHTSEA` | Highest temperature in Seattle on Nov 19, 2026? | daily | 2 | $28k | 0.5 | no |
| temp_high_daily | polymarket · `hong-kong-daily-weather` | Hong Kong Daily Weather | daily | 3 | $90k | 0.21 | read-only |
| temp_high_daily | polymarket · `shenzhen-daily-weather` | Shenzhen Daily Weather | daily | 3 | $49k | 0.07 | read-only |
| temp_low_daily | kalshi · `KXLOWTSAN` | Lowest temperature in San Diego on Nov 19, 2026? | daily | 2 | $12k | 0.17 | no |
| temp_low_daily | kalshi · `KXLOWTSEA` | Lowest temperature in Seattle on Nov 19, 2026? | daily | 2 | $9k | 0.21 | no |
| temp_low_daily | polymarket · `hong-kong-daily-lowest-tem` | Hong Kong Daily Lowest Temperature | daily | 3 | $15k | 0.09 | read-only |
| temp_low_daily | polymarket · `seoul-daily-lowest-tempera` | Seoul Daily Lowest Temperature | daily | 3 | $10k | 0.04 | read-only |
| temp_period | kalshi · `KXHMONTH` | This Nov 2026 is the hottest November ever? | monthly | 1 | $81k | 0.95 | no |
| temp_period | kalshi · `KXHDDCVG` | Cincinnati cumulative Heating Degree Days (Oct 1 - Dec 31, 2026) | custom | 1 | $24k | 0.5 | no |
| temp_period | polymarket · `temperature-increase` | Temperature Increase | monthly | 1 | $21k |  | no |
| rain_period | kalshi · `KXRAINLAXM` | Rain in Los Angeles in Nov 2026? | custom | 1 | $61k | 0.06 | no |
| rain_period | kalshi · `KXRAINPHXM` | Rain in Phoenix in Nov 2026? | monthly | 1 | $60k | 0.05 | no |
| rain_period | polymarket · `monthly-precipitation` | Monthly Precipitation | monthly | 5 | $28k | 0.13 | no |
| rain_daily | kalshi · `KXRAIN` | Where will it rain on Nov 19, 2026? | daily | 1 | $92k | 0.75 | yes |
| rain_daily | kalshi · `KXRAINWKND` | Where will it rain this weekend (Nov 21 - Nov 22)? | weekly | 1 | $59k | 0.75 | yes |
| rain_daily | polymarket · `rain-daily` | Where Will It Rain Today? | daily | 2 | $3k | 0.46 | no |
| severe_storm | kalshi · `KXTORNADO` | Number of tornadoes in Nov 2026? | monthly | 1 | $13k | 0.14 | no |
| severe_storm | polymarket · `theme:severe_storm:Weather` | Natural Disaster in 2026? / How many Tornadoes in the US in 2026? | one_off (mixed) | 2 | $343k | 0.06 | no |
| severe_storm | polymarket · `monthly-tornadoes-us` | Monthly Tornadoes US | monthly | 1 | $2k | 0.49 | no |
| quake_volcano | kalshi · `KXEARTHQUAKECALIFORNIA` | Will there be an at least 8.0 magnitude earthquake in California before  | custom | 3 | $648k | 0.21 | no |
| quake_volcano | kalshi · `KXEARTHQUAKEJAPAN` | 8.0 magnitude earthquake in Japan before 2030? | custom | 1 | $46k | 0.33 | no |
| quake_volcano | polymarket · `theme:quake_volcano:Weathe` | How many large volcano eruptions (VEI ≥4) in 2026? / 10.0 or above earth | one_off (mixed) | 10 | $2.6M | 0.13 | no |
| quake_volcano | polymarket · `how-many-7pt0-or-above-ear` | How many 7.0 or above earthquakes | annual | 1 | $1.6M |  | no |
| water_drought | kalshi · `KXIDGROUNDWATER` | How many Idaho groundwater rights will be curtailed in 2027? | one_off | 1 | $65k | 0.87 | no |
| water_drought | kalshi · `KXMEAD` | Lake Mead end-of-month water elevation in Dec 2026? | monthly | 1 | $32k | 0.93 | no |
| water_drought | polymarket · `theme:water_drought:Weathe` | Lowest Mississippi level at St. Louis by November 30? / How low will Lak | one_off (mixed) | 5 | $351k | 0.26 | no |
| natural_gas | gemini · `NGAS` | Natural Gas price on November 19? | daily | 3 | $80k | 0.35 | partial |
| natural_gas | kalshi · `KXNATGASW` | Natural gas price on Nov 20, 2026 at 5:00 PM EST? | weekly | 1 | $89k | 0.18 | no |
| natural_gas | kalshi · `KXNGASMAX` | Highest natural gas spot price in​ 2026 | annual | 1 | $79k | 0.4 | no |
| natural_gas | polymarket · `natural-gas-daily-up-or-do` | NATURAL GAS Daily Up or Down | daily | 3 | $3k | 0.28 | no |
| natural_gas | polymarket · `natural-gas-hit-price-week` | Natural Gas Hit Price Weekly | weekly | 1 | $1k | 0.23 | no |
| gasoline | gemini · `GASMARCH` | US gas prices this month? | one_off | 0 | $0k |  | no |
| gasoline | gemini · `GASFEB` | US gas prices this month? | one_off | 0 | $0k |  | no |
| gasoline | kalshi · `KXAAAGASMAX` | How high will US gas prices get in 2026? | annual | 1 | $2.1M | 0.03 | no |
| gasoline | kalshi · `KXAAAGASM` | Gas prices in the US in Nov 2026? | monthly | 1 | $1.8M | 0.46 | yes |
| gasoline | polymarket · `gas-price-hits` | US Gas Hit Price Monthly | monthly | 1 | $92k |  | read-only |
| gasoline | polymarket · `theme:gasoline:Crypto` | What will the average monthly Ethereum gas price hit before 2027? | one_off (mixed) | 1 | $20k | 0.3 | no |
| diesel | kalshi · `KXDIESELMON` | Diesel prices in Nov 2026 | monthly | 1 | $259k | 0.2 | no |
| diesel | kalshi · `KXDIESELMAXY` | How high will US diesel prices get in 2026? | annual | 1 | $237k | 0.08 | no |
| diesel | polymarket · `theme:diesel:Geopolitics` | US imports Russian diesel by...? / EU lifts ban on Russian diesel import | one_off (mixed) | 2 | $1.8M | 0.05 | read-only |
| diesel | polymarket · `theme:diesel:Politics` | US Announces Diesel Export ban by...? | one_off (mixed) | 1 | $530k | 0.03 | no |
| electricity | kalshi · `KXTXERCOTPEAK` | How high will peak electricity demand on the Texas ERCOT grid get in 202 | one_off | 1 | $1.1M | 0.03 | no |
| electricity | kalshi · `KXILNUCLEAR` | Illinois nuclear electricity generation in 2026 | annual | 1 | $344k | 0.89 | no |
| electricity | polymarket · `theme:electricity:Geopolit` | Canada cuts off or throttles electricity to the US by December 31? | one_off (mixed) | 1 | $8k | 0.03 | no |
| crude_oil | gemini · `HORMUZNORMAL` | When will traffic at the Strait of Hormuz return to normal? | one_off | 1 | $196k | 0.05 | no |
| crude_oil | gemini · `BRENT` | Oil (Brent) price on November 19? | daily | 3 | $145k | 0.11 | yes |
| crude_oil | kalshi · `KXHORMUZNORM` | When will traffic at the Strait of Hormuz return to normal? | one_off | 1 | $15.6M | 0.29 | no |
| crude_oil | kalshi · `KXWTIMAX` | How high will oil (WTI) get by Dec 31, 2026? | annual | 2 | $10.6M | 0.05 | no |
| crude_oil | polymarket · `theme:crude_oil:Geopolitic` | Kharg Island no longer under Iranian control by...? / Farsi, Hengam, Hor | one_off (mixed) | 5 | $78.3M | 0.14 | read-only |
| crude_oil | polymarket · `hormuz-traffic-returns-to-` | Hormuz Traffic Returns to Normal | periodic | 3 | $20.3M | 0.2 | read-only |
| food_prices | kalshi · `KXCOSTCOHOTDOG` | Costco raises hot dog combo price? | custom | 1 | $81k | 0.27 | no |
| food_prices | kalshi · `KXFAOFPI` | FAO Food Price Index for November | monthly | 1 | $26k | 0.23 | no |
| food_prices | polymarket · `theme:food_prices:Economy` | Will ground beef hit __ in 2026? / Costco increases hotdog price before  | one_off (mixed) | 2 | $36k | 0.14 | read-only |
| food_prices | polymarket · `egg-prices-monthly` | Egg Prices Monthly | monthly | 1 | $11k | 0.05 | read-only |
| ag_production | kalshi · `KXSDCORNYIELD` | South Dakota corn yield in 2026 | annual | 1 | $550k | 0.37 | no |
| ag_production | kalshi · `KXSCREWWORMCOUNT` | How many human screwworm cases will be reported in the United States in  | custom | 1 | $260k | 0.07 | no |
| metals_materials | gemini · `COPPER` | Copper price on November 19? | daily | 3 | $152k | 0.13 | partial |
| metals_materials | gemini · `XAG` | Silver price on November 19? | daily | 3 | $115k | 0.48 | partial |
| metals_materials | kalshi · `KXGOLDDIRY` | Gold price at year end? | annual | 1 | $514k | 0.1 | no |
| metals_materials | kalshi · `KXBTCVSGOLD` | Will Bitcoin outperform gold in 2026? | custom | 1 | $353k | 0.13 | no |
| metals_materials | polymarket · `what-will-gold-gc-hit` | What will Gold (GC) hit__ | monthly | 1 | $3.0M | 0.38 | no |
| metals_materials | polymarket · `theme:metals_materials:Cry` | Bitcoin vs. Gold vs. S&P 500 in 2026 / Will Bitcoin outperform Gold in 2 | one_off (mixed) | 2 | $1.5M | 0.14 | no |
| freight_trade_flows | kalshi · `KXCANAL` | Will Trump take back the Panama Canal? | custom | 1 | $629k | 0.09 | no |
| freight_trade_flows | kalshi · `KXNYNJPORTTEU` | Port of New York and New Jersey container volume in 2026 | annual | 1 | $337k | 0.93 | no |
| freight_trade_flows | polymarket · `theme:freight_trade_flows:` | US takes Panama Canal before 2027? / Panama Canal effectively closed by. | one_off (mixed) | 2 | $190k | 0.03 | read-only |
| freight_trade_flows | polymarket · `houthis-target-shipping` | Houthis target shipping | one_off | 1 | $162k |  | read-only |
| tariffs_trade | kalshi · `KXTARIFFCHECKS` | Will Americans receive tariff stimulus checks? | one_off | 1 | $1.7M | 0.02 | no |
| tariffs_trade | kalshi · `KXTRADEDEALCUBA` | Will Trump announce a trade deal with Cuba? | one_off | 1 | $76k | 0.08 | no |
| tariffs_trade | polymarket · `trump-trade-deal-countries` | Trump Trade Deal Countries | annual | 1 | $418k | 0.06 | no |
| tariffs_trade | polymarket · `theme:tariffs_trade:Politi` | US-Canada diplomatic agreement to lower tariffs by...? / U.S. tariff rat | one_off (mixed) | 3 | $355k | 0.42 | no |
| min_wage_labor | kalshi · `KXCOWAGE` | Colombia minimum wage growth minus inflation in 2027 | annual | 1 | $124k | 0.21 | no |
| min_wage_labor | kalshi · `KXNYCMINWAGE` | Will Mamdani raise the minimum wage to $30 before 2027? | one_off | 1 | $26k | 0.05 | no |
| min_wage_labor | polymarket · `theme:min_wage_labor:Polit` | Will Mamdani raise the minimum wage to $30 before 2027? | one_off (mixed) | 1 | $27k | 0.04 | no |
| shutdown_fiscal | gemini · `GOVSHUTDOWN` | Will there be another US government shutdown by January 31? | one_off | 0 | $153k |  | no |
| shutdown_fiscal | gemini · `DHSFUND` | When will DHS be funded again? | one_off | 0 | $1k |  | no |
| shutdown_fiscal | kalshi · `KXGOVTCUTS` | How much government spending will Trump cut before his term ends? | custom | 2 | $399k | 0.06 | no |
| shutdown_fiscal | kalshi · `KXGOVTSHUTDOWN` | Government shutdown on Dec 12, 2026? | one_off | 1 | $392k | 0.34 | no |
| shutdown_fiscal | polymarket · `theme:shutdown_fiscal:Poli` | Government shutdown by...? / How many government shutdowns by December 3 | one_off (mixed) | 2 | $134k | 0.35 | no |
| cannabis | kalshi · `KXMJSCHEDULE` | Will marijuana be rescheduled? | custom | 1 | $1.1M | 0.71 | no |
| cannabis | kalshi · `KXTHCLEGALSALE3MG` | Will 3 mg THC beverages be federally legal to sell? | one_off | 1 | $80k | 0.65 | no |
| cannabis | polymarket · `weed-rescheduling` | Weed Rescheduling | one_off | 1 | $834k |  | no |
| cannabis | polymarket · `theme:cannabis:Politics` | Seltzers with 5mg THC legal on…? | one_off (mixed) | 1 | $5k | 0.49 | no |
| tax_policy | kalshi · `KXACAEXT` | Will the ACA premium tax credits be extended? | one_off | 1 | $298k | 0.33 | no |
| tax_policy | kalshi · `KXCAWEALTHTAXMOVD` | California Proposition 40 election margin of victory? (No) | one_off | 1 | $171k | 0.95 | no |
| tax_policy | polymarket · `theme:tax_policy:Crypto` | Trump eliminates capital gains tax on crypto by ___? | one_off (mixed) | 1 | $120k |  | no |
| tax_policy | polymarket · `theme:tax_policy:Politics` | Will Mamdani pass the 2% Millionaire Tax before 2027? / Brazil's top cou | one_off (mixed) | 3 | $116k | 0.12 | read-only |
| regulation_local | kalshi · `KXNYCASKRENT` | NYC median asking rent in December 2026 | one_off | 1 | $427k | 0.12 | no |
| regulation_local | kalshi · `KXTRDBAN` | Will members of Congress be banned from trading stocks? | custom | 1 | $186k | 0.46 | no |
| regulation_local | polymarket · `indiana-enacts-data-center` | Indiana enacts data center moratorium | one_off | 1 | $6.4M | 0.2 | no |
| regulation_local | polymarket · `louisiana-enacts-data-cent` | Louisiana enacts data center moratorium | one_off | 1 | $925k | 0.13 | no |
| immigration | kalshi · `KXH1B` | Will Trump expand the H-1B program? | custom | 1 | $124k | 0.25 | no |
| immigration | kalshi · `KXICEREFORM` | Which ICE reforms will become law in 2026? | one_off | 1 | $59k | 0.08 | no |
| immigration | polymarket · `theme:immigration:Politics` | Trump renames ICE to NICE by...? / Will Ilhan Omar be deported by...? /  | one_off (mixed) | 4 | $411k | 0.14 | no |
| immigration | polymarket · `deportation-count` | Deportation Count | annual | 1 | $136k | 0.09 | no |
| mortgage_rates | kalshi · `KXUST30YRRATE27` | 30Y US Treasury yield on Dec 31, 2027? | one_off | 1 | $248k | 0.35 | no |
| mortgage_rates | kalshi · `KXUST10YRRATE27` | 10Y US Treasury yield on Dec 31, 2027? | one_off | 1 | $227k | 0.69 | no |
| mortgage_rates | polymarket · `how-high-10-year-treasury` | How high 10-year Treasury | monthly | 2 | $1.2M |  | no |
| mortgage_rates | polymarket · `how-low-10-year-treasury` | How low 10-year Treasury | monthly | 2 | $557k | 0.03 | no |
| fed_rates | gemini · `FED` | Fed decision in December? | periodic | 1 | $1.4M | 0.09 | no |
| fed_rates | gemini · `FEDJAN` | Fed decision in January? | one_off | 0 | $639k |  | no |
| fed_rates | kalshi · `KXFEDDECISION` | Fed decision in Jan 2028? | custom | 10 | $18.4M | 0.1 | yes |
| fed_rates | kalshi · `KXRATECUTCOUNT` | Number of rate cuts in 2026? | annual | 1 | $11.7M |  | no |
| fed_rates | polymarket · `theme:fed_rates:Economy` | How many Fed rate cuts in 2026? / Fed rate cut by...? / What will Fed Ra | one_off (mixed) | 7 | $62.0M | 0.69 | read-only |
| fed_rates | polymarket · `fomc` | FOMC | monthly | 4 | $45.2M | 0.07 | read-only |
| housing | kalshi · `KXVTPERMITS` | Housing units authorized in Vermont in 2026 | annual | 1 | $216k | 0.1 | no |
| housing | kalshi · `KXCOBUILDPERMITS` | Colorado permitted housing units in 2026 | annual | 1 | $171k | 0.23 | no |
| housing | polymarket · `median-home-price-us` | Median Home Price US | monthly | 1 | $76k | 0.34 | no |
| housing | polymarket · `median-home-price-nyc` | Median Home Price NYC | monthly | 1 | $70k | 0.23 | no |
| travel_tourism | kalshi · `KXFLVISITORCOUNT` | Visitors to Florida in 2026 | annual | 1 | $394k | 0.65 | no |
| travel_tourism | kalshi · `KXNERIVISITS` | New River Gorge recreation visits in 2026 | one_off | 1 | $234k | 0.05 | no |
| travel_tourism | polymarket · `theme:travel_tourism:Geopo` | Will any aircraft land or take off at Kyiv Boryspil Airport by...? | one_off (mixed) | 1 | $62k | 0.07 | no |
| travel_tourism | polymarket · `military-action-against-ki` | Military action against King Khalid International Airport (RUH) | one_off | 1 | $36k | 0.51 | no |
| consumer_spend | kalshi · `KXPEPSIPOS` | Pepsi Point of Sale Growth in November 2026 | one_off | 1 | $137k | 0.61 | no |
| consumer_spend | kalshi · `KXNICOTINEARRAY` | Nicotine product point of sale spend array index in November 2026 | monthly | 1 | $134k | 0.7 | no |
| consumer_spend | polymarket · `university-of-michigan-con` | University of Michigan Consumer Sentiment | monthly | 1 | $59k |  | no |
| jobs_labor | gemini · `UNEMP` | How high will unemployment get in 2026? | one_off | 1 | $22k | 0.03 | no |
| jobs_labor | gemini · `UNEMPFEB` | Unemployment rate in February? | one_off | 0 | $0k |  | no |
| jobs_labor | kalshi · `KXU3MAX` | How high will unemployment get before 2030? | annual | 2 | $859k | 0.12 | no |
| jobs_labor | kalshi · `KXWAAEROEMP` | Washington aerospace manufacturing employment average in 2026 | annual | 1 | $838k | 0.03 | no |
| jobs_labor | polymarket · `theme:jobs_labor:Economy` | How high will US unemployment go in 2026? / Will Canada have the highest | one_off (mixed) | 2 | $612k | 0.11 | no |
| jobs_labor | polymarket · `theme:jobs_labor:Business` | Tech Layoffs Up or Down in 20​26? | one_off (mixed) | 1 | $26k | 0.97 | no |
| gdp_recession | gemini · `RECESSION` | Recession this year? | one_off | 1 | $121k | 0.04 | no |
| gdp_recession | gemini · `Q` | Will the US GDP growth in Q4 2025 be above 2.5%? | one_off | 0 | $57k |  | no |
| gdp_recession | kalshi · `KXRECSSNBER` | Recession in 2027? | annual | 2 | $5.3M | 0.22 | no |
| gdp_recession | kalshi · `KXGDPYEAR` | US real GDP growth in 2036? | custom | 11 | $1.2M | 0.12 | no |
| gdp_recession | polymarket · `us-recession-by` | US recession by | annual | 2 | $2.5M | 0.32 | no |
| gdp_recession | polymarket · `theme:gdp_recession:Econom` | China Annual GDP Growth 2026 / UK Annual GDP Growth 2026 / 2026 World GD | one_off (mixed) | 7 | $1.3M | 0.15 | no |
| cpi_inflation | gemini · `CPI` | CPI year-over-year in February? | monthly | 0 | $50k |  | no |
| cpi_inflation | kalshi · `KXCPIYOY` | CPI YoY in December | monthly | 2 | $2.0M | 0.13 | yes |
| cpi_inflation | kalshi · `KXCPI` | CPI in December | monthly | 2 | $809k | 0.13 | yes |
| cpi_inflation | polymarket · `theme:cpi_inflation:Econom` | How high will inflation get in 2026? / Brazil Annual Inflation 2026 / Ch | one_off (mixed) | 10 | $2.8M | 0.09 | read-only |
| cpi_inflation | polymarket · `us-annual-inflation` | US Annual Inflation  | monthly | 2 | $254k | 0.06 | read-only |
| fx | kalshi · `KXUSDBRLMAX` | USD/BRL high in 20​26 | annual | 1 | $578k | 0.22 | no |
| fx | kalshi · `KXUSDX` | How high will DXY get in 2026? | annual | 1 | $77k | 0.75 | no |
| fx | polymarket · `theme:fx:Finance` | Will USD/KRW hit __ in 2026? / Will USD/JPY hit __ in 2026? / Will USD/C | one_off (mixed) | 5 | $247k | 0.06 | no |
| fx | polymarket · `argentina-official-usd-exc` | Argentina Official USD Exchange Rate | monthly | 2 | $40k | 0.13 | no |
| health_outbreak | kalshi · `KXNEWOUTBREAKHANTA` | Will WHO declare Hantavirus a Public Health Emergency of International C | one_off | 1 | $2.1M |  | no |
| health_outbreak | kalshi · `KXMEASLES` | Measles cases in 2027? | annual | 2 | $1.3M | 0.79 | no |
| health_outbreak | polymarket · `theme:health_outbreak:Weat` | Hantavirus pandemic in 2026? / Ebola pandemic in 2026? / Hantavirus vacc | one_off (mixed) | 5 | $20.3M | 0.32 | no |
| health_outbreak | polymarket · `measles` | measles | monthly | 2 | $8.4M |  | no |
| gpu_ai_costs | gemini · `GPU` | A100 SXM4 GPU Compute Index | daily | 0 | $0k |  | no |
| gpu_ai_costs | gemini · `TOKEN` | anthropic AI Token Price Index | daily | 0 | $0k |  | no |
| gpu_ai_costs | kalshi · `KXRTX5090MS` | NVIDIA RTX 5090 · Average hourly price in August 2027 | monthly | 10 | $255k | 0.25 | no |
| gpu_ai_costs | kalshi · `KXB200MS` | NVIDIA B200 · Average hourly price in August 2027 | monthly | 10 | $178k | 0.86 | no |
| gpu_ai_costs | polymarket · `b200-rental-price` | B200 Rental Price | monthly | 3 | $177k | 0.06 | no |
| gpu_ai_costs | polymarket · `h100-rental-price` | H100 Rental Price | monthly | 3 | $137k | 0.04 | no |
| box_office_media | gemini · `AVENGERSDOOMSDAYRT` | Avengers Doomsday: Rotten Tomatoes Score | one_off | 1 | $10k | 0.81 | no |
| box_office_media | gemini · `SPOTTOPMAR` | Artist with the most monthly Spotify listeners at the end of March? | one_off | 0 | $9k |  | no |
| box_office_media | kalshi · `KXRT` | Werwulf · Rotten Tomatoes score | custom | 12 | $8.1M | 0.51 | no |
| box_office_media | kalshi · `KXTOPARTISTUSA` | Top Artist on Spotify U.S. 2026 | one_off | 1 | $2.4M | 0.05 | no |
| box_office_media | polymarket · `highest-grossing-movie` | Highest Grossing Movie | annual | 1 | $18.8M |  | no |
| box_office_media | polymarket · `theme:box_office_media:Cul` | Top Spotify Artist 2026 / Top Spotify Song 2026 / Billboard #1 Artist 20 | one_off (mixed) | 13 | $3.9M | 0.15 | no |
| live_events | gemini · `SOTUATT` | State of the Union Attendance | one_off | 0 | $8k |  | no |
| live_events | kalshi · `KXROLEATEVENTCOACHELLA` | Who will headline Coachella 2027? | one_off | 1 | $694k | 0.25 | no |
| live_events | kalshi · `KXHEADLINE` | Stagecoach 2027: Headliner(s) | one_off | 4 | $499k | 0.15 | no |
| live_events | polymarket · `theme:live_events:Culture` | Who will be in the 2027 Big Game halftime show? / What songs will be pla | one_off (mixed) | 7 | $307k | 0.32 | read-only |

