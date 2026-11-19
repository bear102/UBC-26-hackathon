"use client";
import type { BusinessProfile, ClarifyAnswer, ClarifyQuestion, Quote } from "@/lib/types";
import { profileSig } from "@/lib/ai/clarifyRules";

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

/** Clarifying questions + answers per business (so a refresh doesn't re-ask). Ignored once the profile text changes. */
export type StoredClarify = { sig: string; questions: ClarifyQuestion[]; answers: ClarifyAnswer[]; at: string };
export const saveClarify = (p: BusinessProfile, questions: ClarifyQuestion[], answers: ClarifyAnswer[]) =>
  set(`hh.clarify.${p.id}`, { sig: profileSig(p), questions, answers, at: new Date().toISOString() } satisfies StoredClarify);
export function loadClarify(p: BusinessProfile): StoredClarify | null {
  const c = get<StoredClarify>(`hh.clarify.${p.id}`);
  return c && c.sig === profileSig(p) ? c : null;
}
/** Drop cached quotes for a business (its answers changed, so every coverage level must be re-run). */
export function clearQuotes(id: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(`hh.quote.${id}.`)) localStorage.removeItem(k);
    }
  } catch {}
}
