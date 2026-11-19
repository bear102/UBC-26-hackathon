// Dev override for Hedgehog parametric contracts (demo / testing): force a resolution without waiting for the weather.
//   npx tsx scripts/parametric-force.ts <contract id | prefix*> yes|no     e.g. hedgehog:hail:austin-tx:25:20261119-20261125 yes
//   npx tsx scripts/parametric-force.ts <contract id | prefix*> clear
//   npx tsx scripts/parametric-force.ts list
// Writes .data/parametric-overrides.json; getContract() (app + `npm run worker`) reads it on every call, so the next
// crank pass settles open Cover policies on that contract. Ignored when NODE_ENV=production unless PARAMETRIC_OVERRIDES=1.
import "../lib/env";
import { overridesEnabled, overridesFile, readOverrides, writeOverride } from "../lib/markets/parametric/settle";
import { getParametric } from "../lib/markets/parametric";

async function main() {
  const [key, v] = process.argv.slice(2);
  if (!key || key === "list") { console.log(overridesFile(), readOverrides()); return; }
  if (!key.startsWith("hedgehog:")) throw new Error("key must be a hedgehog:* contract id or prefix*");
  if (v !== "yes" && v !== "no" && v !== "clear") throw new Error("value must be yes | no | clear");
  writeOverride(key, v === "clear" ? null : v);
  console.log(`${v === "clear" ? "cleared" : `forced ${v.toUpperCase()}`}: ${key}${overridesEnabled() ? "" : " (overrides DISABLED: NODE_ENV=production without PARAMETRIC_OVERRIDES=1)"}`);
  if (!key.endsWith("*")) {
    const c = await getParametric(key);
    console.log(c ? `now: status=${c.status} resolution=${c.resolution ?? "-"} | ${c.label}` : "unknown contract id");
  }
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
