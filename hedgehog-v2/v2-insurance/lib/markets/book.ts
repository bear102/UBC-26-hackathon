// Ask ladders per side for any venue, used by sizing to walk the book.
import type { MarketContract } from "../types";
import { book as geminiBook } from "./geminiPm";
import { kalshiBook, type BookLevels } from "./dflow";

export type { BookLevels };

/** Gemini books are YES-only: YES asks = asks; NO asks = 1 - YES bids. */
export function geminiLevels(b: { bids: { price: string; amount: string }[]; asks: { price: string; amount: string }[] }): BookLevels {
  const lv = (xs: { price: string; amount: string }[], flip: boolean) => xs
    .map((l) => ({ price: Math.round((flip ? 1 - Number(l.price) : Number(l.price)) * 10000) / 10000, size: Number(l.amount) }))
    .filter((l) => l.price > 0 && l.price < 1 && l.size > 0)
    .sort((a, b) => a.price - b.price);
  return { yes: lv(b.asks ?? [], false), no: lv(b.bids ?? [], true) };
}

/** Live ask ladders for a contract, or null when the venue has no public book. */
export async function getBook(c: MarketContract): Promise<BookLevels | null> {
  try {
    if (c.venue === "gemini") return geminiLevels(await geminiBook(c.symbol));
    if (c.venue === "kalshi") return await kalshiBook(c.symbol);
  } catch { /* depth unknown */ }
  return null;
}

export const depthAt = (levels: { price: number; size: number }[], maxPrice: number) =>
  levels.filter((l) => l.price <= maxPrice + 1e-9).reduce((s, l) => s + l.size, 0);
