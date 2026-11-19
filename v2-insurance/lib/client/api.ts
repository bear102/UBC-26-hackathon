"use client";
// Typed client for the Hedgehog API. Reads fall back to fixtures on failure (and always in mock mode).
import type { BusinessProfile, FeedEvent, MarketContract, Position, Quote } from "@/lib/types";
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

async function withFallback<T>(what: string, real: () => Promise<T>, fake: () => T, opts?: { fallbackOnError?: boolean }): Promise<T> {
  if (isMock()) { flagDemo(what); await sleep(250); return fake(); }
  try { return await real(); }
  catch (e) {
    if (opts?.fallbackOnError === false) throw e;
    console.warn(`[hedgehog] ${what} failed, using demo data`, e);
    flagDemo(what);
    return fake();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const getPresets = () =>
  withFallback<Preset[]>("presets", async () => {
    const r = await call<Preset[]>("/api/presets");
    if (!Array.isArray(r) || r.length === 0) throw new Error("no presets");
    return r;
  }, () => FIXTURE_PRESETS);

export const advise = (profile: BusinessProfile, coveragePct: Coverage) =>
  withFallback<Quote>("advise", () => call<Quote>("/api/advise", post({ profile, coveragePct })), () => fixtureQuote(profile, coveragePct));

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
    return Array.isArray(r) ? (r as CoverPolicy[]) : [];
  }, () => fixturePolicies());

export const getCoverInfo = () => withFallback<CoverInfo>("cover-info", () => call<CoverInfo>("/api/cover/info"), () => fixtureCoverInfo());

// --- writes (no silent fallback: a failed buy must be shown as failed) ---
export type HedgeBuyReq = { owner: string; contractId: string; side: "yes" | "no"; contracts: number; businessId: string };
export type HedgeBuyRes = { positionId: string; txBase64: string; network: "devnet" | "mainnet" };
export const hedgeBuy = (b: HedgeBuyReq) => call<HedgeBuyRes>("/api/hedge/buy", post(b));
export const hedgeConfirm = (positionId: string, signature: string) => call<Position>("/api/hedge/confirm", post({ positionId, signature }));

export type CoverBuyReq = { owner: string; businessId: string; peril: string; marketRef: string; trigger: string; premiumUsd: number; payoutUsd: number; expiry: string };
export type CoverBuyRes = { policyId: string; policyPda: string; txBase64: string };
export const coverBuy = (b: CoverBuyReq) => call<CoverBuyRes>("/api/cover/buy", post(b));

// Mock-mode positions created by simulated checkouts (so the dashboard reflects them).
const MOCK_POS = "hh.mockPositions";
export function mockPositions(): Position[] {
  try { return JSON.parse(localStorage.getItem(MOCK_POS) ?? "[]") as Position[]; } catch { return []; }
}
export function addMockPosition(p: Position) {
  try { localStorage.setItem(MOCK_POS, JSON.stringify([p, ...mockPositions()])); } catch {}
}
