// Ops CLI. The worker itself (hedge agent, attestor, relayer, cranker) runs INSIDE the Next server process
// (instrumentation.ts), so the JSON store has a single writer. This CLI only talks to that running server over HTTP.
// Usage (any OS):  npm run worker -- status
//                  npm run worker -- <promiseId> <hedge|attest-open|attest-cutoff|relay|crank|release|close-receipts|stop-agent|resume-agent>
import "../lib/hh/env";

const BASE = (process.env.HH_LOCAL_URL || "http://localhost:5380").replace(/\/$/, "");
const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.HH_ADMIN_TOKEN) headers["x-hh-admin"] = process.env.HH_ADMIN_TOKEN;
const [a, b] = process.argv.slice(2);

async function main() {
  if (!a || a === "status") {
    const r = await fetch(`${BASE}/api/promises`, { headers }).then((x) => x.json());
    console.log(`agent ${r.agent?.halted ? `HALTED (${r.agent.haltReason})` : "running"} · budget today $${r.budget?.spent ?? 0}`);
    for (const p of r.promises ?? []) console.log(`${p.id}  ${String(p.status).padEnd(16)} ${p.card.sentence}  (premium $${p.premium})`);
    const cfg = await fetch(`${BASE}/api/config`).then((x) => x.json());
    console.log(`hedge mode ${cfg.hedgeMode} · merchant ${cfg.merchant} · rpc ${cfg.rpc}`);
    return;
  }
  if (!b) throw new Error("usage: npm run worker -- <promiseId> <action>");
  const r = await fetch(`${BASE}/api/promises/${a}/action`, { method: "POST", headers, body: JSON.stringify({ action: b }) });
  console.log(r.status, JSON.stringify(await r.json(), null, 1));
}

main().catch((e) => {
  console.error(`Is the app running at ${BASE}? (npm run dev / npm start)\n`, e);
  process.exitCode = 1;
});
