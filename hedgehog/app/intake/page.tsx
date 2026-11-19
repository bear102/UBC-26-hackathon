import { Suspense } from "react";
import { IntakeForm } from "@/components/IntakeForm";

export const metadata = { title: "Tell us about your business — Hedgehog" };

export default function IntakePage() {
  return (
    <section className="section">
      <div className="container narrow">
        <Suspense fallback={<div className="empty">Loading the proposal form…</div>}>
          <IntakeForm />
        </Suspense>
      </div>
    </section>
  );
}
