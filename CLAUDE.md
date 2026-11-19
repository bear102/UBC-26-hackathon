# Hedgehog: agent onboarding (read this first)

## Layout
- `hedgehog/`: **ACTIVE.** AI prediction-market insurance for small businesses (Next.js + Solana devnet Anchor program). Source of truth: `hedgehog/docs/DESIGN.md`. Other docs there: `AI-EVAL.md`, `FLOW-AUDIT.md`, `PLAYBOOK.md`, `MARKET-CATALOG.md`, `VENUE-EXPANSION.md`, `hackathon/` (tracks, judging research).
- `old/`: archived earlier versions (promos app, export snapshot, first scaffold). Don't build there.

## Hackathon
- Devpost deadline: **Fri Nov 20 2026, 12:00 PM CST (18:00 UTC)**; aim 1-2 h early. Finals Sat Nov 21 at UT Austin (5-min pitch + 2-min Q&A).
- Targets: DeFi & Onchain Apps track + Best use of Solana + Gemini Prediction Markets bounty + QuickNode Streams (DESIGN.md §2).

## Working rules (from the user)
- Work autonomously and back decisions with evidence; ask only for things only the user can do (accounts, API keys, faucets, payments, Devpost, video, in-person).
- Secrets: never commit `.env*` (except `.env.example`), keypairs, or API keys.
- Spending real money (e.g. live Gemini orders) needs the user's explicit approval each time.
- Do not try to bypass permission denials; explain and ask.
- The primary dev copy lives on the VPS (`/root/blockchainHackathon26/projects/hedgehog/v2-insurance`) and is mirrored into `hedgehog/` here; coordinate before editing `hedgehog/` elsewhere.
