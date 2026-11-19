# UBC 2026 Hackathon: prediction markets for small business

| Folder | What |
|---|---|
| [`cover/`](cover/) | **New direction (Nov 19):** an AI that scans a business and offers Gemini prediction-market contracts as insurance (an ice-cream shop hedges a cold day with a temperature contract). Research, judged design iterations, then the build. |
| [`hedgehog/`](hedgehog/) | **Insurance build (Nov 19, VPS):** AI risk advisor that maps a business to live Gemini / Kalshi / Polymarket markets, sizes an insurance-style quote, and settles on Solana devnet (outcome tokens + Hedgehog Cover Anchor program, desk backing on Gemini). Working app in `hedgehog/v2-insurance/` (see its `docs/DESIGN.md`). |
| [`promos/`](promos/) | **Hedgehog v1-v3:** hedged money-back promos ("your drink's on us if the Spurs lose") with a Solana escrow program (live on devnet), plus the Risk Scan + Hedge Desk suite. Working app: `cd promos && npm install && npm run build && npm start`. |
| [`docs/`](docs/) | Shared hackathon facts (`HACKATHON.md`) and research on past winners and judging (`research/`). |
| `hedgehog-export/` | An old snapshot upload; superseded by `promos/`. |
