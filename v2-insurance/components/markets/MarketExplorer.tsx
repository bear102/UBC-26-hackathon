"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VenueId } from "@/lib/types";
import type { ExplorerData, ExplorerEvent, RiskGroup } from "@/lib/markets/explorer";
import { fmtChance, fmtDay, fmtDepth, fmtPer1, VENUE_ORDER, VENUES, venueName } from "@/lib/client/venues";
import { VenueBadge } from "./VenueBadge";
import { When } from "./When";
import s from "./markets.module.css";

const GROUPS: { id: RiskGroup | "all"; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "" }, { id: "heat", label: "Heat & cold", icon: "☀" }, { id: "rain", label: "Rain", icon: "☂" },
  { id: "games", label: "Games", icon: "🏀" }, { id: "energy", label: "Oil & gas", icon: "🛢" }, { id: "rates", label: "Rates & inflation", icon: "🏦" },
  { id: "crypto", label: "Crypto", icon: "◎" }, { id: "other", label: "Other", icon: "•" },
];
const PAGE = 30;

export interface ExplorerInitial { risk?: string; city?: string; venue?: string; q?: string; cross?: string }

export function MarketExplorer({ data, initial }: { data: ExplorerData; initial: ExplorerInitial }) {
  const [group, setGroup] = useState<RiskGroup | "all">((GROUPS.find((g) => g.id === initial.risk)?.id ?? "all") as RiskGroup | "all");
  const [city, setCity] = useState(initial.city ?? "");
  const [venues, setVenues] = useState<VenueId[]>(() => {
    const v = (initial.venue ?? "").split(",").filter((x): x is VenueId => x in VENUES);
    return v.length ? v : VENUE_ORDER;
  });
  const [q, setQ] = useState(initial.q ?? "");
  const [cross, setCross] = useState(initial.cross === "1");
  const [shown, setShown] = useState(PAGE);

  // keep the URL shareable
  useEffect(() => {
    const sp = new URLSearchParams();
    if (group !== "all") sp.set("risk", group);
    if (city) sp.set("city", city);
    if (venues.length !== 3) sp.set("venue", venues.join(","));
    if (q) sp.set("q", q);
    if (cross) sp.set("cross", "1");
    const qs = sp.toString();
    window.history.replaceState(null, "", `/markets${qs ? `?${qs}` : ""}`);
    setShown(PAGE);
  }, [group, city, venues, q, cross]);

  const cityApplies = group === "all" || group === "heat" || group === "rain";
  const cityLc = city.toLowerCase();
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => data.events.filter((e) =>
    (group === "all" || e.group === group) &&
    (!cityLc || !cityApplies || e.place.toLowerCase() === cityLc) &&
    e.venues.some((v) => venues.includes(v.venue)) &&
    (!cross || e.venues.length > 1) &&
    (!needle || `${e.title} ${e.place} ${e.venues.map((v) => v.title).join(" ")} ${e.outcomes.map((o) => o.label).join(" ")}`.toLowerCase().includes(needle))
  ), [data.events, group, cityLc, cityApplies, venues, cross, needle]);

  const groupCount = (g: RiskGroup | "all") => data.events.filter((e) => g === "all" || e.group === g).length;
  const crossCount = data.events.filter((e) => e.venues.length > 1).length;
  const toggleVenue = (v: VenueId) => setVenues((vs) => (vs.includes(v) ? (vs.length > 1 ? vs.filter((x) => x !== v) : vs) : [...vs, v].sort((a, b) => VENUE_ORDER.indexOf(a) - VENUE_ORDER.indexOf(b))));

  return (
    <>
      <div className={s.stat}>
        <span><b>{data.total.toLocaleString()}</b> live contracts</span>
        {VENUE_ORDER.map((v) => <span key={v}>{venueName(v)} <b>{data.counts[v].toLocaleString()}</b></span>)}
        <span><b>{crossCount}</b> events listed on 2+ venues</span>
        {data.asOf && <span className="muted">updated <When iso={data.asOf} /></span>}
      </div>

      <div className={s.filters}>
        <div className={s.filterRow} role="group" aria-label="Risk type">
          <label>Risk</label>
          <div className="chips">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" className="chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                {g.icon && <span aria-hidden="true">{g.icon} </span>}{g.label} <span style={{ opacity: 0.6, fontWeight: 500 }}>{groupCount(g.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={s.filterRow} role="group" aria-label="Venues">
          <label>Venues</label>
          <div className="chips">
            {VENUE_ORDER.map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={venues.includes(v)} onClick={() => toggleVenue(v)} title={VENUES[v].desc}>
                {VENUES[v].name} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {VENUES[v].roleLabel}</span>
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={cross} onClick={() => setCross((c) => !c)} title="Only events that trade on more than one venue">Same event on 2+ venues</button>
          </div>
        </div>
        <div className={s.filterRow}>
          <label htmlFor="mx-city">Where</label>
          <select id="mx-city" className={s.input} value={city} onChange={(e) => setCity(e.target.value)} disabled={!cityApplies} title={cityApplies ? "City for weather markets" : "City applies to weather markets"}>
            <option value="">All cities</option>
            {data.places.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {city !== "Austin" && data.places.includes("Austin") && cityApplies && <button type="button" className="chip" onClick={() => setCity("Austin")}>Austin</button>}
          <input className={s.input} type="search" placeholder="Search: Spurs, Brent, CPI…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" style={{ flex: "1 1 220px" }} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No live markets match. {data.total === 0 ? "The venues didn't answer; try again in a minute." : "Try another risk type or turn a venue back on."}</div>
      ) : (
        <div className={s.events}>
          {filtered.slice(0, shown).map((e) => <EventRow key={e.key} e={e} venues={venues} />)}
          {filtered.length > shown && <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</button>}
        </div>
      )}
      <p className="xs muted" style={{ marginTop: 16 }}>
        Chance = midpoint of the buy and sell price. Cost = price of $1 of payout (YES side). For sale = contracts offered at that price, when the venue publishes it.
        Rows are merged when the venues list the same game (same teams and day) or the same city/day/measure; outcomes line up by team or by threshold.
        The AI only ever picks from this list. <Link href="/how-it-works">How venues are used →</Link>
      </p>
    </>
  );
}

function EventRow({ e, venues }: { e: ExplorerEvent; venues: VenueId[] }) {
  const [open, setOpen] = useState(false);
  const cols = e.venues.map((v) => v.venue).filter((v) => venues.includes(v));
  const quoted = e.outcomes.filter((o) => cols.some((v) => o.cells[v]));
  const top = (o: (typeof quoted)[number]) => Math.max(...cols.map((v) => o.cells[v]?.p ?? 0));
  const keep = new Set([...quoted].sort((a, b) => top(b) - top(a)).slice(0, e.peril === "game" ? 3 : 4));
  const outs = open ? e.outcomes : quoted.filter((o) => keep.has(o));
  const multi = cols.length > 1;
  return (
    <article className={s.ev}>
      <div className={s.evHead}>
        <div>
          <h3 className={s.evTitle}>{e.title}</h3>
          <div className={s.evMeta}>
            {[e.place, e.date ? fmtDay(e.date) : ""].filter(Boolean).join(" · ")}{e.expiry && <> · closes <When iso={e.expiry} /></>}
            {e.venues.length > 1 && e.spreadPts != null && <> · <span className={e.spreadPts >= 5 ? s.gap : undefined} style={e.spreadPts < 5 ? { color: "var(--pay)", fontWeight: 650 } : undefined}>{e.spreadPts < 5 ? "markets agree" : `up to ${e.spreadPts} pts apart`}</span></>}
          </div>
        </div>
        <div className={s.evVenues}>
          {e.venues.filter((v) => venues.includes(v.venue)).map((v) => (
            v.url ? <a key={v.venue} href={v.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><VenueBadge venue={v.venue} role={false} /></a> : <VenueBadge key={v.venue} venue={v.venue} role={false} />
          ))}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className={s.grid}>
          <thead>
            <tr>
              <th>{e.peril === "game" ? "Team wins" : "Outcome"}</th>
              {cols.map((v) => <th key={v} className={s[`v_${v}`]}>{venueName(v)}</th>)}
            </tr>
          </thead>
          <tbody>
            {outs.map((o) => (
              <tr key={o.key}>
                <td>{o.label}</td>
                {cols.map((v) => {
                  const c = o.cells[v];
                  return (
                    <td key={v} className={s.cell}>
                      {c ? <><b>{fmtChance(c.p)}</b><span title="cost per $1 of cover">{fmtPer1(c.a)}</span>{c.d != null && multi ? null : c.d != null ? <span title="contracts for sale">{fmtDepth(c.d)}</span> : null}</> : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {e.outcomes.length > outs.length || open ? (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setOpen((x) => !x)}>
          {open ? "Show fewer" : `All ${e.outcomes.length} outcomes`}
        </button>
      ) : null}
    </article>
  );
}
