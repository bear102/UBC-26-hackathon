import type { VenueId } from "@/lib/types";
import { VENUES } from "@/lib/client/venues";
import { VenueBadge } from "./VenueBadge";
import { IconArrowRight } from "@/components/Icons";

/** "Price from <venue> · Backed on <venue> (order recorded)" — one line per position/policy, same badges as the plan. */
export function Provenance({ venue, backing }: {
  venue?: string | null;
  backing?: { mode: "dry-run" | "live"; status: string; venue?: string } | null;
}) {
  const v = venue && venue in VENUES ? (venue as VenueId) : null;
  // the backing order's own venue (DeskHedge.venue) wins over the pricing venue
  const bv = backing?.venue && backing.venue in VENUES ? (backing.venue as VenueId) : v;
  if (!v) return null;
  if (v === "hedgehog") return (
    <div className="row xs" style={{ gap: 6, margin: "10px 0 0", alignItems: "center", fontFamily: "var(--mono)", letterSpacing: ".04em" }}>
      <VenueBadge venue={v} role={false} /><span className="muted">Underwritten by the Hedgehog pool · no exchange backing</span>
    </div>
  );
  // Backing is placed on the venue that priced the cover (best price). Only Gemini can ever go live; others are recorded plans.
  return (
    <div className="row xs" style={{ gap: 6, margin: "10px 0 0", alignItems: "center", letterSpacing: ".02em" }}>
      <span className="muted">Price from</span><VenueBadge venue={v} role={false} />
      {backing && <>
        <IconArrowRight size={12} className="muted" />
        <span className="muted">Backed on</span>
        <span className={`badge ${VENUES[bv ?? v].cls}`}>{VENUES[bv ?? v].name} · {backing.mode === "live" ? backing.status : backing.status === "error" ? "not placed" : "test order"}</span>
      </>}
    </div>
  );
}

/** Venue of a contract id ("gemini:…" / "kalshi:…" / "polymarket:…"). */
export const venueOfId = (id?: string | null) => (id ? id.slice(0, Math.max(0, id.indexOf(":"))) || null : null);
