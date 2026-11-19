import type { VenueId } from "@/lib/types";
import { VENUES } from "@/lib/client/venues";
import { VenueBadge } from "./VenueBadge";
import { IconArrowRight } from "@/components/Icons";

/** "Price from <venue> · Backed on <venue> (order recorded)" — one line per position/policy, same badges as the plan. */
export function Provenance({ venue, backing }: {
  venue?: string | null;
  backing?: { mode: "dry-run" | "live"; status: string } | null;
}) {
  const v = venue && venue in VENUES ? (venue as VenueId) : null;
  if (!v) return null;
  // Backing is placed on the venue that priced the cover (best price). Only Gemini can ever go live; others are recorded plans.
  const backed = backing
    ? <span className={`badge ${VENUES[v].cls}`}>{VENUES[v].name} · {backing.mode === "live" ? backing.status : backing.status === "error" ? "not placed" : "order recorded (demo)"}</span>
    : <span className="muted">{VENUES[v].name} order not recorded yet</span>;
  return (
    <div className="row xs" style={{ gap: 6, margin: "10px 0 0", alignItems: "center", fontFamily: "var(--mono)", letterSpacing: ".04em" }}>
      <span className="muted">Price from</span><VenueBadge venue={v} />
      <IconArrowRight size={12} className="muted" />
      <span className="muted">Backed on</span>{backed}
    </div>
  );
}

/** Venue of a contract id ("gemini:…" / "kalshi:…" / "polymarket:…"). */
export const venueOfId = (id?: string | null) => (id ? id.slice(0, Math.max(0, id.indexOf(":"))) || null : null);
