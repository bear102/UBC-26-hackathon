import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuestions, suppressByAnswers, weatherPerilsIn } from "../lib/ai/clarifyRules";

const profile = { id: "t", name: "Hot dog cart", description: "Hot dog cart downtown", city: "Austin, TX", avgDailyRevenueUsd: 800, busyDays: ["Fri", "Sat"], monthlyBudgetUsd: 100 };
const risk = (peril: string, title: string) => ({ peril, title, trigger: title, lossReasoning: "" }) as any;
const ans = (answer: string) => [{ questionId: "weather", question: "Which weather actually stops people buying hot dogs?", answer }];

test("weather-kind questions become multi-select", () => {
  const [q] = normalizeQuestions([{ id: "weather", question: "Which weather actually stops people buying hot dogs?", why: "So we cover the right risks", options: ["Rain", "Heat", "Cold", "Storms", "None"], allowFreeText: false }], profile as any);
  assert.equal(q.multi, true);
  const [f] = normalizeQuestions([{ id: "weather", question: "Does bad weather cancel your work?", why: "x", options: ["Often", "Sometimes", "Rarely"], allowFreeText: false }], profile as any);
  assert.equal(f.multi, undefined); // frequency question stays single-choice
});

test("picked weather keeps only those weather risks; None drops all", () => {
  const risks = [risk("rain", "Rainy Saturday"), risk("heat", "Hot Friday"), risk("cold", "Cold snap"), risk("game", "Spurs lose")];
  assert.deepEqual(weatherPerilsIn("Rain, Cold"), new Set(["rain", "cold", "snow"]));
  assert.deepEqual(suppressByAnswers(risks, ans("Rain, Cold")).map((r: any) => r.peril), ["rain", "cold", "game"]);
  assert.deepEqual(suppressByAnswers(risks, ans("None")).map((r: any) => r.peril), ["game"]);
});
