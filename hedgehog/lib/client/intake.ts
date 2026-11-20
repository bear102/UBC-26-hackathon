// Intake form checks, kept in step with /api/advise's limits so a quote never dies on "invalid input".
export const MAX_DESC = 2000;

/** The first problem with the owner's details, or null when they can be quoted. */
export function intakeError(f: { description: string; name: string; zip: string; revenue: number; budget: number }): string | null {
  const d = f.description.trim();
  if (d.length < 12) return "Tell us a bit more (one sentence is enough).";
  if (d.length > MAX_DESC) return `Keep the description under ${MAX_DESC.toLocaleString("en-US")} characters.`;
  if (!f.name.trim()) return "Add a business name.";
  if (!/^\d{5}$/.test(f.zip.trim())) return "Enter a 5-digit US ZIP code (US businesses only for now).";
  if (!(f.revenue > 0)) return "Average daily revenue must be a positive number.";
  if (f.revenue > 10_000_000) return "Average daily revenue must be under $10 million.";
  if (!(f.budget > 0)) return "Monthly hedge budget must be a positive number.";
  if (f.budget > 1_000_000) return "Monthly hedge budget must be under $1 million.";
  return null;
}
