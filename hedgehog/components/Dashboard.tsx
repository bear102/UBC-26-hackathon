"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { FeedEvent, MarketContract, Position, QuoteLine, Risk } from "@/lib/types";
import { getBacking, getFeed, getMarkets, getPolicies, getPositions, type DeskHedge } from "@/lib/client/api";
import { isMock } from "@/lib/client/mode";
import { allStoredQuotes, lastOwner, setLastOwner } from "@/lib/client/storage";
import { DEMO_OWNER, type CoverPolicy } from "@/lib/fixtures";
import { cents, explorerTx, orderText, shortAddr, shortDate, timeAgo, usd, VENUE_LABEL } from "@/lib/client/format";
import { PolicyStory, PositionStory } from "./explain/PositionStory";
import { PastQuotes } from "./PastQuotes";
import { TaxRecord } from "./TaxRecord";
import { HeadsUp } from "./plan/HeadsUp";
import { DemoWalletButton } from "./DemoWalletButton";
import { venueName } from "@/lib/client/venues";
import { Provenance, venueOfId } from "./markets/Provenance";
import { When } from "./markets/When";
import { GuillocheBand, Rosette, Seal } from "./Engraving";
import { IconExternal, IconWallet } from "./Icons";
import s from "./Dashboard.module.css";

type RichPosition = Position & { markPrice?: number | null; contract?: Pick<MarketContract, "id" | "venue" | "eventTitle" | "label" | "expiry"> & Partial<MarketContract> | null };
type Ctx = { line?: QuoteLine; risk?: Risk };

