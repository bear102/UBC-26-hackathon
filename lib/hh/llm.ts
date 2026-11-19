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
  return googleJson(o, t0);
}

/** Google thinking config: 2.5 Flash/Flash-Lite can turn thinking off (much faster); Gemini 3 takes a level. */
export function googleThinking(model: string): Record<string, unknown> | undefined {
  const v = process.env.GOOGLE_THINKING;
  if (v === "default") return undefined;
  if (/gemini-2\.5-flash/.test(model)) return { thinkingBudget: v != null && v !== "" ? Number(v) : 0 };
  if (/gemini-3/.test(model)) return { thinkingLevel: v || "low" };
  return undefined;
}

export const retryableStatus = (s: unknown) => s === 429 || s === 500 || s === 502 || s === 503 || s === 504;

/** One request + ONE quick retry on 429/5xx, all inside a single deadline (`timeoutMs`). */
async function googleJson(o: { system: string; user: string; schema: object; timeoutMs?: number; maxTokens?: number }, t0: number): Promise<LlmOut> {
  const model = process.env.GOOGLE_MODEL || "gemini-2.5-flash";
  const deadline = t0 + (o.timeoutMs ?? Number(process.env.GOOGLE_TIMEOUT_MS || 20_000));
  const thinkingConfig = googleThinking(model);
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: [{ text: o.user }] }],
    generationConfig: {
      responseMimeType: "application/json", responseJsonSchema: o.schema, maxOutputTokens: o.maxTokens ?? 4000, temperature: 0.2,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  });
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw Object.assign(new Error("google timeout"), { status: "timeout" });
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(left),
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GOOGLE_API_KEY! },
        body,
      });
      if (!r.ok) {
        const detail = (await r.text().catch(() => "")).slice(0, 200);
        throw Object.assign(new Error(`google ${r.status} ${detail}`.trim()), { status: r.status });
      }
      const j = (await r.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]; promptFeedback?: { blockReason?: string } };
      if (j.promptFeedback?.blockReason) return { text: "", provider: "google", refused: true, ms: Date.now() - t0 };
      const parts = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought);
      return { text: parts.map((p) => p.text ?? "").join("") || "{}", provider: "google", ms: Date.now() - t0 };
    } catch (e) {
      const st = (e as { status?: unknown }).status;
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") throw Object.assign(new Error("google timeout"), { status: "timeout" });
      // one quick retry when Google is overloaded, only if enough of the budget is left for a real answer
      const backoff = 400 + Math.floor(Math.random() * 300);
      if (attempt === 0 && retryableStatus(st) && deadline - Date.now() > backoff + 4_000) {
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }
      throw e;
    }
  }
}

/** Resolve `p` or give `fallback` after `ms` (the underlying fetch keeps running and still fills the HTTP cache). */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((res) => { timer = setTimeout(() => res(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export const errCode = (e: unknown) =>
  e instanceof Anthropic.APIError ? e.status : ((e as { status?: number }).status ?? (e as Error).name);

// Normalize arrows the model may garble (mojibake "â†’", "->", "=>", other Unicode arrows) and drop replacement/control chars.
export const cleanText = (t: string) =>
  String(t ?? "").replace(/â†’/g, "→").replace(/\s*(?:->|=>|[←-⇿⟶➔➜])\s*/g, " → ").replace(/[�\u0000-\u001F]/g, "").replace(/\s{2,}/g, " ").trim();
