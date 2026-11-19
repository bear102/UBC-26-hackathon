"use client";
// Demo-mode flag: `?mock=1` (persisted in localStorage, `?mock=0` clears) and a "fell back to demo data" signal.
const KEY = "hh.mock";

export function initMockFromUrl() {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search).get("mock");
  try {
    if (p === "1") localStorage.setItem(KEY, "1");
    if (p === "0") localStorage.removeItem(KEY);
  } catch {}
}

export function isMock(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("mock") === "1") return true;
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export const DEMO_EVENT = "hh-demo-data";
export function flagDemo(what: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: what }));
}
