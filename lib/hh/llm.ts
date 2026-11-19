// Structured-JSON LLM call shared by the promo scan (§5.1) and the Risk Scan (§14.2).
// Provider order: Anthropic if its key is set, else Google AI Studio (GOOGLE_API_KEY), else none (caller falls back).
import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "anthropic" | "google";
export type LlmOut = { text: string; provider: LlmProvider; refused?: boolean; ms: number };

export function llmProvider(): LlmProvider | null {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  if (process.env.GOOGLE_API_KEY) return "google";
  return null;
}

/** Thrown errors carry `status` (HTTP) when known. */
export async function llmJson(o: { system: string; user: string; schema: object; timeoutMs?: number; maxTokens?: number }): Promise<LlmOut> {
  const provider = llmProvider();
  if (!provider) throw Object.assign(new Error("no LLM key"), { status: 0 });
  const t0 = Date.now();
  if (provider === "anthropic") {
    const client = new Anthropic({ timeout: o.timeoutMs ?? 12_000, maxRetries: 0 });
    const req = {
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: o.maxTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: o.schema } },
      system: o.system,
      messages: [{ role: "user" as const, content: o.user }],
    };
    const res = await client.beta.messages.create(req as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") return { text: "", provider, refused: true, ms: Date.now() - t0 };
    const tb = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
    return { text: tb?.text ?? "{}", provider, ms: Date.now() - t0 };
  }
  const model = process.env.GOOGLE_MODEL || "gemini-2.5-flash";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? Number(process.env.GOOGLE_TIMEOUT_MS || 20_000));
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GOOGLE_API_KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [{ role: "user", parts: [{ text: o.user }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: o.schema, maxOutputTokens: o.maxTokens ?? 4000 },
      }),
    });
    if (!r.ok) throw Object.assign(new Error(`google ${r.status}`), { status: r.status });
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return { text: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("") || "{}", provider, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

export const errCode = (e: unknown) =>
  e instanceof Anthropic.APIError ? e.status : ((e as { status?: number }).status ?? (e as Error).name);

// Normalize arrows the model may garble (mojibake "â†’", "->", "=>", other Unicode arrows) and drop replacement/control chars.
export const cleanText = (t: string) =>
  String(t ?? "").replace(/â†’/g, "→").replace(/\s*(?:->|=>|[←-⇿⟶➔➜])\s*/g, " → ").replace(/[�\u0000-\u001F]/g, "").replace(/\s{2,}/g, " ").trim();
