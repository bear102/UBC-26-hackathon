// Turn raw server / program / network errors into short plain words with a next step.
// Returns null when the message isn't one we recognise (callers fall back to walletErrorMessage).
import { usd } from "./format";

export function friendlyError(e: unknown): string | null {
  const m = e instanceof Error ? e.message : String(e ?? "");
  const budget = m.match(/BudgetExceeded:\s*([\d.]+)\s*already spent[^+]*\+\s*([\d.]+)\s*>\s*([\d.]+)/i);
  if (budget) {
    const [, spent, , cap] = budget.map(Number);
    return `You've used ${usd(spent, 2)} of your ${usd(cap)} budget this month. Cover fewer risks or raise your budget.`;
  }
  if (/BudgetExceeded|budget_exceeded/i.test(m)) return "This would go over your monthly budget. Cover fewer risks or raise your budget.";
  if (/InsufficientCapacity|insufficient_capacity/i.test(m)) return "Hedgehog can't take on that much cover right now. Try fewer risks or a lower coverage level.";
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNREFUSED/i.test(m)) return "Couldn't reach Hedgehog. Check your connection and try again.";
  return null;
}

/** friendlyError, else the given fallback mapper (e.g. walletErrorMessage), else the raw message. */
export function plainError(e: unknown, fallback?: (e: unknown) => string): string {
  return friendlyError(e) ?? (fallback ? fallback(e) : e instanceof Error ? e.message : String(e));
}
