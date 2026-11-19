"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { DemoWalletName, hasDemoWallet } from "@/lib/client/demoWallet";

/** "Create demo wallet": a devnet burner wallet in this browser, for trying Hedgehog without Phantom/MetaMask. */
export function DemoWalletButton() {
  const { connected, connecting, select } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [existing, setExisting] = useState(false);
  useEffect(() => { setMounted(true); setExisting(hasDemoWallet()); }, []);
  if (!mounted || connected) return null;
  return (
    <button type="button" className="btn btn-sm" aria-label={existing ? "Use demo wallet" : "Create demo wallet"} disabled={connecting} onClick={() => select(DemoWalletName)}
      title="A test wallet stored in this browser (devnet only). Funded automatically when you buy.">
      <span className="hide-m">{existing ? "Use demo wallet" : "Create demo wallet"}</span>
      <span className="show-m" aria-hidden="true">Demo</span>
    </button>
  );
}
