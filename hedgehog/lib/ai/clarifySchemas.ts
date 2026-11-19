// Request schemas for the clarify flow (shared by /api/advise and /api/advise/questions).
import { z } from "zod/v4";

export const answersSchema = z.array(z.object({
  questionId: z.string().trim().min(1).max(40),
  question: z.string().trim().min(1).max(160),
  answer: z.string().trim().max(120),
  label: z.string().trim().max(30).optional(),
})).max(5);

export const clarifyProfileSchema = z.object({
  id: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(3).max(2000),
  city: z.string().trim().max(80).default("Austin, TX"),
  zip: z.string().trim().max(10).optional(),
  avgDailyRevenueUsd: z.coerce.number().positive().max(10_000_000),
  busyDays: z.array(z.string().trim().max(12)).max(7).default([]),
  monthlyBudgetUsd: z.coerce.number().min(0).max(1_000_000),
  presetId: z.string().trim().max(80).optional(),
});
