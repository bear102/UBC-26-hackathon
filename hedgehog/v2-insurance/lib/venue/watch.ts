// What the QuickNode webhook watches: mock outcome mints, the desk, and outcome mints of any stored position (incl. DFlow).
import { store } from "../store";
import { deskKeypair } from "./desk";
import { MintRegistry } from "./mints";
import type { QnWatch } from "./qnParse";
import idl from "../solana/idl/hedgehog_policy.json";

export function currentWatch(): QnWatch {
  const mints = new MintRegistry().mintSet();
  const positionIds = new Set<string>();
  for (const p of store.list("positions")) { positionIds.add(p.id); if (p.mint) mints.add(p.mint); }
  const accounts = new Set<string>();
  try { accounts.add(deskKeypair().publicKey.toBase58()); } catch { /* no desk yet */ }
  const programs = new Set<string>([(idl as { address: string }).address]); // Hedgehog Cover program
  return { mints, accounts, positionIds, programs };
}
