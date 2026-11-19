import { Suspense } from "react";
import { PlanView } from "@/components/PlanView";

export const metadata = { title: "Your hedge plan — Hedgehog" };

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="container section"><div className="card">Loading…</div></div>}>
      <PlanView />
    </Suspense>
  );
}
