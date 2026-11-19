"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { VenueId } from "@/lib/types";
import type { ExplorerData, ExplorerEvent, RiskGroup } from "@/lib/markets/explorer";
import { fmtChance, fmtDay, fmtDepth, fmtPer1, VENUE_ORDER as VENUE_ORDER_ALL, VENUES, venueName } from "@/lib/client/venues";
import { VenueBadge } from "./VenueBadge";
import { When } from "./When";
import { IconArrowRight, IconChevronDown, IconChevronUp, PerilIcon } from "@/components/Icons";
import s from "./markets.module.css";

const GROUPS: { id: RiskGroup | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "heat", label: "Heat & cold" }, { id: "rain", label: "Rain" },
  { id: "snow", label: "Snow & winter" }, { id: "power", label: "Power & grid" }, { id: "disaster", label: "Water, quakes & storms" },
  { id: "games", label: "Games" }, { id: "energy", label: "Fuel & oil" }, { id: "commodities", label: "Natural gas & metals" },
  { id: "rates", label: "Rates & inflation" }, { id: "crypto", label: "Crypto" }, { id: "parametric", label: "Parametric (Hedgehog)" }, { id: "other", label: "Other" },
];
const PAGE = 30;

export interface ExplorerInitial { risk?: string; city?: string; venue?: string; q?: string; cross?: string }

