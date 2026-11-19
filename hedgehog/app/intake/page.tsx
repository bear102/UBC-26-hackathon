import { Suspense } from "react";
import { IntakeForm } from "@/components/IntakeForm";

export const metadata = { title: "Tell us about your business — Hedgehog" };

export default function IntakePage() {
  return (
    <section className="container narrow section">
      <Suspense fallback={<div className="card">Loading…</div>}>
        <IntakeForm />
      </Suspense>
    </section>
  );
}
