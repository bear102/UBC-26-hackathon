# UBC 2026 Hackathon: rules, prizes, verified tech facts

University Blockchain Conference (UBC) 2026 Hackathon, run by College.xyz; presented by Solana, Circle, Gemini. Submit on Devpost: ubc-hackathon-2026.devpost.com. Prize pool $22k+.

**Dates (CST):** start Thu 2026-11-12 6 PM; **deadline Fri 2026-11-20 12:00 PM**; finalists notified Fri 11:59 PM; in-person judging + finals Sat 2026-11-21 at UT Austin closing ceremony (must be present to win anything). Office hours Nov 16-19 6-7 PM on Google Meet (Gemini: Tue 17 + Thu 19; QuickNode: Wed 18; Circle: Mon/Wed; Solana: Mon-Thu).

**Layer cake (all stack except Solana vs Arc):**
1. Main track, pick exactly 1, each $2,000 winner:
   - Agentic Payments & AI: agents hold/send/receive stablecoins, pay per request (x402, Circle Agent Wallets/Nanopayments, Solana Agent Kit), spending controls (budgets, allowlists, human approval). Must transact on or read a chain; README documents decision loop + safety limits.
   - DeFi & Onchain Apps: primitives (exchanges, lending, yield, derivatives, payment rails), compose with existing protocols, CCTP cross-chain. Must interact with contracts; README explains economic design + risk assumptions; list contract/program addresses.
   - Consumer Apps: crypto invisible (no gas/seed phrases/bridging), daily-use, strong UX. Must touch chain + working user-facing frontend.
2. Chain award, optional, one only, judged only among opt-ins within your track: Best use of Solana $1,500/track (devnet ok, Anchor/SPL/Token Ext/Solana Pay, program IDs + README) or Best use of Arc $1,000/track (Circle EVM L1, USDC gas, testnet ok, Foundry/Hardhat, Circle Wallets/CCTP/Gateway/Paymaster, contract addrs + README).
3. Bounties, any number (opt in on Devpost): Gemini Prediction Markets $2,500/$1,000/$500 (use PM API data and/or trading; 1st place gets a finals slot); QuickNode Streams $500 single winner (Stream w/ filter + destination as core data source; README: network, dataset, filter, destination, why); ElevenLabs = 3 mo Scale/member (voice core, demo video with audio, README lists products); Grok Bot = keyboard/member (central, chat export, 3-4 sentence README).
4. Official UBC Winner, automatic: $2,500 (+ElevenLabs Pro) / $1,000 / $500.
Participation perks for any complete working submission.

**Finals:** up to 13 teams: per track the top contender for Track, Solana, Arc (9), top 3 Official contenders, Gemini 1st. 5 min pitch + 2 min Q&A. Judging criteria (no weights): Technical Execution, Product & UX, Innovation, Impact & Potential, Demo.

**Submit:** name, description, members; track + chain award + bounties; written answers (what built, problem, how it works, unique, next); tech used; public GitHub repo made during event with setup instructions; working demo/deployment; 2-3 min video (YouTube/Drive); README with architecture; track/bounty-specific items. AI tools explicitly allowed.

Strategy chosen: docs/STRATEGY.md. Verified API/infra facts: below.


## Verified tech facts (2026-11-18)
- **Gemini PM public API (no key):** GET https://api.gemini.com/v1/prediction-markets/events?status=active&limit=100&offset=N. ~200 active events: mostly Sports, ~44 Crypto, ~10 Weather (ATL AUS BOS CHI DCA DEN DFW HOU NYC SEA daily highs), ~5 Commodities. Contract fields: instrumentSymbol (GEMI-...), strike {type above|below|reference|over|spread, value}, prices {bestBid, bestAsk, buy/sell yes/no, lastTradePrice}, expiryDate. Weather bins are labels like "50°F to 51°F". Markets are thin (volume often single digits). Also /events/recently-settled, /events/{ticker}; contract outcome field is `resolutionSide`. Exchange candles: /v2/candles/{btcusd,ethusd,solusd,xrpusd,zecusd,hypeusd}/1hr; ticker /v1/pubticker/{sym}.
- **Gemini private REST:** headers X-GEMINI-APIKEY, X-GEMINI-PAYLOAD (base64 JSON with request path + nonce + params), X-GEMINI-SIGNATURE = hex HMAC-SHA384(secret, base64 payload), empty body. POST /v1/prediction-markets/order {symbol, orderType:"limit", side:"buy", outcome:"yes"|"no", price, quantity, timeInForce}. Terms: GET /terms/status, POST /terms/accept. Positions: POST /v1/prediction-markets/positions. Sandbox: https://api.sandbox.gemini.com (separate account at exchange.sandbox.gemini.com).
- **Solana devnet:** RPC works; RPC airdrop is CLOSED (410), so test SOL must be claimed manually at faucet.solana.com. Circle devnet USDC mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (faucet.circle.com).
- **Arc testnet:** RPC https://rpc.testnet.arc.network, chainId 5042002 (0x4cef52), live. USDC is gas; faucet.circle.com.
- **NWS:** api.weather.gov works without key (needs User-Agent); /points/{lat},{lon} -> forecastHourly; /stations/{KAUS etc}/observations.
- **Devpost** gallery/participants require login (403/blank); competition counts unknown.
- **Links:** Telegram https://t.me/+Q0hy2P7nbIk2YWIx; office hours https://meet.google.com/gtd-zuwv-iuu; organizer email admin@college.xyz; ElevenLabs perk via Discord #coupon-codes.
- **Local tooling:** node 25, python 3.12, git; no solana CLI, anchor, rust, foundry, gh, vercel CLI installed. No API keys in env.
