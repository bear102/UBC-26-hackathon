// Pure clarifying-question rules (no LLM, no server imports): shared by lib/ai/clarify.ts, lib/ai/advisor.ts
// and the client (mock mode). Keyword fallback questions, "already answered" checks, and how answers change
// the risk map (grounding hooks + suppression).
import type { BusinessProfile, ClarifyAnswer, ClarifyQuestion, MarketContract, Risk } from "../types";
import { discoveryAnswered, discoveryQuestions, teamsInText } from "./discovery";

export type ClarifyTopic = "outdoor" | "vehicles" | "loan" | "busy-days" | "game" | "weather" | "events" | "costs" | "delivery" | "other";
export const TOPICS: readonly ClarifyTopic[] = ["outdoor", "vehicles", "loan", "busy-days", "game", "weather", "events", "costs", "delivery", "other"];

/** Which topic a question (or answer) is about: its id first, then its wording. */
export function questionTopic(q: { id?: string; questionId?: string; question?: string }): ClarifyTopic {
  const id = (q.id ?? q.questionId ?? "").toLowerCase();
  const exact = TOPICS.find((t) => id === t || id.startsWith(`${t}-`) || id.startsWith(`${t}_`));
  if (exact && exact !== "other") return exact;
  const t = `${id} ${q.question ?? ""}`.toLowerCase();
  if (/outdoor|outside|patio|seating|terrace|beer garden/.test(t)) return "outdoor";
  if (/delivery apps?|doordash|uber ?eats|grubhub/.test(t)) return "delivery";
  if (/\bacl\b|f1\b|formula 1|sxsw|rodeo|festival|big events?/.test(t)) return "events";
  if (/fuel|propane|ingredient|food costs?|beef prices?/.test(t)) return "costs";
  if (/vehicle|\bvans?\b|truck|fleet|deliver|drive|bikes?\b|courier/.test(t)) return "vehicles";
  if (/loan|line of credit|credit line|financ|interest|variable|fixed[- ]rate|debt/.test(t)) return "loan";
  if (/busiest|busy day|which days|days of the week/.test(t)) return "busy-days";
  if (/\bgame|team|win\b|lose|spurs|texans|longhorns|sports/.test(t)) return "game";
  if (/weather|rain|cold|heat|freez|storm|wind/.test(t)) return "weather";
  return "other";
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_RE = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi;

/** Day names out of a free answer: "Fri-Sun", "weekends", "Thursday and Friday", "weekdays", "every day". */
export function parseDays(answer: string): string[] {
  const a = answer.toLowerCase();
  if (/every ?day|all week|daily|7 days/.test(a)) return [...DAYS];
  const out = new Set<string>();
  if (/weekday/.test(a)) DAYS.slice(0, 5).forEach((d) => out.add(d));
  if (/weekend/.test(a)) ["Sat", "Sun"].forEach((d) => out.add(d));
  const idx = (s: string) => DAYS.findIndex((d) => d.toLowerCase() === s.slice(0, 3).toLowerCase());
  for (const m of a.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|–|—|to|through|thru)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/gi)) {
    let i = idx(m[1]); const j = idx(m[2]);
    for (let k = 0; k < 7; k++) { out.add(DAYS[i]); if (i === j) break; i = (i + 1) % 7; }
  }
  for (const m of a.matchAll(DAY_RE)) out.add(DAYS[idx(m[1])]);
  return DAYS.filter((d) => out.has(d));
}

