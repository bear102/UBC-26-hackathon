import { json } from "@/lib/hh/http";
import { config } from "@/lib/hh/views";
export const dynamic = "force-dynamic";
export async function GET() { return json(config()); }
