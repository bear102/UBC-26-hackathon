// Provider-agnostic structured-JSON LLM call. Server-only.
// Order: Gemini -> Anthropic -> OpenAI (each only if its key is set). Each provider gets one
// "repair" retry when the output is not valid JSON or fails the zod schema. Keys are never logged.
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { env } from "../env";

export type Tier = "pro" | "fast";
export interface GenerateJsonOpts<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  tier: Tier;
  /** Override the per-tier timeout (ms). */
  timeoutMs?: number;
}
export interface GenerateJsonResult<T> { data: T; model: string }
export type GenerateJson = <T>(opts: GenerateJsonOpts<T>) => Promise<GenerateJsonResult<T>>;

export class LlmError extends Error {
  constructor(message: string, public attempts: string[]) { super(message); this.name = "LlmError"; }
}

const TIMEOUT: Record<Tier, number> = { pro: 50_000, fast: 25_000 };

/** A raw provider: returns the model's text (expected to be JSON). */
interface Provider {
  name: string;
  model: (tier: Tier) => string;
  available: () => boolean;
  call: (a: { system: string; prompt: string; jsonSchema: object; tier: Tier; timeoutMs: number }) => Promise<{ text: string; model: string }>;
}

// ---------- JSON helpers ----------
export function toJsonSchema(schema: z.ZodType<unknown>): object {
  const js = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** Pulls a JSON value out of model text (handles ```json fences and leading prose). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error("no JSON found in model output");
}

function zodIssues(err: z.ZodError): string {
  return err.issues.slice(0, 12).map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

function schemaHint(jsonSchema: object) {
  return `\n\nReturn ONLY a JSON object (no prose, no code fences) matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await r.text();
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

// ---------- providers ----------
let gemini: GoogleGenAI | null = null;
/** Models that returned 404 (retired) or 429 "limit: 0" (no quota on this key): skipped for 10 min. */
const geminiDead = new Map<string, number>();
/** Models that were rate-limited (429) or overloaded (503): skipped for 30 s on the first round. */
const geminiCool = new Map<string, number>();
function geminiChain(tier: Tier, skipCooling = true): string[] {
  // "pro" falls back to the fast model: on free-tier keys gemini-2.5-pro is retired (404) and
  // gemini-3.x pro previews have zero quota (429), verified 2026-11-19.
  // gemini-3.1-flash-lite is the last resort when 2.5-flash is rate-limited (free tier ~10 RPM).
  const lite = process.env.GEMINI_MODEL_LITE || "gemini-3.1-flash-lite";
  const chain = tier === "pro" ? [env.geminiModelPro(), env.geminiModelFast(), lite] : [env.geminiModelFast(), lite];
  const now = Date.now();
  const live = [...new Set(chain)].filter((m) => (geminiDead.get(m) ?? 0) < now && (!skipCooling || (geminiCool.get(m) ?? 0) < now));
  return live.length ? live : skipCooling ? geminiChain(tier, false) : [env.geminiModelFast()];
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const geminiProvider: Provider = {
  name: "gemini",
  available: () => !!env.geminiKey(),
  model: (tier) => geminiChain(tier)[0],
  async call({ system, prompt, jsonSchema, tier, timeoutMs }) {
    gemini ??= new GoogleGenAI({ apiKey: env.geminiKey(), apiVersion: "v1beta" });
    const ctl = AbortSignal.timeout(timeoutMs);
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    for (let round = 0; round < 2; round++) {
      if (round === 1) {
        if (deadline - Date.now() < 10_000) break; // not enough time for a second round
        await sleep(2500 + Math.random() * 1500);
      }
      for (const model of geminiChain(tier, round === 0)) {
        const run = (withSchema: boolean) =>
          gemini!.models.generateContent({
            model,
            contents: prompt + (withSchema ? "" : schemaHint(jsonSchema)),
            config: {
              systemInstruction: system,
              responseMimeType: "application/json",
              ...(withSchema ? { responseJsonSchema: jsonSchema } : {}),
              temperature: 0.3,
              // Bounded thinking keeps calls under the timeout (only 2.5 models take a token budget).
              ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: tier === "pro" ? 2048 : 512 } } : {}),
              abortSignal: ctl,
            },
          });
        try {
          let res;
          try {
            res = await run(true);
          } catch (e) {
            // A schema feature can be rejected (400); retry once with the schema in the prompt instead.
            if (ctl.aborted || !/"code":\s*400|INVALID_ARGUMENT/.test(String((e as Error).message))) throw e;
            res = await run(false);
          }
          const text = res.text;
          if (!text) throw new Error(`gemini returned no text (finish: ${res.candidates?.[0]?.finishReason ?? "?"})`);
          return { text, model };
        } catch (e) {
          lastErr = e;
          const msg = String((e as Error).message);
          if (ctl.aborted || !/"code":\s*(404|429|500|503)/.test(msg)) throw e;
          if (/"code":\s*404/.test(msg) || /limit:\s*0\b/.test(msg)) geminiDead.set(model, Date.now() + 10 * 60_000);
          else if (/PerDay/.test(msg)) geminiDead.set(model, Date.now() + 60 * 60_000); // daily free-tier quota used up
          else geminiCool.set(model, Date.now() + 30_000);
          // fall through to the next model in the chain
        }
      }
    }
    throw lastErr;
  },
};

