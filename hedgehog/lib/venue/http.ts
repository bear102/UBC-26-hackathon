// Small helpers shared by the venue API routes.
import { NextResponse } from "next/server";
import { VenueError } from "./types";

export function errorResponse(e: unknown) {
  if (e instanceof VenueError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  const msg = (e as Error)?.message ?? String(e);
  console.error("[venue]", msg);
  return NextResponse.json({ error: msg, code: "internal" }, { status: 500 });
}
