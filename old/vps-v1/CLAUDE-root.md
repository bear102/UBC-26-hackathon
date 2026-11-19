# Hedgehog — agent onboarding (read this first)

## Repo layout
- `v2-insurance/` — **ACTIVE.** Pivot (2026-11-19): prediction-market-based niche insurance for small businesses. AI looks at the business's risks and suggests how to hedge them with prediction markets (Gemini first). Start with `v2-insurance/docs/DESIGN.md` (source of truth for v2).
- `old/` — ARCHIVED original idea ("your drink's on us if the Spurs lose": hedged customer promos + Solana escrow). Kept for reference and reusable code (Gemini API clients, H0 gate script, hackathon research). Its `CLAUDE.md` and `docs/SPEC.md` describe v1 and **no longer drive the build**. Its devnet keypairs live in `old/keys/` (gitignored), and its scripts expect to be run from `old/`.

The user chose the pivot. Don't argue for v1. Reuse its research and code where it helps.

## Hackathon
- Devpost (ubc-hackathon-2026.devpost.com) deadline: **Fri Nov 20 2026, 12:00 PM CST (18:00 UTC)**. Aim to submit 1-2 hours early. In-person finals Sat Nov 21 at UT Austin (5-min pitch + 2-min Q&A).
- v2 prize targets: DeFi & Onchain Apps track + Best use of Solana + Gemini PM bounty + QuickNode Streams (see DESIGN.md §2). Track rules: `old/docs/HACKATHON.md`.
- This is the user's PRIMARY submission.

## Working rules (from the user)
- Work autonomously and back decisions with evidence; don't ask multi-question dialogs. Ask only for things only the user can do (accounts, API keys, faucet funding, payments, hardware, Devpost, video, in-person).
- **Telegram:** whenever you need the user's action or a permission, ALSO send a short message saying exactly what to do: `/root/.config/claude-telegram/notify.sh "text"`. Never run that script with `bash -x`. Never read, echo or commit `/root/.config/claude-telegram/env`.
- Secrets: never commit `.env*` (except `.env.example`), keypairs, or API keys. Keep the user's personal details out of any request to an external service.
- Spending real money (e.g. Gemini production orders, domains, paid plans) needs the user's explicit approval each time.
- Do not try to bypass permission denials; explain and ask.
- Ignore hackathon rule-compliance minutiae; focus on a working demo and prize criteria.
- Commit often on this repo's own git. Make the repo public on GitHub only when the user says so.

## Environment facts (2026-11-18)
- Node 25, Python 3.12, git available. Solana CLI, Anchor, Rust, Foundry, gh, vercel CLI not installed.
- Solana devnet airdrop is closed: devnet SOL at faucet.solana.com, devnet USDC (mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU) at faucet.circle.com (user does this).
- Sibling projects: `../spendthrift`, `../shed`. Ideation archive: `/root/blockchainHackathon26/ideas/`.
