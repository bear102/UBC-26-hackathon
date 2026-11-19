import { Suspense } from "react";
import { PlanView } from "@/components/PlanView";

export const metadata = { title: "Your hedge plan — Hedgehog" };

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="section"><div className="container"><div className="empty">Loading your plan…</div></div></div>}>
      <PlanView />
    </Suspense>
  );
}
