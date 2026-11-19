"use client";
import { useEffect, useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"; // ships with @solana/wallet-adapter-wallets; importing it directly avoids bundling WalletConnect
import "@solana/wallet-adapter-react-ui/styles.css";
import { DEVNET_RPC } from "@/lib/client/tx";
import { initMockFromUrl } from "@/lib/client/mode";

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  useEffect(() => { initMockFromUrl(); }, []);
  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
