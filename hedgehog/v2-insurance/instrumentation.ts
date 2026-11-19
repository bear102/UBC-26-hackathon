// Next.js server start hook: keep the live-market cache warm so /markets (and the AI's market search) never waits on a
// cold pass over Gemini, Kalshi and Polymarket (~20s). Shared cache lives on globalThis (lib/markets/*).
// NOTE: the server-only import must sit INSIDE the NEXT_RUNTIME === "nodejs" branch, or the edge build tries to
// bundle node:fs (lib/env.ts) and every route 500s.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.HH_NO_WARM === "1") return;
    const g = globalThis as { __hhWarmer?: ReturnType<typeof setInterval> };
    if (g.__hhWarmer) return; // dev reloads re-run register()
    const { warmExplorer } = await import("./lib/markets/explorer");
    const tick = () => { warmExplorer().catch(() => undefined); };
    tick();
    g.__hhWarmer = setInterval(tick, 50_000);
    g.__hhWarmer.unref?.();
  }
}
