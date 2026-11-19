import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Hedgehog — insurance for your worst business day",
  description: "AI-built hedges from live prediction markets (Gemini, Kalshi via Solana), priced like an insurance quote and bought with one signature.",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d5c43" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer className="site-footer">
            <div className="container row between">
              <span>Hedgehog · prediction-market cover for small businesses · Austin, TX</span>
              <span className="row" style={{ gap: 16 }}>
                <Link href="/how-it-works">How it works</Link>
                <span>Prototype on Solana devnet. Not an insurance product; hedges carry basis risk.</span>
              </span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