let anthropic: Anthropic | null = null;
const anthropicClient = () => (anthropic ??= new Anthropic({ apiKey: env.anthropicKey(), maxRetries: 1 }));
/** Claude via the official SDK. Sonnet 5.5 (adaptive thinking): effort "medium" for the heavy calls (risk map, brainstorm),
 *  "low" for the quick ones (matching, summary, questions) to keep a plan fast. Server-side refusal fallback is on. */
const anthropicProvider: Provider = {
  name: "anthropic",
  available: () => !!env.anthropicKey(),
  model: (tier) => (tier === "pro" ? process.env.ANTHROPIC_MODEL_PRO || "claude-sonnet-5-5" : process.env.ANTHROPIC_MODEL_FAST || "claude-sonnet-5-5"),
  async call({ system, prompt, jsonSchema, tier, timeoutMs }) {
    const msg = await anthropicClient().beta.messages.create({
      model: anthropicProvider.model(tier),
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt + schemaHint(jsonSchema) }],
      output_config: { effort: tier === "pro" ? "medium" : "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as any, { timeout: timeoutMs }) as any;
    if (msg.stop_reason === "refusal") throw new Error("anthropic refused the request");
    const text = (msg.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    if (!text) throw new Error(`anthropic returned no text (stop: ${msg.stop_reason})`);
    return { text, model: msg.model ?? anthropicProvider.model(tier) };
  },
};

const openaiProvider: Provider = {
  name: "openai",
  available: () => !!env.openaiKey(),
  model: (tier) => (tier === "pro" ? process.env.OPENAI_MODEL_PRO || "gpt-4.1" : process.env.OPENAI_MODEL_FAST || "gpt-4.1-mini"),
  async call({ system, prompt, jsonSchema, tier, timeoutMs }) {
    const j = await fetchJson("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.openaiKey()}` },
      body: JSON.stringify({
        model: openaiProvider.model(tier),
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt + schemaHint(jsonSchema) }],
      }),
    }, timeoutMs);
    const text = j.choices?.[0]?.message?.content;
    if (!text) throw new Error("openai returned no text");
    return { text, model: openaiProvider.model(tier) };
  },
};

/** Claude first when its key is set (LLM_PRIMARY=gemini flips it back); Gemini and OpenAI are fallbacks. */
export const PROVIDERS: Provider[] = process.env.LLM_PRIMARY === "gemini" ? [geminiProvider, anthropicProvider, openaiProvider] : [anthropicProvider, geminiProvider, openaiProvider];

/** Core loop, exported for tests with fake providers. */
export async function generateJsonWith<T>(providers: Provider[], opts: GenerateJsonOpts<T>): Promise<GenerateJsonResult<T>> {
  const jsonSchema = toJsonSchema(opts.schema as z.ZodType<unknown>);
  const timeoutMs = opts.timeoutMs ?? TIMEOUT[opts.tier];
  const attempts: string[] = [];
  const usable = providers.filter((p) => p.available());
  if (!usable.length) throw new LlmError("no LLM provider configured (set GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)", attempts);

  for (const p of usable) {
    let model = p.model(opts.tier);
    let prompt = opts.prompt;
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        const out = await p.call({ system: opts.system, prompt, jsonSchema, tier: opts.tier, timeoutMs });
        text = out.text; model = out.model;
      } catch (e) {
        attempts.push(`${p.name}/${model}: ${(e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message}`.slice(0, 300));
        break; // transport/API error: go to next provider
      }
      let problem: string;
      try {
        const parsed = opts.schema.safeParse(extractJson(text));
        if (parsed.success) return { data: parsed.data, model: `${p.name}/${model}` };
        problem = `Your JSON failed validation:\n${zodIssues(parsed.error)}`;
      } catch (e) {
        problem = `Your output was not valid JSON (${(e as Error).message}).`;
      }
      attempts.push(`${p.name}/${model}: invalid output (attempt ${attempt + 1})`);
      // Repair retry: show the model its own output and the errors.
      prompt = `${opts.prompt}\n\n---\nYour previous answer:\n${text.slice(0, 6000)}\n\n${problem}\nReturn the corrected JSON only.`;
    }
  }
  throw new LlmError(`all LLM providers failed: ${attempts.join(" | ")}`, attempts);
}

export const generateJson: GenerateJson = (opts) => generateJsonWith(PROVIDERS, opts);
export type { Provider };
