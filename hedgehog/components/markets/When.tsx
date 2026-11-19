"use client";
import { useEffect, useState } from "react";
import { fmtExpiry } from "@/lib/client/venues";

/** Expiry in the viewer's own timezone (server render uses US Central, then swaps in after mount). */
export function When({ iso, prefix = "" }: { iso?: string; prefix?: string }) {
  const [tz, setTz] = useState<string | undefined>(undefined);
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* keep Central */ } }, []);
  if (!iso) return <span>—</span>;
  return <time dateTime={iso} suppressHydrationWarning>{prefix}{fmtExpiry(iso, tz)}</time>;
}
