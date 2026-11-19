"use client";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter, WalletError } from "@solana/wallet-adapter-base";
import "@solana/wallet-adapter-react-ui/styles.css";
import { usePathname, useRouter } from "next/navigation";
import { DEVNET_RPC } from "@/lib/client/tx";
import { initMockFromUrl } from "@/lib/client/mode";
import { DemoWalletAdapter, DemoWalletName } from "@/lib/client/demoWallet";
import { devnetFaucet } from "@/lib/client/api";

// Wallets are discovered via the Wallet Standard (Phantom, Solflare, Backpack, MetaMask's Solana support, ...),
// so we register NO legacy adapters: a hard-coded PhantomWalletAdapter duplicated Phantom's own Standard wallet
// and could make connect() fail with "WalletConnectionError: Unexpected error".
const WALLET_KEY = "walletName"; // localStorage key used by @solana/wallet-adapter-react

/** Page-load auto-connect only to a wallet that connected successfully before (a failed one must not retry on every load).
 *  Picking a wallet in the modal connects immediately via ConnectOnSelect. */
async function shouldAutoConnect(adapter: Adapter): Promise<boolean> {
  try { return localStorage.getItem("hh.walletOk") === adapter.name; } catch { return false; }
}

export function Providers({ children }: { children: ReactNode }) {
  // Real wallets come from Wallet Standard; the only adapter we register is the devnet demo (burner) wallet.
  const wallets = useMemo(() => [new DemoWalletAdapter()], []);
  useEffect(() => { initMockFromUrl(); }, []);
  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    console.warn("[wallet]", error.name, error.message, adapter?.name, "| wallet said:", (error as { error?: unknown }).error);
    // Don't let a failed connection auto-retry on every page load.
    try { localStorage.removeItem(WALLET_KEY); localStorage.removeItem("hh.walletOk"); } catch { /* storage blocked */ }
  }, []);
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect={shouldAutoConnect} onError={onError}>
        <WalletModalProvider>
          <RememberGoodWallet />
          <FundDemoWallet />
          <ConnectOnSelect />
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

/** One-step connect: when the user picks a wallet in the modal, connect right away (no extra "Connect" click).
 *  The wallet restored from storage on page load is left to autoConnect above. */
function ConnectOnSelect() {
  const { wallet, connected, connecting, connect } = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const prev = useRef<string | null | undefined>(undefined);
  const userPicked = useRef(false);
  useEffect(() => {
    const name = wallet?.adapter.name ?? null;
    const first = prev.current === undefined;
    const changed = !first && name !== prev.current;
    prev.current = name;
    if (changed && name && !connected && !connecting) {
      userPicked.current = true;
      connect().catch(() => { userPicked.current = false; /* surfaced via onError */ });
    }
  }, [wallet, connected, connecting, connect]);
  // After a user-initiated connect from the landing page, go straight to the business scan (intake).
  // Not on page-load auto-connects, and not mid-checkout on other pages.
  useEffect(() => {
    if (connected && userPicked.current) {
      userPicked.current = false;
      if (pathname === "/") router.push("/intake");
    }
  }, [connected, pathname, router]);
  return null;
}

/** A fresh demo wallet doesn't exist onchain until something is sent to it ("Account not found" on Explorer).
 *  Fund it (test dollars + fee SOL) as soon as it connects, once per browser session. */
function FundDemoWallet() {
  const { connected, wallet, publicKey } = useWallet();
  useEffect(() => {
    if (!connected || !publicKey || wallet?.adapter.name !== DemoWalletName) return;
    const key = `hh.demoFunded.${publicKey.toBase58()}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
    devnetFaucet(publicKey.toBase58()).catch(() => {});
  }, [connected, wallet, publicKey]);
  return null;
}
