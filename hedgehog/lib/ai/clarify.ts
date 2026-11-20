// Clarifying questions before a quote: ONE fast-tier LLM call (zod-validated), deterministic keyword fallback.
// Never blocks the flow: any failure returns the fallback (or []). Server-only.
import { z } from "zod/v4";
import type { BusinessProfile, ClarifyQuestion, MarketContract } from "../types";
import { generateJson as defaultLlm, type GenerateJson } from "./llm";
import { fallbackQuestions, normalizeQuestions, profileSig, withDiscovery } from "./clarifyRules";

export { fallbackQuestions, normalizeQuestions } from "./clarifyRules";

/** What the model returns (lenient on counts; normalizeQuestions enforces max 3 questions / 5 options). */
export const clarifySchema = z.object({
  questions: z.array(z.object({
    id: z.string().min(1).max(40).describe("topic slug: outdoor | vehicles | loan | busy-days | game | weather | or a short slug"),
    label: z.string().min(1).max(30).describe("1-3 word topic for a recap, e.g. 'Outdoor seating'"),
    question: z.string().min(5).max(140).describe("one short plain-English question, <= 12 words"),
    why: z.string().max(80).describe("<= 6 words, e.g. 'So rain cover fits'"),
    options: z.array(z.string().min(1).max(60)).max(8).describe("2-5 tap-to-pick answers, <= 4 words each"),
    allowFreeText: z.boolean(),
    multi: z.boolean().optional().describe("true when several options can apply at once (e.g. which kinds of weather hurt)"),
  })).max(6),
});

export const CLARIFY_SYSTEM = `You help an insurance-style hedging app quote a small business. Before quoting, you may ask the owner up to 3 quick questions.
Ask a question ONLY if its answer would change which risks we hedge or how big the cover is. Hedgeable risks: weather on busy days (rain, heat, cold, snow, storms), a local team's game result, fuel/oil/natural-gas prices, metal prices, Fed rate decisions, CPI, crypto prices, power prices.
Good questions: share of outdoor seating; whether they run their own vehicles (and what); fixed vs variable loan rate; which weather actually stops work; whether a home-team win or loss helps or hurts.
Rules:
- Never ask what the description or form already says (name, city, revenue, busy days, budget, anything stated). If nothing would change the quote, return {"questions":[]}. Zero questions is often right.
- Never ask about weather the owner already said hurts them (e.g. "when it rains nobody comes" answers it).
- Plain English, no jargon, no preamble, no "great question". Question <= 12 words. why <= 6 words, starting with "So", e.g. "So rain cover fits", "So we only cover busy days". 2-5 options, <= 4 words each, covering the realistic answers (include a "No"/"None" option when relevant).
- allowFreeText true only when a number or detail helps (e.g. how many vans).
- multi true when the owner may pick several options at once (which kinds of weather hurt, which costs squeeze them).
- id: use outdoor, vehicles, loan, busy-days, game or weather when it fits; otherwise a short slug.
- Whether game days matter at all (when the owner names no team), big local events, fuel/propane costs and delivery-app share are asked separately: don't ask about them.`;

type Out = { questions: ClarifyQuestion[]; model: string };
/** Per-profile cache (1 h; 5 min for keyword fallbacks) that also de-duplicates in-flight calls: the free Gemini quota is tiny. */
const cache = new Map<string, { at: number; ttl: number; out: Promise<Out> }>();

/** `markets`: live markets for the discovery questions (lib/ai/discovery.ts); fetched (4 s cap) when not given, except in tests (injected llm). */
export function clarifyQuestions(profile: BusinessProfile, opts: { llm?: GenerateJson; noCache?: boolean; markets?: MarketContract[] | null } = {}): Promise<Out> {
  const useCache = !opts.noCache && !opts.llm;
  const key = `${profileSig(profile)}|${profile.avgDailyRevenueUsd}`;
  const hit = useCache ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.at < hit.ttl) return hit.out;
  const entry = { at: Date.now(), ttl: 60 * 60_000, out: Promise.resolve({ questions: [], model: "" }) as Promise<Out> };
  const marketsP = opts.markets !== undefined || opts.llm ? Promise.resolve(opts.markets ?? null) : liveMarkets();
  entry.out = marketsP.then((m) => ask(profile, opts.llm ?? defaultLlm, m)).then((o) => { if (o.model === "fallback-rules") entry.ttl = 5 * 60_000; return o; });
  if (useCache) {
    cache.set(key, entry);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
  }
  return entry.out;
}

/** Live markets (cached by lib/markets), null when slow or down: discovery then assumes games / fuel / rain exist, events don't. */
async function liveMarkets(): Promise<MarketContract[] | null> {
  try {
    const { listMarkets } = await import("../markets/index");
    return await Promise.race([listMarkets(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  } catch { return null; }
}

async function ask(profile: BusinessProfile, llm: GenerateJson, markets: MarketContract[] | null): Promise<Out> {
  try {
    const { data, model } = await llm({
      tier: "fast",
      system: CLARIFY_SYSTEM,
      schema: clarifySchema,
      timeoutMs: 12_000,
      prompt: [
        `Business: ${profile.name}`,
        `Owner says: "${profile.description}"`,
        `City: ${profile.city}`,
        `Average daily revenue: $${Math.round(profile.avgDailyRevenueUsd).toLocaleString("en-US")}`,
        `Busy days: ${profile.busyDays.join(", ") || "not given"}`,
        `\nReturn {"questions":[...]} (0 to 3).`,
      ].join("\n"),
    });
    return { questions: withDiscovery(normalizeQuestions(data.questions, profile), profile, markets), model };
  } catch (e) {
    console.warn(`[clarify] LLM failed, using keyword rules: ${String((e as Error)?.message).slice(0, 160)}`);
    return { questions: fallbackQuestions(profile, markets), model: "fallback-rules" };
  }
}
