"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { DEMO_EVENT, isMock } from "@/lib/client/mode";

const LINKS = [
  { href: "/", label: "Get a quote" },
  { href: "/markets", label: "Markets" },
  { href: "/dashboard", label: "My cover" },
  { href: "/how-it-works", label: "How it works" },
];

export function Header() {
  const path = usePathname();
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    setDemo(isMock());
    const on = () => setDemo(true);
    window.addEventListener(DEMO_EVENT, on);
    return () => window.removeEventListener(DEMO_EVENT, on);
  }, []);
  const active = (h: string) => (h === "/" ? ["/", "/intake", "/plan"].includes(path ?? "") : path?.startsWith(h));
  return (
    <header className="site-header">
      <div className="container inner">
        <Link href="/" className="brand" aria-label="Hedgehog home"><Logo /> <span>Hedgehog</span></Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}>{l.label}</Link>)}
        </nav>
        <div className="header-right">
          {demo && <span className="badge badge-demo hide-sm" title="Some data on this page is demo/fixture data (API unavailable or ?mock=1)">Demo data</span>}
          <span className="badge badge-devnet" title="All onchain actions run on Solana devnet with test USDC"><span className="dot" /> Devnet</span>
          <WalletButton />
        </div>
      </div>
      <nav className="mobile-nav" aria-label="Main (mobile)">
        {LINKS.map((l) => <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}>{l.label}</Link>)}
      </nav>
    </header>
  );
}
