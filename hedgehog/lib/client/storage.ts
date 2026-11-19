"use client";
import type { BusinessProfile, Quote } from "@/lib/types";

const get = <T,>(k: string): T | null => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
};
const set = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const saveProfile = (p: BusinessProfile) => set(`hh.profile.${p.id}`, p);
export const loadProfile = (id: string) => get<BusinessProfile>(`hh.profile.${id}`);
export const saveQuote = (q: Quote, pct: number) => { set(`hh.quote.${q.businessId}.${pct}`, q); set(`hh.quote.${q.businessId}.last`, { pct }); };
export const loadQuote = (id: string, pct: number) => get<Quote>(`hh.quote.${id}.${pct}`);
export const lastQuotePct = (id: string) => get<{ pct: number }>(`hh.quote.${id}.last`)?.pct ?? null;
export const setLastBusiness = (id: string) => set("hh.lastBusiness", id);
export const lastBusiness = () => get<string>("hh.lastBusiness");
export const setLastOwner = (o: string) => set("hh.lastOwner", o);
export const lastOwner = () => get<string>("hh.lastOwner");

/** All quotes we have stored (for dashboard "lost $X" lookups). */
export function allStoredQuotes(): Quote[] {
  const out: Quote[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^hh\.quote\..+\.\d+$/.test(k)) { const q = get<Quote>(k); if (q) out.push(q); }
    }
  } catch {}
  return out;
}
