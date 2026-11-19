import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bricolage_Grotesque, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

// Display font for h1/h2 only: bold, upright, very legible. Body and labels stay IBM Plex Sans.
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Hedgehog — insurance for your worst business day",
  description: "AI-built cover for small businesses, priced from live Gemini, Kalshi and Polymarket markets and bought with one Solana signature.",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F3EEE1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${plexMono.variable}`}>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer className="site-footer">
            <div className="container inner">
              <span>Hedgehog · worst-day cover for small business · Austin, TX</span>
              <span className="foot-r">
                <Link href="/how-it-works">How it works</Link>
                <span>Devnet prototype. Not a licensed insurance product. Hedges carry basis risk.</span>
              </span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
