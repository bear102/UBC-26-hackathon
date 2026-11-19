// Promo catalog (SPEC §5.1): live Gemini events usable as promo triggers, plus card quoting and templates.
import { searchEvents, book, eventByTicker, richText, type GEvent } from "./gemini";
import { quoteBin, quoteStrip, walkBook, type StripQuote } from "./pricing";
import { env } from "./env";
import type { Card } from "./store";

const TX_NBA = ["SAS", "HOU", "DAL"];
const TEAM_NAMES: Record<string, string> = { SAS: "Spurs", HOU: "Rockets", DAL: "Mavericks", TAMU: "Aggies", TAM: "Aggies", TEX: "Longhorns", TCU: "Horned Frogs", BAY: "Baylor", TTU: "Texas Tech", UH: "Cougars", SMU: "SMU", RICE: "Rice", UTSA: "UTSA" };
const TX_COLLEGE = Object.keys(TEAM_NAMES).filter((k) => !TX_NBA.includes(k));

export type CatalogEvent = GEvent & { kind: "weather" | "game" | "crypto" };

export function kindOf(e: GEvent): CatalogEvent["kind"] | null {
  if (/^WXHIGH-(AUS|SAT)-/.test(e.ticker)) return "weather";
  const m = e.ticker.match(/^(NBA|NCAAM|NCAAF)-\d+-([A-Z]+)-([A-Z]+)-M$/);
  if (m) {
    const teams = [m[2], m[3]];
    if (m[1] === "NBA" ? teams.some((t) => TX_NBA.includes(t)) : teams.some((t) => TX_COLLEGE.includes(t))) return "game";
  }
  if (process.env.HH_ALLOW_CRYPTO === "1" && /^(BTC|ETH|SOL)(05M|15M)?\d{10}$/.test(e.ticker)) return "crypto";
  return null;
}

export async function promoCatalog(): Promise<CatalogEvent[]> {
  const now = Date.now();
  const all = await searchEvents(
    ["Spurs", "Rockets", "Mavericks", "Texas", "Aggies", "TCU", "Baylor", "SMU", "Rice", "UTSA", "Houston", "Austin", "San Antonio"],
    ["category=Weather", ...(process.env.HH_ALLOW_CRYPTO === "1" ? ["category=Crypto"] : [])],
  );
  const out: CatalogEvent[] = [];
  for (const e of all) {
    const k = kindOf(e);
    if (!k) continue;
    if (k === "game" && (!e.startTime || Date.parse(e.startTime) < now + 30 * 60_000)) continue;
    if (e.expiryDate && Date.parse(e.expiryDate) < now + 10 * 60_000) continue;
    if (k === "weather" && process.env.HH_WEATHER_ANYTIME !== "1" && Date.parse(e.expiryDate!) - (10 * 3600 + 59 * 60 + 59) * 1000 < now + 30 * 60_000) continue;
    out.push({ ...e, kind: k });
  }
  return out;
}

export const teamName = (code: string) => TEAM_NAMES[code] ?? code;

/** Times for a promise on this event (unix s): sales close and expected resolve. */
export function promiseTimes(e: GEvent, kind: CatalogEvent["kind"]): { salesClose: number; expectedResolve: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiry = Math.floor(Date.parse(e.expiryDate!) / 1000);
  if (kind === "game") {
    const start = Math.floor(Date.parse(e.startTime!) / 1000);
    return { salesClose: start, expectedResolve: start + Math.round(4.5 * 3600) };
  }
  if (kind === "weather") {
    // sales close at noon CT on the measured day (= expiry date minus ~17h); never later than expiry - 1h
    // expiry is 04:59:59Z the next day = 22:59:59 CST, so noon CST of the measured day = expiry - 10h59m59s
    const noon = expiry - (10 * 3600 + 59 * 60 + 59);
    const close = Math.max(now + 120, Math.min(noon, expiry - 3600));
    return { salesClose: close, expectedResolve: expiry + Math.round(6.5 * 3600) };
  }
  return { salesClose: Math.max(now + 60, expiry - 90), expectedResolve: expiry + 15 * 60 };
}

export type QuotedCard = Card & { quote: StripQuote; scale?: { contracts: number; cost: number; fillable: boolean } | null; salesClose: number; expectedResolve: number; kind: string };

