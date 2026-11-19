// Exposure-discovery questions (pure; shared by the server and the client's mock mode): besides filling gaps in what the
// owner told us, ask about up to 2 exposures they may not have mentioned (game days, big local events, fuel / propane
// costs, delivery-app share, weather that cancels work), chosen by business type + location + which live markets exist
// (never ask about something no market can hedge). Answers flow through the existing clarify pipeline
// (clarifyRules: answerFacts / suppressByAnswers / adjustByAnswers); gameDayRisks() adds the game risks a
// "More customers on game days" answer implies.
import type { BusinessProfile, ClarifyAnswer, ClarifyQuestion, MarketContract, Risk } from "../types";

/** Local teams per city that live game markets list (labels are often the school / city: "Texas", "San Antonio"). */
export interface LocalTeam { nick: string; label: RegExp; teamWord: RegExp }
const LOCAL_TEAMS: Record<string, LocalTeam[]> = {
  austin: [{ nick: "Longhorns", label: /^texas( longhorns)?$/i, teamWord: /\blonghorns\b|\bUT (football|game)/i }],
  "san antonio": [{ nick: "Spurs", label: /^san antonio( spurs)?$|^spurs$/i, teamWord: /\bspurs\b/i }],
  houston: [{ nick: "Texans", label: /^houston( texans)?$|^texans$/i, teamWord: /\btexans\b/i }, { nick: "Rockets", label: /^houston( rockets)?$|^rockets$/i, teamWord: /\brockets\b/i }],
  dallas: [{ nick: "Cowboys", label: /^dallas( cowboys)?$|^cowboys$/i, teamWord: /\bcowboys\b/i }, { nick: "Mavericks", label: /^dallas( mavericks)?$|^mavericks$/i, teamWord: /\bmav(ericks|s)\b/i }],
};
const ALL_TEAMS = Object.values(LOCAL_TEAMS).flat();
export const cityKey = (city: string) => city.split(",")[0].trim().toLowerCase();
export function localTeams(city: string): LocalTeam[] { return LOCAL_TEAMS[cityKey(city)] ?? []; }

const EVENT_RE = /\bACL\b|austin city limits|formula 1|\bF1\b|grand prix|\bCOTA\b|SXSW|south by|rodeo/i;
const EVENT_NAME: [RegExp, string][] = [[/\bACL\b|austin city limits/i, "ACL"], [/formula 1|\bF1\b|grand prix|\bCOTA\b/i, "F1"], [/SXSW|south by/i, "SXSW"], [/rodeo/i, "the rodeo"]];

/** What live markets can hedge for this city (null markets = unknown: assume games, fuel and rain exist; events don't). */
export interface MarketHints { teams: LocalTeam[]; fuel: boolean; rain: boolean; events: string[] }
export function marketHints(markets: MarketContract[] | null | undefined, city: string): MarketHints {
  const teams = localTeams(city);
  if (!markets) return { teams, fuel: true, rain: true, events: [] };
  const open = markets.filter((m) => m.status === "open");
  const ck = cityKey(city);
  const events = EVENT_NAME.filter(([re]) => open.some((m) => re.test(`${m.eventTitle} ${m.label}`))).map(([, n]) => n);
  return {
    teams: teams.filter((t) => open.some((m) => m.peril === "game" && t.label.test(m.label.trim()))),
    fuel: open.some((m) => m.peril === "gas" || m.peril === "oil" || m.peril === "natgas"),
    rain: open.some((m) => m.peril === "rain" && (m.location ?? "").toLowerCase().includes(ck)),
    events,
  };
}

// business types that each exposure applies to
const GAMEDAY_BIZ = /food truck|taco|trailer|\bbars?\b|\bpub\b|brew(ery|pub)?|taproom|tavern|sports|\bwings?\b|pizza|\bbbq\b|barbecue|burger|restaurant|\bgrill\b|parking|rideshare|hotel|airbnb|vrbo|short-term rental|merch|jerseys?|tailgat|liquor|beer|ice ?house/i;
const EVENT_BIZ = GAMEDAY_BIZ;
const COST_BIZ = /food truck|taco|trailer|generator|\bbbq\b|barbecue|smoker|restaurant|bakery|pizza|cater/i;
const DELIVERY_BIZ = /restaurant|pizza|\bwings?\b|burger|thai|sushi|ramen|takeout|take-out|chinese|indian|kitchen/i;
const WEATHER_BIZ = /\bevents?\b|wedding|part(y|ies)|festival|\btours?\b|outdoor|farmers? market|\bfarm\b|photograph/i;
const MOBILE_FOOD = /food truck|taco truck|\bcart\b|trailer|pop-?up/i;

/** Already said in the description (never ask it). Discovery topics only; gap topics live in clarifyRules.alreadyAnswered. */
export function discoveryAnswered(topic: "game" | "events" | "costs" | "delivery" | "weather", p: BusinessProfile): boolean {
  const t = p.description;
  switch (topic) {
    case "game": return ALL_TEAMS.some((x) => x.teamWord.test(t)) || /game (day|night)s?|watch part|sports bar/i.test(t);
    case "events": return EVENT_RE.test(t) || /festival/i.test(t);
    case "costs": return /fuel|propane|diesel|gas(oline)? (price|cost|bill)|food cost|ingredient|commodit|generator|\bvans?\b|fleet|vehicles/i.test(t);
    case "delivery": return /deliver|doordash|uber ?eats|grubhub|third[- ]party|takeout only/i.test(t);
    case "weather": return /rain|weather|storm|cold|heat|\bhot\b|freez|wind|snow|indoor only/i.test(t);
  }
}

