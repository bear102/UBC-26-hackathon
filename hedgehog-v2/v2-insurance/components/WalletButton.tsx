"use client";
import dynamic from "next/dynamic";

// The wallet button reads window/localStorage — client-only to avoid hydration mismatches.
export const WalletButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <span className="wallet-placeholder" aria-hidden="true" /> },
);
