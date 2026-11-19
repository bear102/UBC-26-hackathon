export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/hh/engine");
    startWorker();
    // Suite: warm the Risk Scan catalog so the first scan on stage is fast (never blocks startup).
    import("./lib/hh/exposure").then(({ prewarmSuite }) => prewarmSuite({ keepWarm: true })).catch(() => {});
  }
}
