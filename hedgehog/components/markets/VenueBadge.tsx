import type { VenueId } from "@/lib/types";
import { VENUES } from "@/lib/client/venues";
import s from "./markets.module.css";

/**
 * The one venue badge used everywhere: "Gemini · Primary · hedged", "Kalshi · Buyable", "Polymarket · Reference only".
 * `role={false}` shows just the name (dense tables); the role is still in the tooltip.
 */
export function VenueBadge({ venue, role = true, className = "" }: { venue: VenueId | string; role?: boolean; className?: string }) {
  const v = VENUES[venue as VenueId];
  if (!v) return <span className={`badge badge-neutral ${className}`}>{venue}</span>;
  return (
    <span className={`badge ${v.cls} ${className}`} title={`${v.name} · ${v.roleLabel}. ${v.desc}`}>
      {v.name}{role && <span style={{ fontWeight: 500, opacity: 0.8 }}>· {v.roleLabel}</span>}
    </span>
  );
}

/** Legend of the three roles (how-it-works, explorer header). */
export function VenueLegend({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={compact ? s.legendCompact : s.legendList}>
      {(Object.keys(VENUES) as VenueId[]).map((id) => (
        <li key={id}>
          <span className={s.legendBadge}><VenueBadge venue={id} /></span>
          {!compact && <span className={s.legendDesc}>{VENUES[id].desc}</span>}
        </li>
      ))}
    </ul>
  );
}
