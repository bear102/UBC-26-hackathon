import { json, err } from "@/lib/hh/http";
import { config } from "@/lib/hh/views";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return json(config()); } catch (e) { return err(String((e as Error).message ?? e), 500); }
}
