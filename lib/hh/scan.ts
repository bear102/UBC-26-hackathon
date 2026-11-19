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

const SYSTEM =
  "You design money-back promos for small Texas businesses. A promo pays each customer $1 back if a Gemini prediction-market contract set resolves YES. " +
  "Use ONLY events and instrumentSymbols from the catalog. The strip is the set of contracts that pay in the scenario where the customer gets money back " +
  "(e.g. 'Spurs lose' = the opponent's contract; 'under 74°F' = all bins below 74). Strips use contracts of a single event. Prefer promos tied to what hurts the business " +
  "(rain/cold for patios and iced drinks, heat for hot drinks, the home team losing for sports bars). Return 1-3 cards.";

// Normalize arrows the model may garble (mojibake "â†’", "->", "=>", other Unicode arrows) and drop replacement chars.
export const cleanText = (t: string) =>
  String(t ?? "").replace(/â†’|â€‹/g, "→").replace(/\s*(?:->|=>|[\u2190-\u21FF\u27F6\u2794\u279C])\s*/g, " → ").replace(/[\uFFFD\u0000-\u001F]/g, "").replace(/\s{2,}/g, " ").trim();

async function anthropicScan(userMsg: string): Promise<{ text: string; refused?: boolean }> {
  const client = new Anthropic({ timeout: 12_000, maxRetries: 0 });
  const req = {
    model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user" as const, content: userMsg }],
  };
  const res = await client.beta.messages.create(req as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
  if (res.stop_reason === "refusal") return { text: "", refused: true };
  const textBlock = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  return { text: textBlock?.text ?? "{}" };
}

// Google AI Studio (Gemini LLM) fallback provider: structured JSON output via responseJsonSchema.
async function googleScan(userMsg: string): Promise<{ text: string; refused?: boolean }> {
  const model = process.env.GOOGLE_MODEL || "gemini-2.5-flash";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Number(process.env.GOOGLE_TIMEOUT_MS || 20_000));
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GOOGLE_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, maxOutputTokens: 4000 },
      }),
    });
    if (!r.ok) throw Object.assign(new Error(`google ${r.status}`), { status: r.status });
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return { text: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("") || "{}" };
  } finally {
    clearTimeout(timer);
  }
}

export type ScanResult = { cards: Card[]; source: "llm" | "template"; note?: string; ms: number };

export async function scan(text: string): Promise<ScanResult> {
  const t0 = Date.now();
  const cat = await promoCatalog();
  const fallback = async (note: string): Promise<ScanResult> => ({ cards: await templateCards(cat), source: "template", note, ms: Date.now() - t0 });
  const useAnthropic = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const useGoogle = !useAnthropic && !!process.env.GOOGLE_API_KEY;
  if (!useAnthropic && !useGoogle) return fallback("no LLM key; templates");
  const provider = useAnthropic ? "anthropic" : "google";
  const userMsg = `Business: ${text.slice(0, 300)}\n\nLive Gemini catalog:\n${catalogLines(cat)}`;
  try {
    const out = useAnthropic ? await anthropicScan(userMsg) : await googleScan(userMsg);
    if (out.refused) return fallback("model declined; templates");
    const parsed = JSON.parse(out.text || "{}") as { cards?: Card[] };
    const byTicker = new Map(cat.map((e) => [e.ticker, e]));
    const valid = (parsed.cards ?? []).filter((c) => {
      const e = byTicker.get(c.event_ticker);
      if (!e || !Array.isArray(c.strip) || !c.strip.length || c.strip.length > 6) return false;
      const syms = new Set(e.contracts.map((x) => x.instrumentSymbol));
      return c.strip.every((s) => syms.has(s)) && new Set(c.strip).size === c.strip.length;
    }).slice(0, 3).map((c) => ({ ...c, sentence: cleanText(c.sentence).slice(0, 80), why: cleanText(c.why).slice(0, 120), applies_to: cleanText(c.applies_to).slice(0, 60), event_title: byTicker.get(c.event_ticker)!.title }));
    if (!valid.length) return fallback("LLM proposed no valid live market; templates");
    return { cards: valid, source: "llm", note: provider, ms: Date.now() - t0 };
  } catch (e) {
    const code = e instanceof Anthropic.APIError ? e.status : ((e as { status?: number }).status ?? (e as Error).name);
    return fallback(`${provider} error (${code}); templates`);
  }
}
