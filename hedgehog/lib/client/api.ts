"use client";
// Typed client for the Hedgehog API. Reads fall back to fixtures on failure (and always in mock mode).
import type { BusinessProfile, ClarifyAnswer, ClarifyQuestion, FeedEvent, MarketContract, Position, Quote } from "@/lib/types";
import { fallbackQuestions } from "@/lib/ai/clarifyRules";
import {
  FIXTURE_MARKETS, FIXTURE_PRESETS, fixtureCoverInfo, fixtureFeed, fixturePolicies, fixturePositions, fixtureQuote,
  type CoverInfo, type CoverPolicy, type Preset,
} from "@/lib/fixtures";
import { flagDemo, isMock } from "./mode";
import type { Coverage } from "./quote";

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "") || `${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

/** Demo fixtures only in explicit `?mock=1` mode; otherwise live data, and failures surface as errors (never fake data). */
async function withFallback<T>(what: string, real: () => Promise<T>, fake: () => T): Promise<T> {
  if (isMock()) { flagDemo(what); await sleep(250); return fake(); }
  return real();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const getPresets = () =>
  withFallback<Preset[]>("presets", async () => {
    const r = await call<Preset[]>("/api/presets");
    if (!Array.isArray(r) || r.length === 0) throw new Error("no presets");
    return r;
  }, () => FIXTURE_PRESETS);

export const advise = (profile: BusinessProfile, coveragePct: Coverage, answers?: ClarifyAnswer[]) =>
  withFallback<Quote>("advise", () => call<Quote>("/api/advise", post({ profile, coveragePct, ...(answers ? { answers } : {}) })),
    () => ({ ...fixtureQuote(profile, coveragePct), ...(answers ? { clarifications: answers } : {}) }));

/** The AI's 0-3 quick questions for this business. Never throws: any failure (or a 15 s wait) means "no questions". */
export async function adviseQuestions(profile: BusinessProfile): Promise<ClarifyQuestion[]> {
  if (isMock()) return fallbackQuestions(profile);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    const r = await call<{ questions?: ClarifyQuestion[] }>("/api/advise/questions", { ...post({ profile }), signal: ctl.signal }).finally(() => clearTimeout(t));
    return Array.isArray(r?.questions) ? r.questions.slice(0, 3) : [];
  } catch (e) { console.warn("questions skipped", e); return []; }
}

export const getMarkets = (peril?: string) =>
  withFallback<MarketContract[]>("markets", () => call<MarketContract[]>(`/api/markets${peril ? `?peril=${encodeURIComponent(peril)}` : ""}`),
    () => FIXTURE_MARKETS.filter((m) => !peril || m.peril === peril));

export const getPositions = (owner: string) =>
  withFallback<Position[]>("positions", () => call<Position[]>(`/api/positions?owner=${encodeURIComponent(owner)}`), () => [...mockPositions(), ...fixturePositions(owner)]);

export const getFeed = (since?: string) =>
  withFallback<FeedEvent[]>("feed", () => call<FeedEvent[]>(`/api/feed${since ? `?since=${encodeURIComponent(since)}` : ""}`), () => fixtureFeed());

export const getPolicies = (owner: string) =>
  withFallback<CoverPolicy[]>("policies", async () => {
    const r = await call<unknown>(`/api/cover/policies?owner=${encodeURIComponent(owner)}`);
    const rows = (Array.isArray(r) ? r : (r as { policies?: unknown[] })?.policies ?? []) as Record<string, unknown>[];
    return rows.map((p) => ({
      ...p,
      policyId: String(p.policyId ?? ""),
      policyPda: (p.policyPda ?? p.pda) as string | undefined,
      businessId: (p.businessId ?? undefined) as string | undefined,
      trigger: (p.trigger ?? undefined) as string | undefined,
      txSig: (p.txSig ?? undefined) as string | undefined,
    })) as CoverPolicy[];
  }, () => fixturePolicies());

export const getCoverInfo = () => withFallback<CoverInfo>("cover-info", () => call<CoverInfo>("/api/cover/info"), () => fixtureCoverInfo());

// --- writes (no silent fallback: a failed buy must be shown as failed) ---
export type HedgeBuyReq = { owner: string; contractId: string; side: "yes" | "no"; contracts: number; businessId: string; maxCostUsd?: number };
export type HedgeBuyRes = { positionId: string; txBase64: string; network: "devnet" | "mainnet" };
export const hedgeBuy = (b: HedgeBuyReq) => call<HedgeBuyRes>("/api/hedge/buy", post(b));
/** The desk's backing order on Gemini for a Gemini-priced sale (dry-run unless the server runs HEDGE_LIVE=1). */
export type DeskHedge = {
  id: string; kind: "position" | "policy"; refId: string; owner?: string; contractId: string; eventTitle?: string; label?: string; url?: string;
  symbol: string; outcome: "yes" | "no"; quantity: number; limitPrice: number; refAsk: number; notionalUsd: number;
  soldForUsd?: number; marginUsd?: number; mode: "dry-run" | "live"; status: string; orderId?: string; error?: string; createdAt: string;
};
export const hedgeConfirm = (positionId: string, signature: string) => call<Position & { backing?: DeskHedge }>("/api/hedge/confirm", post({ positionId, signature }));
export const getBacking = (owner: string) =>
  withFallback<{ live: boolean; hedges: DeskHedge[] }>("backing", () => call(`/api/hedge/backing?owner=${encodeURIComponent(owner)}`), () => ({ live: false, hedges: [] }));

export type CoverBuyReq = { owner: string; businessId: string; peril: string; marketRef: string; trigger: string; premiumUsd: number; payoutUsd: number; expiry: string; side?: "yes" | "no" };
export type CoverBuyRes = { policyId: string; policyPda: string; txBase64: string };
export const coverBuy = (b: CoverBuyReq) => call<CoverBuyRes>("/api/cover/buy", post(b));
export const coverConfirm = (policyPda: string, signature: string) => call<{ backing?: DeskHedge }>("/api/cover/confirm", post({ policyPda, signature }));

/** Devnet demo faucet: tops the wallet up to $50 test dollars + fee SOL. Never throws (mainnet / real-USDC setups just skip). */
export async function devnetFaucet(owner: string): Promise<void> {
  try { await call<unknown>("/api/hedge/faucet", post({ owner })); } catch (e) { console.warn("faucet skipped", e); }
}

// Mock-mode positions created by simulated checkouts (so the dashboard reflects them).
const MOCK_POS = "hh.mockPositions";
export function mockPositions(): Position[] {
  try { return JSON.parse(localStorage.getItem(MOCK_POS) ?? "[]") as Position[]; } catch { return []; }
}
export function addMockPosition(p: Position) {
  try { localStorage.setItem(MOCK_POS, JSON.stringify([p, ...mockPositions()])); } catch {}
}