export function MarketExplorer({ data, initial }: { data: ExplorerData; initial: ExplorerInitial }) {
  // Hedgehog parametric contracts only show up when the server runs with HEDGEHOG_PARAMETRIC=1 (default: real markets only)
  const withParam = (data.counts.hedgehog ?? 0) > 0;
  const VENUE_ORDER = VENUE_ORDER_ALL.filter((v) => v !== "hedgehog" || withParam);
  const groups = GROUPS.filter((g) => g.id !== "parametric" || withParam);
  const [group, setGroup] = useState<RiskGroup | "all">((groups.find((g) => g.id === initial.risk)?.id ?? "all") as RiskGroup | "all");
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
    if (venues.length !== VENUE_ORDER.length) sp.set("venue", venues.join(","));
    if (q) sp.set("q", q);
    if (cross) sp.set("cross", "1");
    const qs = sp.toString();
    window.history.replaceState(null, "", `/markets${qs ? `?${qs}` : ""}`);
    setShown(PAGE);
  }, [group, city, venues, q, cross]);

  const cityApplies = group === "all" || group === "heat" || group === "rain" || group === "snow" || group === "power" || group === "disaster" || group === "parametric";
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
      <p className={s.note}>
        <b>The cheapest venue prices your cover.</b> Kalshi trades on Solana via DFlow.{" "}
        Every hedge is a real market on Gemini, Kalshi or Polymarket.
      </p>
      <div className={s.stat}>
        <div className={s.statMain}><span>Live contracts</span><b className="fig">{data.total.toLocaleString()}</b></div>
        {VENUE_ORDER.map((v) => <div key={v} className={s[`st_${v}`]}><span>{venueName(v)}</span><b className="fig">{data.counts[v].toLocaleString()}</b></div>)}
        <div><span>Events on 2+ venues</span><b className="fig">{crossCount}</b></div>
        {data.asOf && <div className={s.statAsOf}><span>Updated</span><When iso={data.asOf} /></div>}
      </div>

      <section className={`card ${s.filters}`} aria-label="Filter markets">
        <div className="doc-head">
          <span className="caps-title">Search the register</span>
          <span className="meta">{filtered.length.toLocaleString()} of {data.events.length.toLocaleString()} events shown</span>
        </div>
        <div className={s.filterRow} role="group" aria-label="Risk type">
          <label>Risk</label>
          <div className="chips">
            {groups.map((g) => (
              <button key={g.id} type="button" className="chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
                {g.id !== "all" && <PerilIcon peril={g.id} size={15} />}{g.label} <span className={s.count}>{groupCount(g.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={s.filterRow} role="group" aria-label="Venues">
          <label>Venues</label>
          <div className="chips">
            {VENUE_ORDER.map((v) => (
              <button key={v} type="button" className={`chip ${s.venueChip} ${s[`vc_${v}`]}`} aria-pressed={venues.includes(v)} onClick={() => toggleVenue(v)} title={VENUES[v].desc}>
                <span className={s.vdot} aria-hidden="true" />{VENUES[v].name} <span className={s.count}>· {VENUES[v].roleLabel}</span>
              </button>
            ))}
            <button type="button" className="chip" aria-pressed={cross} onClick={() => setCross((c) => !c)} title="Only events that trade on more than one venue">Same event on 2+ venues</button>
          </div>
        </div>
        <div className={s.filterRow}>
          <label htmlFor="mx-city">Where</label>
          <div className={s.whereRow}>
            <select id="mx-city" className={`input ${s.input}`} value={city} onChange={(e) => setCity(e.target.value)} disabled={!cityApplies} title={cityApplies ? "City for weather markets" : "City applies to weather markets"}>
              <option value="">All cities</option>
              {data.places.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {city !== "Austin" && data.places.includes("Austin") && cityApplies && <button type="button" className="chip" onClick={() => setCity("Austin")}>Austin</button>}
            <input className={`input ${s.input} ${s.search}`} type="search" placeholder="Search: Spurs, Brent, snow, ERCOT, Lake Mead…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="empty">No live markets match. {data.total === 0 ? "The venues didn't answer; try again in a minute." : "Try another risk type or turn a venue back on."}</div>
      ) : (
        <div className={s.events}>
          {filtered.slice(0, shown).map((e, i) => <EventRow key={e.key} e={e} venues={venues} ix={i + 1} />)}
          {filtered.length > shown && <button type="button" className={`btn ${s.moreBtn}`} onClick={() => setShown((n) => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</button>}
        </div>
      )}
      <p className={s.footnote}>
        Chance = midpoint price. Cost = price of $1 of payout (YES). The same event on several venues shares one row.
        The AI only picks from this list. <Link href="/how-it-works">How venues are used <IconArrowRight size={12} /></Link>
      </p>
    </>
  );
}

function EventRow({ e, venues, ix }: { e: ExplorerEvent; venues: VenueId[]; ix: number }) {
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
        <span className={s.evIx} aria-hidden="true">{String(ix).padStart(2, "0")}</span>
        <span className={s.evIcon} aria-hidden="true"><PerilIcon peril={e.group} size={18} /></span>
        <div className={s.evMain}>
          <h3 className={s.evTitle}>{e.title}</h3>
          <div className={s.evMeta}>
            {[e.place, e.date ? fmtDay(e.date) : ""].filter(Boolean).join(" · ")}{e.expiry && <> · closes <When iso={e.expiry} /></>}
            {e.venues.length > 1 && e.spreadPts != null && <> · <span className={e.spreadPts >= 5 ? s.gap : s.agreeTag}>{e.spreadPts < 5 ? "markets agree" : `up to ${e.spreadPts} pts apart`}</span></>}
          </div>
        </div>
        <div className={s.evVenues}>
          {e.venues.filter((v) => venues.includes(v.venue)).map((v) => (
            v.url ? <a key={v.venue} href={v.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><VenueBadge venue={v.venue} role={false} /></a> : <VenueBadge key={v.venue} venue={v.venue} role={false} />
          ))}
        </div>
      </div>
      <div className={s.gridWrap}>
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
                      {c ? <><b>{fmtChance(c.p)}</b><span title="cost per $1 of cover">{fmtPer1(c.a)}</span>{c.d != null && multi ? null : c.d != null ? <span title="contracts for sale">{fmtDepth(c.d)}</span> : null}
                        {c.p != null && <i className={s.odd} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, c.p * 100))}%` }} /></i>}</> : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {e.outcomes.length > outs.length || open ? (
        <button type="button" className={`btn btn-ghost btn-sm ${s.evMore}`} onClick={() => setOpen((x) => !x)}>
          {open ? <>Show fewer <IconChevronUp size={14} /></> : <>All {e.outcomes.length} outcomes <IconChevronDown size={14} /></>}
        </button>
      ) : null}
    </article>
  );
}
