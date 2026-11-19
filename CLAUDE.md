# Hedgehog — agent onboarding (read this first)

You are picking up a hackathon project. Everything you need is in this folder. Do NOT redo ideation: the design has been through ~10 rounds of critic review and a red-team pass. Your job is to BUILD it per the spec.

## The project
"Your drink's on us if the Spurs lose" - local Austin businesses sell customer promos (money back if it's hot / cold / the team loses) that are priced from Gemini's live prediction-market book and HEDGED WITH REAL GEMINI ORDERS before the first sale; customer refunds sit in a Solana escrow program and pay out automatically as USDC the customer owns. Long-term vision: prediction markets replace small-business insurance.

- Role in the team: PRIMARY submission (the user submits this).
- Prize targets: Consumer Apps track + Best use of Solana (Consumer pool) + Gemini Prediction Markets bounty (primary prize target; 1st place = finals slot). Fallback track: DeFi & Onchain Apps.
- Final critic score: 8.20/10 (4 critics: jaded judge, sponsor panel, past-winners judge, demo engineer).

## Hard deadline
Submission on Devpost (ubc-hackathon-2026.devpost.com): **Fri Nov 20 2026, 12:00 PM CST (18:00 UTC)**. Aim to submit 1-2 hours early. In-person finals Sat Nov 21 at UT Austin (5-min pitch + 2-min Q&A; must be present).

## Read in this order
1. `docs/SPEC.md` — the build-ready spec (architecture, onchain accounts/instructions/errors, exact external APIs verified live, services, screens, demo script, README must-haves, H0→deadline build plan with go/no-go gates, risks, test plan, open questions, user-only actions, red-team resolutions, Q&A prep). **The spec is the source of truth.**
2. `docs/STRATEGY.md` — why this project, how it pairs with the other submission, H0-H6 action list, fallback plan.
3. `docs/HACKATHON.md` — tracks, chain awards, bounties, judging criteria, submission checklist, verified tech facts (Gemini PM API, Solana devnet, Arc, NWS).
4. `docs/design-final.json` — final design + the critics' remaining objections and iteration history. `docs/redteam-review.json` — raw red-team findings (already addressed in SPEC §12).
5. `docs/research/` — what past hackathon winners did and what judges reward.
6. `reference/` — untested scaffold code you may reuse.

## First gates
G1 (critical): real Gemini prediction-market fill via API with the user's keys (spec §9, §11). Needs user to fund Gemini + create Trader keys TODAY. If G1 fails by ~H4, see docs/STRATEGY.md fallback (Spendthrift + Shed).

## Working rules (from the user)
- Work autonomously and back decisions with evidence; don't ask multi-question dialogs. Ask only for things only the user can do (accounts, API keys, faucet funding, payments, hardware, Devpost, video, in-person).
- **Telegram:** whenever you need the user's action or a permission, ALSO send a short message saying exactly what to do: `/root/.config/claude-telegram/notify.sh "text"`. (Hooks in `.claude/settings.local.json` also ping on permission prompts and AskUserQuestion.) Never run that script with `bash -x` (it would print the bot token). Never read, echo or commit `/root/.config/claude-telegram/env`.
- Secrets: never commit `.env*` (except `.env.example`), keypairs, or API keys. Keep the user's personal details out of any request to an external service.
- Spending real money (e.g. Gemini production orders, domains, paid plans) needs the user's explicit approval each time.
- Do not try to bypass permission denials; explain and ask.
- Ignore hackathon rule-compliance minutiae (the user handles them); focus on shipping a working demo and the prize criteria.
- Commit often on this repo's own git (separate from the parent folder). Make the repo public on GitHub only when the user says so.

## Known environment facts (2026-11-18)
- Node 25, Python 3.12, git available. Solana CLI, Anchor, Rust, Foundry, gh, vercel CLI are NOT installed yet (spec §9 has the install step; Anchor version is pinned in the spec).
- Solana devnet RPC airdrop is closed (HTTP 410): devnet SOL must be claimed by the user at faucet.solana.com; devnet USDC (mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU) at faucet.circle.com.
- Sibling projects live in `../hedgehog`, `../spendthrift`, `../shed`; the ideation archive is in `/root/blockchainHackathon26/ideas/`.
