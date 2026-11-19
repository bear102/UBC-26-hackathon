"use client";
import Link from "next/link";
export function SuiteNav({ here }: { here: "scan" | "promos" | "desk" }) {
  const item = (k: typeof here, href: string, label: string) => (
    <Link href={href} className={`btn ${here === k ? "" : "secondary"}`} style={{ padding: "6px 12px", fontSize: "0.9rem" }}>{label}</Link>
  );
  return (
    <div className="row spread" style={{ marginBottom: 6 }}>
      <div><h1 style={{ margin: 0 }}>Hedgehog</h1><div className="muted small">Prediction markets for small business · odds from Gemini’s live book</div></div>
      <div className="row">{item("scan", "/suite", "Risk Scan")}{item("promos", "/merchant", "Promos")}{item("desk", "/suite/hedge", "Hedge Desk")}</div>
    </div>
  );
}
