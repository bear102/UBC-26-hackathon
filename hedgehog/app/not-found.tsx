import Link from "next/link";
import { IconArrowRight } from "@/components/Icons";

export const metadata = { title: "Page not found — Hedgehog" };

export default function NotFound() {
  return (
    <section className="section"><div className="container narrow">
      <div className="card card-dashed stack">
        <span className="eyebrow">404</span>
        <h2 style={{ margin: 0 }}>This page doesn&apos;t <em>exist</em></h2>
        <p className="muted" style={{ margin: 0 }}>The link may be old or mistyped.</p>
        <div><Link className="btn btn-primary" href="/">Back to home <IconArrowRight size={16} /></Link></div>
      </div>
    </div></section>
  );
}
