"use client";
// Demo mode ONLY while the URL carries `?mock=1` (never persisted). Live data everywhere else.
const LEGACY_KEY = "hh.mock"; // older builds persisted demo mode; clear it and any demo quotes it cached

export function initMockFromUrl() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem("hh.mockPositions");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("hh.quote.") && !k.endsWith(".last") && (localStorage.getItem(k) ?? "").includes('"model":"fixture')) localStorage.removeItem(k);
    }
  } catch {}
}

export function isMock(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("mock") === "1";
}

export const DEMO_EVENT = "hh-demo-data";
export function flagDemo(what: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: what }));
}