/** Up to `max` discovery questions (best first). `skipTopics` = topics already being asked. */
export function discoveryQuestions(p: BusinessProfile, markets?: MarketContract[] | null, opts: { max?: number; skipTopics?: string[] } = {}): ClarifyQuestion[] {
  const t = `${p.name} ${p.description}`;
  const hints = marketHints(markets, p.city);
  const skip = new Set(opts.skipTopics ?? []);
  const out: ClarifyQuestion[] = [];
  const add = (topic: string, q: ClarifyQuestion) => { if (!skip.has(topic)) { out.push(q); skip.add(topic); } };
  if (hints.teams.length && GAMEDAY_BIZ.test(t) && !discoveryAnswered("game", p)) {
    const names = hints.teams.slice(0, 2).map((x) => x.nick).join(" or ");
    add("game", { id: "game-days", label: `${names} game days`, question: `Do ${names} game days change your sales?`, why: "So we cover game days", options: ["More customers", "Fewer customers", "No difference"], allowFreeText: false });
  }
  if (hints.events.length && EVENT_BIZ.test(t) && !discoveryAnswered("events", p)) {
    const names = hints.events.slice(0, 2).join(" or ");
    add("events", { id: "events", label: "Big events", question: `Do big events like ${names} change your sales?`, why: "So we cover event weeks", options: ["More customers", "Fewer customers", "No difference"], allowFreeText: false });
  }
  if (hints.rain && WEATHER_BIZ.test(t) && !discoveryAnswered("weather", p)) {
    add("weather", { id: "weather-cancel", label: "Weather cancels work", question: "Does bad weather cancel or slow your work?", why: "So rain cover fits", options: ["Often", "Sometimes", "Rarely"], allowFreeText: false });
  }
  if (hints.fuel && COST_BIZ.test(t) && !discoveryAnswered("costs", p)) {
    add("costs", { id: "costs", label: "Fuel and propane", question: "Do fuel or propane costs squeeze you?", why: "So fuel cover fits", options: ["Yes, a lot", "A little", "No"], allowFreeText: false });
  }
  if (hints.rain && DELIVERY_BIZ.test(t) && !MOBILE_FOOD.test(t) && !discoveryAnswered("delivery", p)) {
    add("delivery", { id: "delivery", label: "Delivery apps", question: "How much of your sales come from delivery apps?", why: "Rain moves orders to delivery", options: ["Under 10%", "About a quarter", "Half or more"], allowFreeText: false });
  }
  return out.slice(0, opts.max ?? 2);
}

/** Team nicknames named in a question / answer ("Do Longhorns game days ..."). */
export function teamsInText(text: string): LocalTeam[] {
  return ALL_TEAMS.filter((x) => new RegExp(`\\b${x.nick}\\b`, "i").test(text));
}

/** "More customers on game days" -> the next game for each named team becomes an event risk: a loss costs home
 *  playoff / bowl game days (season futures come from horizon.futuresFallbackRisks via the answer's fact). */
export function gameDayRisks(profile: BusinessProfile, answers: ClarifyAnswer[], markets: MarketContract[], now = new Date()): Omit<Risk, "id">[] {
  const more = answers.filter((a) => /^game-days/.test(a.questionId) && /\bmore\b|busier|boost|helps?/i.test(a.answer));
  if (!more.length) return [];
  const d = profile.avgDailyRevenueUsd;
  const out: Omit<Risk, "id">[] = [];
  for (const team of teamsInText(more.map((a) => `${a.question} ${a.label ?? ""}`).join(" "))) {
    const games = markets.filter((m) => m.peril === "game" && m.status === "open" && team.label.test(m.label.trim()) && /\s(vs\.?|at|@)\s/i.test(m.eventTitle)
      && Date.parse(m.expiry) > now.getTime() && Date.parse(m.expiry) - now.getTime() < 10 * 86_400_000)
      .sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry));
    const g = games[0];
    if (!g) continue;
    const opp = g.eventTitle.split(/\s(?:vs\.?|at|@)\s/i).map((x) => x.trim()).find((x) => !team.label.test(x)) ?? "their opponent";
    const day = new Date(g.expiry).toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" });
    out.push({ peril: "game", kind: "direct", title: `${team.nick} lose to ${opp}`, trigger: `${g.label.trim()} lose to ${opp} (${day})`, location: profile.city.split(",")[0].trim(),
      window: day, lossUsd: Math.max(10, Math.round((d * 0.5) / 10) * 10), confidence: 0.45,
      lossReasoning: `Game days bring more customers. A loss now can cost the late-season home game days (playoff / bowl): about half of a $${Math.round(d).toLocaleString("en-US")} day.` });
  }
  return out;
}
