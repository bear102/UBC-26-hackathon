# Hedgehog: prediction markets as small-business insurance (UBC Hackathon 2026)

| Folder | What |
|---|---|
| [`hedgehog/`](hedgehog/) | **The current project.** An AI risk advisor: a business describes itself, the AI finds the events that hurt it (heat, rain, a home-team loss, fuel or rate spikes, snow, power prices…), matches them to live prediction markets (Gemini first, Kalshi where Gemini lists nothing, Polymarket as a cross-check), and builds an insurance-style quote. The owner buys with one signature on Solana devnet (outcome tokens or a Hedgehog Cover policy from our Anchor program); Hedgehog backs each sale on Gemini, and winners are paid automatically. Start with [`hedgehog/docs/DESIGN.md`](hedgehog/docs/DESIGN.md). |
| [`old/`](old/) | Earlier work: the original "your drink's on us if the Spurs lose" hedged-promos app with its Solana escrow and the Risk Scan + Hedge Desk suite (`old/promos/`), an early upload snapshot (`old/hedgehog-export/`), and the first VPS scaffold (`old/vps-v1/`). |

Run the app: `cd hedgehog && npm install && cp .env.example .env.local` (fill in keys), then `npm run dev` and `npm run worker`.
