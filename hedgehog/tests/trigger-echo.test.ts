import { test } from "node:test";
import assert from "node:assert/strict";
import { marketWordedTriggers } from "../lib/ai/advisor";
import type { QuoteLine, Risk } from "../lib/types";

test("QA #9: prompt instructions echoed into a trigger are replaced by the real contract and strike", () => {
  const risk = { id: "r1", peril: "rain", kind: "proxy", title: "Wet November in Houston",
    trigger: "Houston November 2026 total rainfall finishes above the chosen inches strike (pick a rung priced 5-60 cents)" } as unknown as Risk;
  const line = { riskId: "r1", contracts: 77, side: "yes",
    contract: { id: "kalshi:KXRAINHOUM-26NOV-4", eventTitle: "Rain in Houston in Nov 2026?", label: "Above 4 inches" } } as unknown as QuoteLine;
  marketWordedTriggers([risk], [line]);
  assert.equal(risk.trigger, "Rain in Houston in Nov 2026: Above 4 inches");

  const ok = { ...risk, id: "r2", trigger: "Measurable rain at Austin-Bergstrom on Sat, Nov 21" } as Risk;
  marketWordedTriggers([ok], [{ ...line, riskId: "r2" } as QuoteLine]);
  assert.equal(ok.trigger, "Measurable rain at Austin-Bergstrom on Sat, Nov 21"); // a plain trigger is left alone
});
