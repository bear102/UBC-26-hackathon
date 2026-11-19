// UI smoke test: screenshots + console errors for each page. Usage: node shots.mjs BASE PROMISE_ID OUTDIR
import { chromium, devices } from "playwright";
const [BASE, PID, OUT] = process.argv.slice(2);
const b = await chromium.launch();
const errors = [];
async function shot(ctx, path, name, waitText, actions) {
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`${name}: PAGEERROR ${e.message}`));
  await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
  if (waitText) await p.getByText(waitText, { exact: false }).first().waitFor({ timeout: 60000 }).catch(() => errors.push(`${name}: never saw "${waitText}"`));
  if (actions) await actions(p);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  return p;
}
const desk = await b.newContext({ viewport: { width: 1280, height: 900 } });
await shot(desk, "/merchant", "merchant", "Your promises");
await shot(desk, `/merchant/p/${PID}`, "console", "Capacity");
await shot(desk, `/p/${PID}`, "public", "Attestation timeline");
// counter: needs a session cookie set by the console action
const cp = await desk.newPage();
await cp.goto(BASE + `/merchant/p/${PID}`);
await cp.evaluate(async (id) => fetch(`/api/promises/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "counter" }) }), PID);
const counter = await shot(desk, `/counter/${PID}`, "counter-idle", "");
const btn = counter.getByRole("button", { name: "New sale" });
let url = null;
if (await btn.count()) {
  await btn.click();
  await counter.waitForTimeout(1500);
  await counter.screenshot({ path: `${OUT}/counter-qr.png` });
  url = await counter.evaluate(async (id) => { const r = await fetch("/api/counter/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ promiseId: id }) }); return (await r.json()).url; }, PID);
}
const phone = await b.newContext({ ...devices["iPhone 13"] });
if (url) await shot(phone, new URL(url).pathname, "receipt", "comes back to you");
await shot(phone, "/w", "wallet", "My receipts");
console.log(JSON.stringify({ errors, url }, null, 1));
await b.close();
