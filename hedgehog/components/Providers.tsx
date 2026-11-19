"use client";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import "@solana/wallet-adapter-react-ui/styles.css";
import { DEVNET_RPC } from "@/lib/client/tx";
import { initMockFromUrl } from "@/lib/client/mode";

// Wallets are discovered via the Wallet Standard (Phantom, Solflare, Backpack, MetaMask's Solana support, ...),
// so we register NO legacy adapters: a hard-coded PhantomWalletAdapter duplicated Phantom's own Standard wallet
// and could make connect() fail with "WalletConnectionError: Unexpected error".
const WALLET_KEY = "walletName"; // localStorage key used by @solana/wallet-adapter-react

/** Auto-connect only to a wallet the user connected successfully before (never on first visit). */
async function shouldAutoConnect(adapter: Adapter): Promise<boolean> {
  try { return localStorage.getItem("hh.walletOk") === adapter.name; } catch { return false; }
}

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [], []);
  useEffect(() => { initMockFromUrl(); }, []);
  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    console.warn("[wallet]", error.name, error.message, adapter?.name);
    // Don't let a failed connection auto-retry on every page load.
    try { localStorage.removeItem(WALLET_KEY); localStorage.removeItem("hh.walletOk"); } catch { /* storage blocked */ }
  }, []);
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect={shouldAutoConnect} onError={onError}>
        <WalletModalProvider>
          <RememberGoodWallet />
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

/** Marks the wallet as OK once a connection succeeds, enabling auto-connect next visit. */
function RememberGoodWallet() {
  const { connected, wallet } = useWallet();
  useEffect(() => {
    if (connected && wallet) { try { localStorage.setItem("hh.walletOk", wallet.adapter.name); } catch { /* ignore */ } }
  }, [connected, wallet]);
  return null;
}
