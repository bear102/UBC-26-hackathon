"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { DemoWalletButton } from "./DemoWalletButton";
import { OddsTicker } from "./OddsTicker";
import { DEMO_EVENT, isMock } from "@/lib/client/mode";

// "Get a quote" lands on the home page's business picker (#pick), not the hero.
const LINKS = [
  { href: "/#pick", match: "/", label: "Get a quote" },
  { href: "/markets", match: "/markets", label: "Markets" },
  { href: "/dashboard", match: "/dashboard", label: "My cover" },
  { href: "/how-it-works", match: "/how-it-works", label: "How it works" },
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
  // Already on the home page: Next won't re-scroll to the same hash, so do it ourselves.
  const toPick = (e: React.MouseEvent, href: string) => {
    if (href !== "/#pick" || path !== "/") return;
    const el = document.getElementById("pick");
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", "/#pick");
  };
  const active = (h: string) => (h === "/" ? ["/", "/intake", "/plan"].includes(path ?? "") : path?.startsWith(h));
  return (
    <>
      <OddsTicker />
      <header className="site-header">
        <div className="container inner">
          <Link href="/" className="brand" aria-label="Hedgehog home"><Logo /> <span>Hedgehog</span></Link>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => <Link key={l.href} href={l.href} onClick={(e) => toPick(e, l.href)} aria-current={active(l.match) ? "page" : undefined}>{l.label}</Link>)}
          </nav>
          <div className="header-right">
            <span className="badge badge-devnet" title="Solana devnet, test USDC">Devnet</span>
            <DemoWalletButton />
            <WalletButton />
          </div>
        </div>
        <nav className="mobile-nav" aria-label="Main (mobile)">
          {LINKS.map((l) => <Link key={l.href} href={l.href} onClick={(e) => toPick(e, l.href)} aria-current={active(l.match) ? "page" : undefined}>{l.label}</Link>)}
        </nav>
      </header>
    </>
  );
}
