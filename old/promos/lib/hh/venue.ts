// Per-promise venue. `data` = where odds/catalog come from (production). `trade` = where the agent can place orders
// (GEMINI_TRADE_BASE, e.g. the sandbox). A promise is `live` only if every strip symbol is listed on the trade venue
// and keys A+B exist; otherwise it is `paper` (simulated against the data venue's book, labelled PAPER).
// `resolve` = the venue whose resolution settles the promise (the venue it was hedged on).
import { env } from "./env";
import { eventByTicker } from "./gemini";
import * as G from "./geminiPrivate";

export type Venue = { data: string; trade: string; mode: "live" | "paper"; resolve: string; why?: string };

export const liveCapable = () =>
  process.env.HEDGE_MODE === "live" || (process.env.HEDGE_MODE !== "paper" && G.hasKeys("A") && G.hasKeys("B"));

export const hostOf = (base: string) => base.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
export const isSandbox = (base: string) => /sandbox/.test(base);

export async function venueFor(ticker: string, strip: string[]): Promise<Venue> {
  const data = env.geminiPublic(), trade = env.geminiTrade();
  if (!liveCapable()) return { data, trade, mode: "paper", resolve: data, why: "no Gemini trading keys" };
  try {
    const e = await eventByTicker(ticker, 15_000, trade);
    const syms = new Set(e.contracts.map((c) => c.instrumentSymbol));
    if (e.status === "active" && strip.every((s) => syms.has(s))) return { data, trade, mode: "live", resolve: trade };
    return { data, trade, mode: "paper", resolve: data, why: `not tradeable on ${hostOf(trade)}` };
  } catch {
    return { data, trade, mode: "paper", resolve: data, why: `not listed on ${hostOf(trade)}` };
  }
}

/** Venue of a stored promise (records created before venues existed are inferred from their order ids). */
export function venueOf(rec: { venue?: Venue; id: string }, orderIds: string[] = []): Venue {
  if (rec.venue) return rec.venue;
  const data = env.geminiPublic(), trade = env.geminiTrade();
  const paper = !orderIds.length || orderIds.some((o) => o.startsWith("PAPER-"));
  return paper ? { data, trade, mode: "paper", resolve: data } : { data, trade, mode: "live", resolve: trade };
}
/** Base URL for books/events used for hedging this promise. */
export const bookBase = (v: Venue) => (v.mode === "live" ? v.trade : v.data);