/** Does the answer say "no / none / not us" for its topic? */
export function isNegative(topic: ClarifyTopic, answer: string): boolean {
  const a = answer.trim().toLowerCase();
  if (!a) return false;
  if (/^(no|none|nope|not|never|n\/a|zero|0)\b/.test(a)) return true;
  if (topic === "outdoor") return /indoor only|all indoor|fully indoor|no (outdoor|patio|seating outside)/.test(a);
  if (topic === "vehicles") return /third[- ]party|3rd[- ]party|doordash|uber ?eats|grubhub|we don'?t (drive|deliver)|customers pick up/.test(a);
  if (topic === "loan") return /\bfixed\b|no (loan|debt)|paid off/.test(a);
  // "Fewer customers on game days": a team loss is not what hurts them, so no team-loss hedge either
  if (topic === "game" || topic === "events") return /no effect|doesn'?t matter|not really|neither|no difference|fewer|less busy|slower/.test(a);
  if (topic === "weather") return /^(rarely|hardly|none|no effect|doesn'?t matter)/.test(a);
  if (topic === "delivery") return /under 10|less than 10|^few|^little|hardly/.test(a);
  return false;
}

/** Positive answers rewritten as plain facts with the keywords the grounding rules look for. */
export function answerFacts(answers: ClarifyAnswer[]): string {
  return answers.filter((a) => a.answer.trim()).map((a) => {
    const topic = questionTopic(a);
    if (isNegative(topic, a.answer)) return "";
    switch (topic) {
      case "outdoor": return `Outdoor seating: ${a.answer}.`;
      case "vehicles": return `Runs its own vehicles: ${a.answer}.`;
      case "loan": return /variable|floating|prime|adjust/i.test(a.answer) ? `Variable-rate loan: ${a.answer}.` : `Loan: ${a.answer}.`;
      case "weather": return `Weather that hurts the business: ${a.answer}.`;
      case "game": {
        // discovery "Do Longhorns game days change your sales?" -> a fact naming the team (season futures key off it)
        const teams = /^game-days/.test(a.questionId) ? teamsInText(`${a.question} ${a.label ?? ""}`).map((x) => x.nick) : [];
        return teams.length ? `${teams.join(" and ")} game days bring more customers; a loss or a short season costs game-day sales.` : `${a.label ?? a.question}: ${a.answer}.`;
      }
      case "costs": return `Fuel and propane costs matter: ${a.answer} (generator propane, fuel).`;
      case "delivery": return `Delivery apps: ${a.answer} of sales (rain moves orders to delivery).`;
      case "events": return `Big local events bring more customers: ${a.answer}.`;
      default: return `${a.label ?? a.question}: ${a.answer}.`;
    }
  }).filter(Boolean).join(" ");
}

/** Profile used for grounding/fallbacks/candidates: positive answers appended, busy days from a busy-days answer. */
export function profileWithAnswers(profile: BusinessProfile, answers: ClarifyAnswer[] = []): BusinessProfile {
  if (!answers.length) return profile;
  const facts = answerFacts(answers);
  const busy = answers.find((a) => questionTopic(a) === "busy-days");
  const days = busy ? parseDays(busy.answer) : [];
  return { ...profile, description: facts ? `${profile.description}\n${facts}` : profile.description, busyDays: days.length ? days : profile.busyDays };
}

/** Prompt block listing the answers (the LLM treats them as facts). */
export function answersBlock(answers: ClarifyAnswer[] = []): string {
  const xs = answers.filter((a) => a.answer.trim());
  if (!xs.length) return "";
  return `Owner's answers to our quick questions (facts; they override assumptions):\n${xs.map((a) => `- ${a.question} -> ${a.answer}`).join("\n")}`;
}

const WEATHER = new Set(["rain", "heat", "cold", "snow", "storm"]);
const WEATHER_WORD = /rain|heat|hot|cold|freez|snow|storm|wind|hail/i;
/** Weather perils named in a (multi-select) answer like "Rain, Freezing cold"; empty when none are named. */
export function weatherPerilsIn(answer: string): Set<string> {
  const a = answer.toLowerCase(), s = new Set<string>();
  if (/rain|wet|drizzle/.test(a)) s.add("rain");
  if (/heat|hot|warm/.test(a)) s.add("heat");
  if (/cold|freez|frost|snow|ice|icy/.test(a)) { s.add("cold"); s.add("snow"); }
  if (/storm|wind|hail|thunder|tornado/.test(a)) { s.add("storm"); s.add("rain"); }
  return s;
}
const OUTDOOR_TXT = /patio|outdoor|outside|terrace|beer garden|al fresco|seats? (are )?out/i;
const VEHICLE_TXT = /\bvans?\b|truck|vehicle|fleet|deliver|driv|\bmiles?\b|route|courier/i;
const LOAN_TXT = /loan|line of credit|credit line|debt|borrow|interest (cost|expense|payment)|variable[- ]rate|financing/i;

/** Drops risks the owner's answers rule out ("no outdoor seating" -> no patio-weather risks, etc.). */
export function suppressByAnswers<R extends Pick<Risk, "peril" | "title" | "trigger" | "lossReasoning"> & { causalStory?: string }>(risks: R[], answers: ClarifyAnswer[] = []): R[] {
  const neg = new Set(answers.filter((a) => isNegative(questionTopic(a), a.answer)).map((a) => questionTopic(a)));
  const wAns = answers.find((a) => questionTopic(a) === "weather" && !isNegative("weather", a.answer));
  const wPicked = wAns ? weatherPerilsIn(wAns.answer) : new Set<string>();
  const picked = wPicked.size ? wPicked : null;
  if (!neg.size && !picked) return risks;
  return risks.filter((r) => {
    const txt = `${r.title} ${r.trigger} ${r.lossReasoning} ${r.causalStory ?? ""}`;
    if (neg.has("outdoor") && WEATHER.has(r.peril) && OUTDOOR_TXT.test(txt)) return false;
    if (neg.has("vehicles") && (r.peril === "gas" || r.peril === "oil") && VEHICLE_TXT.test(txt)) return false;
    if (neg.has("loan") && r.peril === "fed" && LOAN_TXT.test(txt) && !/demand|customer|buyer|homebuyer|applications/i.test(txt)) return false;
    if (neg.has("game") && r.peril === "game") return false;
    // fuel bills are out; a customer-demand story (pump prices squeeze household budgets) is a different exposure
    if (neg.has("costs") && (r.peril === "gas" || r.peril === "oil" || r.peril === "natgas") && !/customer|household|spending|demand/i.test(txt)) return false;
    if (neg.has("events") && /\bACL\b|\bF1\b|formula 1|grand prix|SXSW|rodeo|festival/i.test(txt)) return false;
    if (neg.has("weather") && WEATHER.has(r.peril)) return false;
    // Owner named the weather that hurts ("Rain, Cold"): drop weather risks they didn't pick.
    if (picked && WEATHER.has(r.peril) && !picked.has(r.peril)) return false;
    return true;
  });
}

/** Answers that resize rather than drop: "Half or more" of sales on delivery apps -> rain / cold days cost less (orders move to delivery). */
export function adjustByAnswers<R extends Pick<Risk, "peril" | "lossUsd" | "lossReasoning">>(risks: R[], answers: ClarifyAnswer[] = []): R[] {
  const del = answers.find((a) => questionTopic(a) === "delivery" && !isNegative("delivery", a.answer));
  const share = !del ? 0 : /half|most|majority|[5-9]\d\s*%/i.test(del.answer) ? 0.5 : /quarter|some|2\d\s*%|3\d\s*%/i.test(del.answer) ? 0.25 : 0;
  if (!share) return risks;
  return risks.map((r) => (r.peril === "rain" || r.peril === "cold" || r.peril === "snow")
    ? { ...r, lossUsd: Math.max(10, Math.round((r.lossUsd * (1 - share * 0.6)) / 10) * 10), lossReasoning: `${r.lossReasoning} About ${Math.round(share * 100)}% of sales come through delivery apps, which keep going in bad weather.` }
    : r);
}

// ---------- "already answered" checks + keyword fallback ----------
const NUM = "(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|several|a few)";
/** True when the description/form already answers the topic, so we must not ask it. */
export function alreadyAnswered(topic: ClarifyTopic, p: BusinessProfile): boolean {
  const t = p.description.toLowerCase();
  switch (topic) {
    case "outdoor": return /\d+\s*%[^.]{0,40}(outside|outdoor|patio)|(all|mostly|fully|entirely) (outdoor|outside|indoor)|indoor only|no (outdoor|patio)|(outdoor|patio) (only|seating only)|seats? (are )?(all )?outside/.test(t);
    case "vehicles": return new RegExp(`\\b${NUM}\\s+(?:delivery |work |box |pickup |company )?(?:vans?|trucks?|cars?|vehicles?|bikes?|e-?bikes?)\\b|own (vans?|trucks?|fleet|vehicles?)|third[- ]party|doordash|uber ?eats|no (vans?|vehicles?|trucks?)`).test(t);
    case "loan": return /(fixed|variable|floating|adjustable)[- ]rate|prime \+|sofr|no (loan|debt)/.test(t);
    case "busy-days": return p.busyDays.length > 0 || /weekend|weekday|every ?day|(mon|tue|wed|thu|fri|sat|sun)[a-z]*/.test(t);
    case "game": return /(win|loss|lose|losing|winning)[^.]{0,60}(help|hurt|kill|empt|boost|slow|go home|leave|stay)|(help|hurt|kill)[^.]{0,40}(win|loss|lose)/.test(t);
    case "weather": return /(rain|cold|heat|hot|freez|storm|wind)[^.]{0,40}(stop|shut|cancel|kill|slow|close|can'?t work|hurt|nobody|no one|disappear|dead|empty|lose|lost|drop)/.test(t);
    case "events": case "costs": case "delivery": return discoveryAnswered(topic, p);
    default: return false;
  }
}

const FOOD_OR_BAR = /\b(bar|pub|brew(ery|pub)?|taproom|tavern|saloon|restaurant|cafe|café|coffee shop|diner|bistro|grill|eatery|winery|beer garden|patio|biergarten|bbq|barbecue|pizzeria|bakery)\b/i;
const MOBILE_FOOD = /food truck|taco truck|\bcart\b|trailer|pop-?up/i;
const NEEDS_VEHICLES = /deliver|cater|contractor|roof|plumb|electric(ian|al)|landscap|construction|hvac|moving|mover|courier|lawn|cleaning|pest|handyman|remodel|pool (service|cleaning)|mobile|errand|florist/i;
const LOAN_WORDS = /loan|line of credit|credit line|financing|financed|\bsba\b|mortgage|debt|borrow/i;
const OUTDOOR_TRADE = /roof|landscap|lawn|construction|paint|pool|crew|tour|kayak|paddle|golf|nursery|farm|garden|outdoor (work|job|event)|events? (company|rental)|moving|mover|fence|concrete/i;
const GAME_WORDS = /\b(spurs|texans|cowboys|longhorns|astros|rangers|mavs|mavericks|austin fc|game nights?|watch part(y|ies)|sports bar|game day)\b/i;

/** Deterministic questions when the LLM is unavailable: gap-filling keyword rules + up to 2 discovery questions
 *  (lib/ai/discovery.ts; `markets` = live markets, so we never ask about what nothing can hedge), max 3, [] if none apply. */
export function fallbackQuestions(p: BusinessProfile, markets?: MarketContract[] | null): ClarifyQuestion[] {
  return withDiscovery(gapQuestions(p), p, markets);
}

/** Gap questions (from the LLM or the rules) + discovery questions: <= 3 in all, <= 2 discovery, at least 1 discovery slot. */
export function withDiscovery(gap: ClarifyQuestion[], p: BusinessProfile, markets?: MarketContract[] | null): ClarifyQuestion[] {
  const disc = discoveryQuestions(p, markets, { max: 2, skipTopics: gap.map((q) => questionTopic(q)) });
  const keep = gap.slice(0, 3 - Math.min(disc.length, 1));
  return [...keep, ...disc].slice(0, 3);
}

function gapQuestions(p: BusinessProfile): ClarifyQuestion[] {
  const t = `${p.name} ${p.description}`;
  const out: ClarifyQuestion[] = [];
  const add = (topic: ClarifyTopic, q: Omit<ClarifyQuestion, "id">) => { if (!alreadyAnswered(topic, p)) out.push({ id: topic, ...q }); };
  if (FOOD_OR_BAR.test(t) && !MOBILE_FOOD.test(t)) {
    add("outdoor", { label: "Outdoor seating", question: "How much of your seating is outdoors?", why: "So rain cover fits", options: ["None", "Some", "About half", "Mostly"], allowFreeText: false });
  }
  if (NEEDS_VEHICLES.test(t)) {
    add("vehicles", { label: "Own vehicles", question: "Do you run your own vehicles?", why: "Fuel cover only if you buy fuel", options: ["Yes, vans or trucks", "Yes, cars", "Yes, bikes", "No, third-party"], allowFreeText: true });
  }
  if (LOAN_WORDS.test(t)) {
    add("loan", { label: "Loan rate", question: "Is your loan fixed or variable rate?", why: "Rate cover only helps if it floats", options: ["Fixed", "Variable", "Not sure"], allowFreeText: false });
  }
  if (OUTDOOR_TRADE.test(t)) {
    add("weather", { label: "Weather that stops you", question: "Which weather stops work or kills sales?", why: "So we cover the right weather", options: ["Rain", "Freezing cold", "Extreme heat", "Storms and wind"], allowFreeText: true });
  }
  if (GAME_WORDS.test(t)) {
    add("game", { label: "Game effect", question: "Does a home-team loss hurt your night?", why: "Decides which side we buy", options: ["Yes, people leave early", "A win helps more", "No effect"], allowFreeText: false });
  }
  if (!p.busyDays.length) {
    add("busy-days", { label: "Busy days", question: "Which days are busiest?", why: "So we only cover busy days", options: ["Weekdays", "Fri–Sat", "Weekends", "Every day"], allowFreeText: true });
  }
  return out.slice(0, 3);
}

/** Cleans questions (from the LLM or anywhere): trims, max 3 questions, 2-5 short unique options, no already-answered topics. */
export function normalizeQuestions(qs: ClarifyQuestion[], p: BusinessProfile): ClarifyQuestion[] {
  const seen = new Set<string>();
  const out: ClarifyQuestion[] = [];
  for (const q of qs) {
    const question = q.question.trim().replace(/\s+/g, " ");
    if (question.length < 5) continue;
    const topic = questionTopic(q);
    if (topic !== "other" && alreadyAnswered(topic, p)) continue;
    let id = (topic !== "other" ? topic : q.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) || "q";
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    const options = [...new Set(q.options.map((o) => o.trim()).filter((o) => o && o.length <= 40))].slice(0, 5);
    if (options.length < 2 && !q.allowFreeText) continue;
    const weatherKinds = topic === "weather" && options.filter((o) => WEATHER_WORD.test(o)).length >= 2;
    const multi = !!q.multi || weatherKinds;
    out.push({ id, question: question.slice(0, 120), why: q.why.trim().slice(0, 60), options, allowFreeText: !!q.allowFreeText || options.length < 2, ...(multi ? { multi: true } : {}), label: q.label?.trim().slice(0, 30) || undefined });
    if (out.length === 3) break;
  }
  return out;
}

/** Recap shown on the plan: "Outdoor seating: Mostly · Own vehicles: Yes, 3 vans". */
export function answersRecap(answers: ClarifyAnswer[] = []): string {
  return answers.filter((a) => a.answer.trim()).map((a) => `${a.label ?? a.question.replace(/\?$/, "")}: ${a.answer}`).join(" · ");
}

/** Signature of the profile fields that change the questions (answers cached client-side are reused only while it matches). */
export function profileSig(p: Pick<BusinessProfile, "description" | "busyDays" | "name">): string {
  const s = `${p.name}|${p.description}|${p.busyDays.join(",")}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
