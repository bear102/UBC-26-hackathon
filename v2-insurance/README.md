# Hedgehog v2: prediction-market insurance for small businesses

**Status:** pivot started 2026-11-19. Only the concept is written down so far. No spec or code yet.

## Idea
Small businesses face niche risks that regular insurers won't cover, or charge too much for: a heat wave that empties a patio bar, a rained-out weekend for a food truck, a home-team loss that cuts game-night traffic, a tariff or rate decision that raises supply costs. Prediction markets already price many of these events.

Hedgehog acts as an **AI hedging advisor**:
1. The business describes itself in plain language (what it sells, where, when it's busy, what hurts revenue).
2. AI maps that profile to its risk exposures and finds matching live prediction markets (Gemini prediction markets first).
3. It recommends a hedge: which contracts, which side, how many, and what it costs. It shows payout-if-bad-thing-happens next to premium-if-it-doesn't, like an insurance quote.
4. With the business's approval, the hedge is placed (real Gemini orders) and tracked. When a market resolves, the payout offsets the lost revenue.

Long-term vision: prediction markets replace small-business insurance.

## What carries over from v1 (`../v1-promos`)
- Gemini prediction-market public/private API clients: `../v1-promos/lib/hh/gemini.ts`, `geminiPrivate.ts`
- H0 gate (real Gemini fill via API): `../v1-promos/scripts/h0-gate.ts`
- Hackathon facts, judging research and prize targets: `../v1-promos/docs/HACKATHON.md`, `../v1-promos/docs/research/`
- Weather-model and pricing math: `../v1-promos/reference/scaffold-lib/`

## Open questions (spec to come)
- Is Solana still in the product (e.g. a policy record or payout escrow), or is this now Gemini + AI only? This decides which tracks we can still target.
- Which business personas and risk types go in the demo.
- Sizing method: how to turn expected revenue loss into a contract count.
