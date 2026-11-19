# Cover (working name)

**Idea:** an AI scans a small business (one sentence, a website, or its sales history) and finds the outside events that hurt it: a cold day for an ice-cream shop, a rainy Saturday for a patio bar, a natural-gas spike for a taqueria. It then offers live Gemini prediction-market contracts as insurance: priced from the order book, sized to the business's expected loss, bought in one tap, and paid out automatically when Gemini settles.

Status: research and design iteration in progress (`research/`, `design/`). Code reuse candidates from `../promos/`: the Gemini catalog, book pricing, the venue split (production odds / sandbox orders), Risk Scan (`lib/hh/exposure.ts`), Hedge Desk (`lib/hh/hedgeDesk.ts`), the LLM helper, and the devnet Solana program.