export async function quoteCard(card: Card, k = 1): Promise<QuotedCard> {
  const e = await eventByTicker(card.event_ticker, 15_000);
  const kind = kindOf(e) ?? "game";
  const bins = await Promise.all(card.strip.map(async (s) => quoteBin(s, await book(s).catch(() => ({ bids: [], asks: [] })), env.limitSlippage())));
  const quote = quoteStrip(bins, k);
  let scale = null;
  if (card.strip.length === 1) {
    const b = await book(card.strip[0]).catch(() => ({ bids: [], asks: [] }));
    const w = walkBook(b, 1500);
    scale = { contracts: 1500, cost: w.cost, fillable: w.fillable };
  }
  const first = e.contracts.find((c) => c.instrumentSymbol === card.strip[0]);
  const t = promiseTimes(e, kind);
  return { ...card, event_title: e.title, start_time: e.startTime ?? null, expiry: e.expiryDate, category: e.category, rules_text: richText(first?.description), quote, scale, salesClose: t.salesClose, expectedResolve: t.expectedResolve, kind };
}

/** Template cards (§5.1 T1-T3) built from the live catalog. */
export async function templateCards(cat?: CatalogEvent[]): Promise<Card[]> {
  cat ??= await promoCatalog();
  const cards: Card[] = [];
  const games = cat.filter((e) => e.kind === "game").sort((a, b) => Date.parse(a.startTime!) - Date.parse(b.startTime!));
  for (const g of games) {
    const m = g.ticker.match(/^(NBA|NCAAM|NCAAF)-\d+-([A-Z]+)-([A-Z]+)-M$/)!;
    const home = [m[2], m[3]].find((t) => TX_NBA.includes(t) || TX_COLLEGE.includes(t))!;
    const opp = home === m[2] ? m[3] : m[2];
    const oppC = g.contracts.find((c) => c.instrumentSymbol.endsWith(`-${opp}`));
    if (!oppC || !oppC.prices?.bestAsk) continue;
    cards.push({ event_ticker: g.ticker, event_title: g.title, strip: [oppC.instrumentSymbol], sentence: `${teamName(home)} lose → $1 back`, why: "Game nights fill seats; the promo makes the loss a party.", applies_to: "any draft" });
    if (cards.length >= 1) break;
  }
  const wx = cat.filter((e) => e.kind === "weather" && e.ticker.startsWith("WXHIGH-AUS")).sort((a, b) => Date.parse(a.expiryDate!) - Date.parse(b.expiryDate!))[0];
  if (wx) {
    const bins = wx.contracts.map((c) => ({ s: c.instrumentSymbol, label: c.label, mid: ((Number(c.prices?.bestBid ?? 0) + Number(c.prices?.bestAsk ?? 0)) / 2) || 0, lo: binLow(c.instrumentSymbol) }))
      .sort((a, b) => a.lo - b.lo);
    // split so the cumulative mid of the low side is closest to 50%
    let splitIdx = 1, best = Infinity, cum = 0;
    for (let i = 1; i < bins.length; i++) { cum += bins[i - 1].mid; if (Math.abs(cum - 0.5) < best) { best = Math.abs(cum - 0.5); splitIdx = i; } }
    const lowSide = bins.slice(0, splitIdx), hiSide = bins.slice(splitIdx);
    const x = hiSide[0]?.lo;
    if (lowSide.length && hiSide.length && Number.isFinite(x)) {
      cards.push({ event_ticker: wx.ticker, event_title: wx.title, strip: lowSide.map((b) => b.s), sentence: `Under ${x}°F at the airport → $1 back on iced drinks`, why: "A cool day hurts iced-drink sales; the promo gives people a reason to buy anyway.", applies_to: "iced drinks" });
      cards.push({ event_ticker: wx.ticker, event_title: wx.title, strip: hiSide.map((b) => b.s), sentence: `${x}°F or warmer → $1 back on hot drinks`, why: "A hot day hurts hot-drink sales; the promo keeps them moving.", applies_to: "hot drinks" });
    }
  }
  return cards.slice(0, 3);
}

/** Lower edge in °F of a weather bin symbol (LO65 → -inf, 66TO67 → 66, HI74 → 74). */
export function binLow(sym: string): number {
  const t = sym.split("-").pop()!;
  if (t.startsWith("LO")) return -1000;
  if (t.startsWith("HI")) return Number(t.slice(2));
  const m = t.match(/^(\d+)TO(\d+)$/);
  return m ? Number(m[1]) : NaN;
}
