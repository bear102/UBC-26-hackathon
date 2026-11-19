// Suite UI smoke test: Risk Scan → Hedge it → Hedge Desk quote → Buy → visible result or error.
// Usage: node scripts/ui/suite.mjs [BASE=http://localhost:5393] [OUTDIR=.data/shots] [--auth]
//   --auth: expect HH_ADMIN_TOKEN to be set on the server and check the 401 banner appears instead of a blank page.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const AUTH = process.argv.includes("--auth");
const BASE = args[0] || "http://localhost:5393";
const OUT = args[1] || ".data/shots";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const errors = [], log = [];
p.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const step = (s) => { log.push(s); console.log("·", s); };
const shot = (n) => p.screenshot({ path: `${OUT}/suite-${n}.png`, fullPage: true });
let ok = true;
try {
  await p.goto(`${BASE}/suite`, { waitUntil: "domcontentloaded" });
  await p.getByRole("button", { name: "Coffee cart near UT" }).click();
  step("clicked Coffee cart preset");
  await p.waitForTimeout(1500);
  const stage = await p.getByTestId("scan-stage").textContent().catch(() => null);
  step(`stage hint while busy: ${stage}`);
  await shot("1-scanning");
  if (AUTH) {
    await p.getByTestId("login-banner").waitFor({ timeout: 95_000 });
    step("401 login banner visible");
    await shot("auth-401");
    await p.locator('[data-testid=login-banner] input').fill(process.env.HH_ADMIN_TOKEN || "x");
    await p.getByRole("button", { name: "Log in" }).click();
    step("pasted token → login sets the cookie and the scan retries by itself");
  }
  await Promise.race([
    p.getByTestId("risk-row").first().waitFor({ timeout: 95_000 }),
    p.getByTestId("error-box").waitFor({ timeout: 95_000 }).then(async () => { throw new Error("scan error: " + await p.getByTestId("error-box").textContent()); }),
  ]);
  const n = await p.getByTestId("risk-row").count();
  step(`rows: ${n}`);
  await shot("2-rows");
  // Prefer a row tradeable on the Gemini sandbox (LIVE pill), else the first hedgeable row.
  const liveRow = p.getByTestId("risk-row").filter({ hasText: "LIVE ·" }).filter({ has: p.locator("a", { hasText: "Hedge it" }) });
  const hedge = (await liveRow.count()) ? liveRow.first().locator("a", { hasText: "Hedge it" }) : p.locator("a", { hasText: "Hedge it" }).first();
  step(`hedge link: ${await hedge.getAttribute("href")}`);
  await hedge.click();
  await p.waitForURL(/\/suite\/hedge/);
  await Promise.race([
    p.getByTestId("premium").waitFor({ timeout: 60_000 }),
    p.getByTestId("error-box").waitFor({ timeout: 60_000 }).then(async () => { throw new Error("quote error: " + await p.getByTestId("error-box").textContent()); }),
  ]);
  step(`premium: ${await p.getByTestId("premium").textContent()}  cover: ${await p.locator('input[type=number]').first().inputValue()}`);
  await p.waitForTimeout(800);
  step(`buy disabled reason (empty max): ${await p.getByTestId("buy-why").textContent().catch(() => "(none)")}`);
  await p.locator('label:has-text("Most I") input').fill("0.5");
  step(`buy disabled reason ($0.50): ${await p.getByTestId("buy-why").textContent().catch(() => "(none)")}`);
  await shot("3-quote-low-max");
  const use = p.locator("a", { hasText: /^use \$/ });
  if (await use.count()) { await use.click(); step(`clicked ${await use.textContent()}`); }
  const btn = p.getByRole("button", { name: /Buy cover/ });
  step(`buy button enabled: ${await btn.isEnabled()}  reason: ${await p.getByTestId("buy-why").textContent().catch(() => "(none)")}`);
  if (await btn.isEnabled()) {
    await btn.click();
    await Promise.race([p.getByTestId("error-box").waitFor({ timeout: 95_000 }), p.getByTestId("ticket").first().waitFor({ timeout: 95_000 })]);
    const e = await p.getByTestId("error-box").textContent().catch(() => null);
    step(e ? `buy result (error shown): ${e}` : `buy result: ticket shown · ${await p.getByTestId("buy-outcome").textContent().catch(() => "")}`);
  }
  await shot("4-after-buy");
} catch (e) { ok = false; step(`FAIL: ${e.message}`); await shot("fail").catch(() => {}); }
console.log(JSON.stringify({ ok, errors }, null, 1));
await b.close();
process.exit(ok ? 0 : 1);
