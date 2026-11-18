# Team strategy (decided 2026-11-18)

Three projects were specced; two ship. Final strategist decision below (Hedgehog = user, Spendthrift = friend, Shed = contingency).

DECISION: Submit Hedgehog (user) + Spendthrift (friend). Shelve Shed; it becomes the fallback only.

RANKING (risk-adjusted expected winnings; rough estimates from field size, prize pools and execution risk):
1. Hedgehog, about $1.7K. It has the only credible shot at the Gemini PM bounty ($2.5K/$1K/$500, small field, and 1st place gets a finals slot). It also enters the Consumer track, which is less crowded than Agentic, plus the Consumer-pool Solana award. Main risk: the Gemini retail account can't trade prediction markets through the API (gate G1). Odds it executes: about 0.75.
2. Spendthrift, about $550. It enters Agentic (the most crowded track) plus the Agentic-pool Solana award, and QuickNode Streams ($500, single winner) if gate G3 passes. It fits the conference's "Agentic Commerce" and "AI Accountability" sessions. It is software-only, so the risk is controllable. Odds it executes: about 0.7.
3. Shed, about $400. It has the highest raw average (8.49), but it targets the same Agentic + Solana pool as Spendthrift, needs hardware not yet in hand (gate G0, smart plug and host), needs a foam prop, has a meter that falls back to "SIMULATED", and nothing is installed on the build box yet. Odds it executes: about 0.55. It has no bounty upside.

PAIR AND ENTRIES (no prize collisions):
- Hedgehog: track Consumer Apps (keep it; DeFi only as the fallback track); chain award Best use of Solana (Consumer pool); bounty Gemini Prediction Markets; also eligible for Official UBC Winner. Not targeted: QuickNode, ElevenLabs, Grok, Arc.
- Spendthrift: track Agentic Payments & AI; chain award Best use of Solana (Agentic pool); bounty QuickNode Streams, only if G3 passes; also eligible for Official UBC Winner. No Gemini PM: Hedgehog owns that bounty, and two entries in it would compete and blur.
- Keep the two distinct: in Hedgehog's pitch and README, call `/w` the "receipt wallet" or "refund wallet", never "money-back wallet". That name belongs to Spendthrift.

THE THIRD PROJECT (Shed): drop it from the build. Nothing from it merges cleanly. Its escrow and spending-cap pattern is already in Spendthrift, and grid computing doesn't fit Hedgehog's local-business pitch. Buy no hardware and build no prop. Keep /root/blockchainHackathon26/ideas/build/Shed.md as the contingency: if Hedgehog fails G1 (no real Gemini production fill by H4, about Wed 5 PM CST), the pair becomes Spendthrift (Agentic + Solana + QuickNode) + Shed. In that case Shed moves to the DeFi & Onchain track (its fixed-price lease with a buy-back is the new primitive) and opts into Best use of Solana in the DeFi pool. That only works if G0 hardware is resolved by Thursday morning, otherwise its meter runs as the labelled simulation.

DECISIONS ON THE OPEN QUESTIONS:
- Scope: 3 specs, 2 ship (Hedgehog + Spendthrift). Grid computing is NOT merged into Hedgehog.
- Hosting: use the Caddy server already on ports 80/443 and one cheap domain with subdomains, for example hh.<d> for Hedgehog's stable host (D16) and room.<d> and evil-taco.<d> for Spendthrift. Drop ngrok and Cloudflare. A separate evil-taco.xyz domain is optional.
- Unsourced claims (bar-promo headlines, Mattress Mack, the UK "88% back" figure, the Morse-code incident): cut each one by H33 unless the user supplies a link.
- Finals promo: default to the Saturday Austin high (it works for any slot time). Use Aggies-OU only if the slot turns out to be after kickoff and the user confirms.
- Human bandwidth: the friend owns Spendthrift end to end (pitch, faucets, QuickNode account, rehearsals). The user gives Spendthrift at most 30% before H24.
- Toolchain: inconsistency found. The Hedgehog spec pins Anchor 0.31.x and Spendthrift pins 1.2.2. Do one shared install of rustup + Agave + avm, run `avm install` for both pinned versions, and never use a 2.0 release candidate. Each repo pins its own version.

H0-H6 ACTIONS, IN ORDER (H0 = Wed about 19:00Z / 1 PM CST):
1. H0: Telegram ping to the user (critical path). Steps: log in to Gemini, confirm Predictions trading is available in Texas, accept the prediction-market terms, fund at least $75 by an instant method, create Trader API keys A and B. Ask the user to confirm the friend owns Spendthrift, and to approve a domain purchase (about $2-15) plus use of the existing Caddy server.
2. H0: one agent starts the shared toolchain install in the background (rustup, Agave, avm with both Anchor versions). Fallback: Solana Playground at H3.
3. H0-H1: faucets on separate wallets, so the two projects don't compete for limits. Hedgehog: 8 SOL deployer + 2 SOL merchant. Spendthrift: target 15 SOL. Then Circle devnet USDC on several wallets. Hedgehog's A1 writes the `setup.ts` self-mint fallback (30 min).
4. H0-H1 (friend): QuickNode account, devnet endpoint and Streams API key; Gemini LLM API key for Spendthrift's agent; check whether the rules allow two entries in the same chain award (different track pools).
5. H1: domain bought, DNS pointed, Caddy vhosts up with TLS. Freeze Hedgehog's `PUBLIC_URL` (D16).
6. H1-H3, Hedgehog: as soon as the keys exist, run the H0 gate. Buy 1 contract in each of the 6 bins of WXHIGH-AUS-2611190459 (sum of asks 1.26, so a guaranteed YES with a real hedge). This is G1 evidence and also the D20 test-promise position.
7. H1-H4, Spendthrift: G1 (Token-2022 extensions in LiteSVM, then devnet), G2 (timing, 30 runs) and G3 (Streams delivers the failed tx with its error). If G3 is NO-GO, switch to logsSubscribe and drop the QuickNode claim.
8. H3: toolchain hard stop for both projects. If `anchor build` is still failing, use Solana Playground and ping the user.
9. H4: decision point. If Hedgehog G1 is GO (real production fill with an order id), both programs go full speed: Hedgehog A1 builds the 6 core instructions toward a devnet deploy by H14 (the D20 test promise starts at 03:30 CST); Spendthrift A1 builds its 7 instructions toward the IDL freeze at H12. If G1 is NO-GO, switch to Spendthrift + Shed (Shed in DeFi) and the user answers Shed's G0 hardware question immediately.
10. H4-H6: start Hedgehog services (attestor, relayer, issuance mutex, cashier tap) and Spendthrift's gateway and room skeletons against the frozen interfaces.

Spec paths: /root/blockchainHackathon26/ideas/build/Hedgehog.md, /root/blockchainHackathon26/ideas/build/Spendthrift.md, /root/blockchainHackathon26/ideas/build/Shed.md (contingency only).