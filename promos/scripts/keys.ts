// Generate (once) the devnet keypairs used by Hedgehog and print their pubkeys.
import { pathToFileURL } from "node:url";
import { Keypair } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

export const KEY_NAMES = ["deployer", "merchant", "attestor", "relayer", "crank", "attacker"] as const;
export type KeyName = (typeof KEY_NAMES)[number];
const DIR = path.resolve(process.cwd(), "keys");

export function loadKey(name: KeyName | string): Keypair {
  const p = path.join(DIR, `${name}.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function ensure(name: string): Keypair {
  const p = path.join(DIR, `${name}.json`);
  if (fs.existsSync(p)) return loadKey(name);
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const n of KEY_NAMES) console.log(n.padEnd(9), ensure(n).publicKey.toBase58());
}
