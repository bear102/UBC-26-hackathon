// Card scan (SPEC §5.1): owner's sentence → ≤3 promise cards from LIVE Gemini events only. Templates on any failure.
import Anthropic from "@anthropic-ai/sdk";
import { promoCatalog, templateCards, type CatalogEvent } from "./catalog";
import type { Card } from "./store";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          event_ticker: { type: "string" },
          strip: { type: "array", items: { type: "string" } },
          sentence: { type: "string", description: "customer-facing, <=80 chars, e.g. 'Spurs lose tonight → $1 back'" },
          why: { type: "string", description: "<=120 chars, why this fits the business" },
          applies_to: { type: "string", description: "which purchases, e.g. 'any draft', 'iced drinks'" },
        },
        required: ["event_ticker", "strip", "sentence", "why", "applies_to"],
      },
    },
  },
  required: ["cards"],
} as const;

function catalogLines(cat: CatalogEvent[]) {
  return cat.slice(0, 60).map((e) => {
    const cs = e.contracts.slice(0, 12).map((c) => `${c.instrumentSymbol} "${c.label}" ask ${c.prices?.bestAsk ?? "none"}`).join("; ");
    return `- ${e.ticker} | ${e.title} | ${e.kind} | start ${e.startTime ?? "-"} | expiry ${e.expiryDate} | contracts: ${cs}`;
  }).join("\n");
}

export type ScanResult = { cards: Card[]; source: "llm" | "template"; note?: string; ms: number };

export async function scan(text: string): Promise<ScanResult> {
  const t0 = Date.now();
  const cat = await promoCatalog();
  const fallback = async (note: string): Promise<ScanResult> => ({ cards: await templateCards(cat), source: "template", note, ms: Date.now() - t0 });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return fallback("no LLM key; templates");
  try {
    const client = new Anthropic({ timeout: 12_000, maxRetries: 0 });
    const req = {
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You design money-back promos for small Texas businesses. A promo pays each customer $1 back if a Gemini prediction-market contract set resolves YES. " +
        "Use ONLY events and instrumentSymbols from the catalog. The strip is the set of contracts that pay in the scenario where the customer gets money back " +
        "(e.g. 'Spurs lose' = the opponent's contract; 'under 74°F' = all bins below 74). Strips use contracts of a single event. Prefer promos tied to what hurts the business " +
        "(rain/cold for patios and iced drinks, heat for hot drinks, the home team losing for sports bars). Return 1-3 cards.",
      messages: [{ role: "user" as const, content: `Business: ${text.slice(0, 300)}\n\nLive Gemini catalog:\n${catalogLines(cat)}` }],
    };
    const res = await client.beta.messages.create(req as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") return fallback("model declined; templates");
    const textBlock = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
    const parsed = JSON.parse(textBlock?.text ?? "{}") as { cards?: Card[] };
    const byTicker = new Map(cat.map((e) => [e.ticker, e]));
    const valid = (parsed.cards ?? []).filter((c) => {
      const e = byTicker.get(c.event_ticker);
      if (!e || !Array.isArray(c.strip) || !c.strip.length || c.strip.length > 6) return false;
      const syms = new Set(e.contracts.map((x) => x.instrumentSymbol));
      return c.strip.every((s) => syms.has(s)) && new Set(c.strip).size === c.strip.length;
    }).slice(0, 3).map((c) => ({ ...c, sentence: c.sentence.slice(0, 80), why: c.why.slice(0, 120), event_title: byTicker.get(c.event_ticker)!.title }));
    if (!valid.length) return fallback("LLM proposed no valid live market; templates");
    return { cards: valid, source: "llm", ms: Date.now() - t0 };
  } catch (e) {
    return fallback(`LLM error (${e instanceof Anthropic.APIError ? e.status : (e as Error).name}); templates`);
  }
}