const SOURCE: Record<FeedEvent["source"], { label: string; cls: string }> = {
  quicknode: { label: "QuickNode Stream", cls: "badge-kalshi" },
  crank: { label: "Settlement crank", cls: "badge-gold" },
  program: { label: "Cover program", cls: "badge-brand" },
  app: { label: "App", cls: "badge-neutral" },
};
const STATUS: Record<Position["status"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "stamp-inforce" }, won: { label: "Won", cls: "stamp-settled" },
  lost: { label: "Expired", cls: "stamp-void" }, redeemed: { label: "Paid out", cls: "stamp-settled" },
};
const policyStamp = (status: string) => (/paid/i.test(status) ? "stamp-settled" : /open|active/i.test(status) ? "stamp-inforce" : "stamp-void");
/** Serial printed on a stub, derived from the real id (never invented). */
const IconPlus = ({ size = 15 }: { size?: number }) => <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>;
const Ext = () => <IconExternal size={11} className={s.ext} />;
const MON: Record<string, string> = { JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr", MAY: "May", JUN: "Jun", JUL: "Jul", AUG: "Aug", SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec" };
const CITY: Record<string, string> = { AUS: "Austin", HOU: "Houston", DAL: "Dallas", SAT: "San Antonio", NY: "New York", CHI: "Chicago", MIA: "Miami", LAX: "Los Angeles" };
/** Readable name for a market id when we have no market data for it (never show a raw ticker as a title). */
export function prettyRef(id?: string | null): string {
  if (!id) return "Market";
  const t = id.replace(/^[a-z]+:/, "");
  const wk = t.match(/^KXRAINWKND-\d\d([A-Z]{3})(\d\d)-([A-Z]{2,3})/);
  if (wk) return `Rain in ${CITY[wk[3]] ?? wk[3]}, weekend of ${MON[wk[1]] ?? wk[1]} ${Number(wk[2])}`;
  const rain = t.match(/^KXRAIN(?:WKND)?([A-Z]{2,3})M?-(\d\d)([A-Z]{3})(\d\d)?/);
  if (rain) return `Rain in ${CITY[rain[1]] ?? rain[1]}${rain[4] ? ` on ${MON[rain[3]] ?? rain[3]} ${Number(rain[4])}` : ` in ${MON[rain[3]] ?? rain[3]}`}`;
  const game = t.match(/^GAME-([A-Z]+)-([A-Z]+)-([A-Z]+)-\d\d(\d\d)(\d\d)-([A-Z]+)/);
  if (game) return `${game[1]}: ${game[2]} vs ${game[3]}, ${Object.values(MON)[Number(game[4]) - 1] ?? ""} ${Number(game[5])} (${game[6]} wins)`;
  return `${venueName(id.slice(0, Math.max(0, id.indexOf(":"))) || "")} market ${t}`.trim();
}
/** Feed lines in plain words (server text is desk/ops wording). */
function plainFeed(text: string): string {
  let m: RegExpMatchArray | null;
  if (/^QuickNode: tx .* touched the Hedgehog desk/.test(text)) return "Transaction on the Hedgehog program";
  if (/^QuickNode: business registered/.test(text)) return "A business signed up for cover";
  if ((m = text.match(/^Hedgehog Cover #\d+: ([\d.]+) USDC premium for ([\d.]+) USDC payout(?: \((\w+),\s*([^)]+)\))?/)))
    return `Policy bought: pays ${usd(Number(m[2]))} for a ${usd(Number(m[1]), 2)} premium${m[4] ? ` (${prettyRef(m[4])})` : ""}`;
  if ((m = text.match(/^Desk hedge on (\w+) \((dry-run|live)\)/))) return `Hedgehog backed a policy on ${m[1]}${m[2] === "dry-run" ? " (test order)" : ""}`;
  if ((m = text.match(/^Hedge filled: ([\d,]+) \w+ × (\S+) for (\$[\d.,]+)/))) return `Hedge bought: ${m[1]} contracts on ${prettyRef(m[2])} for ${m[3]}`;
  return text;
}

export function Dashboard() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [owner, setOwner] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [policies, setPolicies] = useState<CoverPolicy[] | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [markets, setMarkets] = useState<Map<string, MarketContract>>(new Map());
  const [ctx, setCtx] = useState<Map<string, Ctx>>(new Map());
  const [backing, setBacking] = useState<Map<string, DeskHedge>>(new Map());
  const [, tick] = useState(0);
  const since = useRef<string | undefined>(undefined);

  useEffect(() => {
    const pk = publicKey?.toBase58();
    if (pk) { setLastOwner(pk); setOwner(pk); return; }
    setOwner(lastOwner() ?? (isMock() ? DEMO_OWNER : null));
  }, [publicKey]);

  // Context from stored quotes: contract → line + risk (for labels and "lost $X" numbers).
  useEffect(() => {
    const m = new Map<string, Ctx>();
    for (const q of allStoredQuotes()) {
      const rk = new Map(q.risks.map((r) => [r.id, r]));
      for (const l of q.lines) m.set(l.contractId, { line: l, risk: rk.get(l.riskId) });
    }
    setCtx(m);
  }, []);

  useEffect(() => {
    if (!owner) return;
    let live = true;
    const load = () => {
      getPositions(owner).then((p) => live && setPositions(p)).catch(() => {});
      getPolicies(owner).then((p) => live && setPolicies(p)).catch(() => {});
      getBacking(owner).then((b) => live && setBacking(new Map(b.hedges.map((h) => [h.refId, h])))).catch(() => {});
    };
    load();
    const i = setInterval(load, 10_000);
    return () => { live = false; clearInterval(i); };
  }, [owner]);

  useEffect(() => {
    let live = true;
    const loadMarkets = () => getMarkets().then((ms) => live && setMarkets(new Map(ms.map((m) => [m.id, m])))).catch(() => {});
    const loadFeed = () => getFeed(since.current).then((evs) => {
      if (!live || !Array.isArray(evs)) return;
      setFeed((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        for (const e of evs) byId.set(e.id, e);
        const all = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
        if (all[0]) since.current = all[0].at;
        return all;
      });
    }).catch(() => {});
    loadMarkets(); loadFeed();
    const a = setInterval(loadFeed, 5_000), b = setInterval(loadMarkets, 20_000), c = setInterval(() => tick((x) => x + 1), 15_000);
    return () => { live = false; clearInterval(a); clearInterval(b); clearInterval(c); };
  }, []);

  // /api/positions enriches rows with { markPrice, contract }; fall back to market polling / stored quotes.
  const label = (p: Position) => {
    const m = (p as RichPosition).contract ?? markets.get(p.contractId) ?? ctx.get(p.contractId)?.line?.contract;
    return m ? { title: m.eventTitle, sub: m.label, m } : { title: prettyRef(p.contractId), sub: "", m: undefined };
  };
  const markOf = (p: Position): number | null => {
    const mp = (p as RichPosition).markPrice;
    if (typeof mp === "number") return mp;
    const m = markets.get(p.contractId) ?? ctx.get(p.contractId)?.line?.contract;
    if (!m) return null;
    if (m.status === "settled" && m.resolution) return m.resolution === p.side ? 1 : 0;
    const bid = p.side === "yes" ? m.yesBid : m.noBid;
    const ask = p.side === "yes" ? m.yesAsk : m.noAsk;
    return bid ?? ask;
  };

  const stats = useMemo(() => {
    const ps = positions ?? [];
    const open = ps.filter((p) => p.status === "open");
    const paid = ps.filter((p) => p.status === "won" || p.status === "redeemed");
    return {
      openCover: open.reduce((a, p) => a + p.contracts, 0) + (policies ?? []).filter((x) => /open|active/i.test(x.status)).reduce((a, x) => a + x.payoutUsd, 0),
      premium: ps.reduce((a, p) => a + p.costUsd, 0) + (policies ?? []).reduce((a, x) => a + (x.premiumUsd || 0), 0),
      paidOut: paid.reduce((a, p) => a + (p.payoutUsd ?? p.contracts), 0),
      hero: paid.sort((a, b) => (b.settledAt ?? b.createdAt).localeCompare(a.settledAt ?? a.createdAt))[0],
    };
  }, [positions, policies]);

  if (!owner) {
    return (
      <div className="container">
        <header className={`page-head ${s.pageHead}`}>
          <Rosette className={s.headRosette} density={10} steps={240} />
          <div>
            <h1>My <em>cover</em></h1>
          </div>
        </header>
        <section className={s.cols}>
          <div className={s.connect}>
            <div className={`card ${s.connectDoc}`}>
              <div className={s.connectBody}>
                <Seal className={s.connectSeal} />
                <div>
                  <h2 className={s.connectTitle}>Connect your wallet <em>to see your cover</em></h2>
                  <p className={s.connectText}>Your hedges and policies live in your wallet on Solana devnet.</p>
                  <div className="row">
                    <button className="btn btn-primary" onClick={() => setVisible(true)}><IconWallet size={16} /> Connect wallet</button>
                    <DemoWalletButton />
                    <a className="btn btn-ghost" href="/dashboard?mock=1">View sample dashboard</a>
                  </div>
                  <p className="xs muted" style={{ margin: "10px 0 0" }}>No wallet? The demo wallet lives in this browser and comes with free test dollars.</p>
                </div>
              </div>
            </div>
          </div>
          <FeedPanel feed={feed} />
        </section>
      </div>
    );
  }

  const mock = isMock();
  const heroCtx = stats.hero ? ctx.get(stats.hero.contractId) : undefined;
  const heroLoss = heroCtx?.risk?.lossUsd ?? (stats.hero?.businessId === "rainey-patio-bar" ? 1100 : undefined);
  const heroLabel = stats.hero ? label(stats.hero) : null;

  return (
    <div className="container">
      <header className={`page-head ${s.pageHead}`}>
        <Rosette className={s.headRosette} density={10} steps={240} />
        <div>
          <h1>My <em>cover</em></h1>
          <p className={s.wallet}>Wallet <span className="mono">{shortAddr(owner, 6)}</span> · Solana devnet · updates live</p>
        </div>
        <Link href="/#pick" className="btn btn-primary"><IconPlus size={15} /> New quote</Link>
      </header>

      {mock && <div className="alert alert-info small" style={{ marginBottom: 16 }}>Sample data: a demo wallet with made-up cover. Nothing here is real. <a href="/dashboard">Leave sample mode</a></div>}
      <section className={s.stats} aria-label="Totals">
        <div><span className="label">Active cover</span><b className="fig pay">{usd(stats.openCover)}</b><small>paid if your triggers hit</small></div>
        <div><span className="label">Premiums paid</span><b className="fig cost">{usd(stats.premium, 2)}</b><small>hedges + Cover policies</small></div>
        <div><span className="label">Paid out to you</span><b className="fig">{usd(stats.paidOut)}</b><small>settled hedges</small></div>
      </section>

      <HeadsUp />
      <PastQuotes eyebrow="Quotes" />

      {stats.hero && (
        <section className={`cert ${s.hero}`}>
          <div className="cert-frame">
            <GuillocheBand />
            <div className="cert-in">
              <div className="cert-head">
                <div>
                  <div className="cert-kicker">Your bad day, covered</div>
                  <div className="cert-title">Paid out</div>
                </div>
                {stats.hero.settledAt && <span className="serial"><small>settled {shortDate(stats.hero.settledAt)}</small></span>}
              </div>
              <h3>{heroLabel?.title}</h3>
              <p className="insured">{heroLabel?.sub}{heroLabel?.m ? ` · ${VENUE_LABEL[heroLabel.m.venue] ?? heroLabel.m.venue}` : ""}</p>
              <div className={`terms ${heroLoss ? s.terms3 : ""}`}>
                {heroLoss ? <div className="term"><span className="lab">Lost in sales</span><span className={`amt ${s.lossAmt}`}>~{usd(heroLoss)}</span></div> : null}
                <div className="term pay"><span className="lab">Hedge paid</span><span className="amt">{usd(stats.hero.payoutUsd ?? stats.hero.contracts)}</span></div>
                <div className="term cost"><span className="lab">Premium was</span><span className="amt">{usd(stats.hero.costUsd, 2)}</span></div>
              </div>
              {stats.hero.redeemTxSig && <div className={s.heroFoot}><a className="btn btn-sm" href={explorerTx(stats.hero.redeemTxSig, stats.hero.network)} target="_blank" rel="noreferrer">Payout tx <IconExternal size={13} /></a></div>}
            </div>
            <GuillocheBand tone="red" />
          </div>
        </section>
      )}

      <section className={s.cols}>
        <div>
          {/* Legacy: outcome-token positions from the retired "Buy hedge" button. Shown only for wallets that hold some. */}
          {positions && positions.length > 0 && (<>
          <div className={s.secHead}><h2>Earlier hedges (outcome tokens)</h2><span className={s.secMeta}>{positions ? `${positions.length} on file` : ""}</span></div>
          <div className={s.list}>
          {positions === null ? <div className="empty"><span className="spinner" /> Loading positions…</div>
            : positions.length === 0 ? <div className="empty">No hedges yet. <Link href="/">Get a quote</Link>.</div>
            : positions.map((p) => {
              const lb = label(p);
              const mark = markOf(p);
              const value = mark != null ? mark * p.contracts : null;
              const pnl = p.status === "open" ? (value != null ? value - p.costUsd : null) : (p.payoutUsd ?? (p.status === "lost" ? 0 : p.contracts)) - p.costUsd;
              return (
                <article key={p.id} className={`stub ${s.stub}`}>
                  <div className="stub-left">
                    <Seal withText={false} className="seal-sm" fill="var(--bg-2)" />
                  </div>
                  <div className="stub-body">
                    <span className={`stamp ${STATUS[p.status]?.cls ?? "stamp-void"} ${s.stamp}`}>{STATUS[p.status]?.label ?? p.status}</span>
                    <div className={s.kick}>{p.status === "open" && <span className="dot live" />}Hedge · {p.side.toUpperCase()} · {timeAgo(p.createdAt)}</div>
                    <h4>{lb.title}</h4>
                    <p>{lb.sub || venueName(venueOfId(p.contractId) ?? "")}{lb.m?.expiry ? <> · closes <When iso={lb.m.expiry} /></> : ""}</p>
                    <div className={s.story}><PositionStory position={p} risk={ctx.get(p.contractId)?.risk} contract={lb.m ?? null} mark={mark} /></div>
                    <div className={`stub-grid ${s.grid4}`}>
                      <div><span>Contracts</span><b>{p.contracts.toLocaleString()}</b></div>
                      <div><span>Cost</span><b className="cost">{usd(p.costUsd, 2)}</b></div>
                      <div><span>{p.status === "open" ? "Live mark" : "Payout"}</span><b>{p.status === "open" ? (mark != null ? cents(mark) : "—") : usd(p.payoutUsd ?? (p.status === "lost" ? 0 : p.contracts))}</b></div>
                      <div><span>{p.status === "open" ? "Value / P&L" : "Net"}</span>
                        <b className={pnl != null && pnl >= 0 ? "pay" : "bad"}>{p.status === "open" ? `${usd(value)} ` : ""}{pnl != null ? `(${pnl >= 0 ? "+" : ""}${usd(pnl)})` : "—"}</b></div>
                    </div>
                    <Provenance venue={lb.m?.venue ?? venueOfId(p.contractId)} backing={backing.get(p.id)} />
                    <Backing h={backing.get(p.id)} />
                    <div className={s.links}>
                      {p.txSig && <a href={explorerTx(p.txSig, p.network)} target="_blank" rel="noreferrer">Buy tx <Ext /></a>}
                      {p.redeemTxSig && <a href={explorerTx(p.redeemTxSig, p.network)} target="_blank" rel="noreferrer">Redeem tx <Ext /></a>}
                      {p.mint && <span className="muted">Mint <span className="mono">{shortAddr(p.mint)}</span></span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          </>)}

          <div className={s.secHead} style={positions && positions.length > 0 ? { marginTop: 40 } : undefined}><h2>Your cover</h2><span className={s.secMeta}>{policies ? `${policies.length} on file` : ""}</span></div>
          <div className={s.list}>
          {policies === null ? <div className="empty"><span className="spinner" /> Loading policies…</div>
            : policies.length === 0 ? <div className="empty">No cover yet. <Link href="/">Get a quote</Link>.</div>
            : policies.map((x) => (
              <article key={x.policyId + (x.policyPda ?? "")} className={`stub ${s.stub}`}>
                <div className="stub-left">
                  <Seal withText={false} className="seal-sm" fill="var(--bg-2)" />
                </div>
                <div className="stub-body">
                  <Rosette className="stub-rosette" density={8} steps={200} />
                  <span className={`stamp ${policyStamp(x.status)} ${s.stamp}`}>{x.status}</span>
                  <div className={s.kick}>Hedgehog Cover · Policy #{x.policyId}</div>
                  <h4>{x.trigger ?? prettyRef(x.marketRef)}</h4>
                  <p>{(x.marketRef && (markets.get(x.marketRef)?.eventTitle ?? ctx.get(x.marketRef)?.line?.contract.eventTitle)) || prettyRef(x.marketRef)}{x.expiry ? <> · closes <When iso={x.expiry} /></> : ""}</p>
                  <div className={s.story}><PolicyStory status={x.status} payoutUsd={x.payoutUsd} premiumUsd={x.premiumUsd} trigger={x.trigger} expiry={x.expiry} /></div>
                  <div className="stub-grid">
                    <div><span>Pays</span><b className="pay">{usd(x.payoutUsd)}</b></div>
                    <div><span>Premium</span><b className="cost">{usd(x.premiumUsd, 2)}</b></div>
                    <div><span>Account</span><b className={s.acct}>{x.policyPda ? shortAddr(x.policyPda) : "—"}</b></div>
                  </div>
                  <Provenance venue={venueOfId(x.marketRef)} backing={x.policyPda ? backing.get(x.policyPda) : undefined} />
                  <Backing h={x.policyPda ? backing.get(x.policyPda) : undefined} />
                  <div className={s.links}>
                    {x.txSig && <a href={explorerTx(x.txSig)} target="_blank" rel="noreferrer">Buy tx <Ext /></a>}
                    {x.settleTxSig && <a href={explorerTx(x.settleTxSig)} target="_blank" rel="noreferrer">Settlement tx <Ext /></a>}
                    {x.policyPda && <a href={`https://explorer.solana.com/address/${x.policyPda}?cluster=devnet`} target="_blank" rel="noreferrer">Policy account <Ext /></a>}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {owner && !mock && <TaxRecord owner={owner} />}
        </div>
        <FeedPanel feed={feed} mine={new Set([...(policies ?? []).map((x) => x.txSig), ...(positions ?? []).map((p) => p.txSig)].filter(Boolean) as string[])} />
      </section>
    </div>
  );
}

/** "Hedgehog's backing on Gemini": the desk's offsetting order for a Gemini-priced position/policy. */
function Backing({ h }: { h?: DeskHedge }) {
  if (!h) return null;
  return (
    <div className={s.backing}>
      <div className="row between" style={{ gap: 8 }}>
        <b className={s.backingTitle}>Hedgehog&apos;s backing on {venueName(venueOfId(h.contractId) ?? "gemini")}</b>
        <span className={`badge ${h.status === "error" || h.status === "rejected" ? "badge-bad" : "badge-gemini"}`}>{h.mode === "live" ? h.status : h.status === "error" ? "not placed" : "test order"}</span>
      </div>
      <div className={s.order}>{h.limitPrice > 0 ? orderText(h) : `${h.outcome.toUpperCase()} ${h.symbol}`}</div>
      <div className="muted" style={{ marginTop: 4 }}>
        {h.error ? h.error : <>Desk spends ≤ {usd(h.notionalUsd, 2)}{h.soldForUsd != null ? ` vs ${usd(h.soldForUsd, 2)} received` : ""}. It pays out exactly when you&apos;re owed.</>}
        {h.url && <> · <a href={h.url} target="_blank" rel="noreferrer">{venueName(venueOfId(h.contractId) ?? "gemini")} market <Ext /></a></>}
      </div>
    </div>
  );
}

function FeedPanel({ feed, mine }: { feed: FeedEvent[]; mine?: Set<string> }) {
  return (
    <aside className={`card ${s.feed}`} aria-label="Live event feed">
      <div className={`doc-head ${s.feedHead}`}>
        <span className="caps-title">Network activity</span>
        <span className="row" style={{ gap: 6 }}>
          <span className={`badge ${SOURCE.quicknode.cls}`}>{SOURCE.quicknode.label}</span>
          <span className="badge badge-good"><span className="dot live" /> Live</span>
        </span>
      </div>
      <p className="xs muted" style={{ margin: "8px 0 0" }}>Everything happening on Hedgehog right now{mine?.size ? ". Yours are marked." : "."}</p>
      {feed.length === 0 ? <div className="empty small">Waiting for events…</div> : (
        <ol className={s.events}>
          {feed.map((e) => {
            const desk = e.text.match(/^Desk hedge on (\w+)/);
            const src = desk ? { label: `${desk[1]} backing`, cls: /gemini/i.test(desk[1]) ? "badge-gemini" : "badge-kalshi" } : SOURCE[e.source] ?? SOURCE.app;
            const yours = !!e.txSig && !!mine?.has(e.txSig);
            return (
              <li key={e.id}>
                <div className="row between" style={{ gap: 6 }}>
                  <span className="row" style={{ gap: 4 }}>{e.source === "quicknode" && src === SOURCE.quicknode ? null : <span className={`badge ${src.cls}`}>{src.label}</span>}{yours && <span className="badge badge-good">Yours</span>}</span>
                  <span className={s.when} title={e.at}>{timeAgo(e.at)}</span>
                </div>
                <p>{plainFeed(e.text)}</p>
                {e.txSig && <a className={s.tx} href={explorerTx(e.txSig)} target="_blank" rel="noreferrer">{shortAddr(e.txSig, 6)} <Ext /></a>}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
