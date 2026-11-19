import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bodoni_Moda, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

const bodoni = Bodoni_Moda({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-bodoni", display: "swap" });
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Hedgehog — insurance for your worst business day",
  description: "AI-built hedges from live prediction markets (Gemini, Kalshi via Solana), priced like an insurance quote and bought with one signature.",
  icons: { icon: "/favicon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#F3EEE1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodoni.variable} ${archivo.variable} ${plexMono.variable}`}>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <footer className="site-footer">
            <div className="container inner">
              <span>Hedgehog · worst-day cover for small business · Austin, TX</span>
              <span className="foot-r">
                <Link href="/how-it-works">How it works</Link>
                <span>Devnet prototype · not a licensed insurance product; hedges carry basis risk</span>
              </span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
