"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { FeedEvent, MarketContract, Position, QuoteLine, Risk } from "@/lib/types";
import { getFeed, getMarkets, getPolicies, getPositions } from "@/lib/client/api";
import { isMock } from "@/lib/client/mode";
import { allStoredQuotes, lastOwner, setLastOwner } from "@/lib/client/storage";
import { DEMO_OWNER, type CoverPolicy } from "@/lib/fixtures";
import { cents, explorerTx, shortAddr, shortDate, timeAgo, usd, VENUE_LABEL } from "@/lib/client/format";
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
  open: { label: "Open", cls: "badge-kalshi" }, won: { label: "Won", cls: "badge-good" },
  lost: { label: "Expired", cls: "badge-neutral" }, redeemed: { label: "Paid out", cls: "badge-good" },
};

export function Dashboard() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [owner, setOwner] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [policies, setPolicies] = useState<CoverPolicy[] | null>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [markets, setMarkets] = useState<Map<string, MarketContract>>(new Map());
  const [ctx, setCtx] = useState<Map<string, Ctx>>(new Map());
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
    return m ? { title: m.eventTitle, sub: `${m.label} · ${VENUE_LABEL[m.venue] ?? m.venue}`, m } : { title: p.contractId, sub: "", m: undefined };
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
      <section className="container narrow section">
        <div className="card stack" style={{ textAlign: "center" }}>
          <span className="eyebrow">Coverage dashboard</span>
          <h1 style={{ fontSize: "2rem" }}>Connect your wallet to see your cover</h1>
          <p className="muted">Your hedges are SPL outcome tokens and Cover policies on Solana devnet, tied to your wallet.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => setVisible(true)}>Connect Phantom</button>
            <a className="btn" href="/dashboard?mock=1">View demo dashboard</a>
          </div>
        </div>
        <FeedPanel feed={feed} />
      </section>
    );
  }

  const heroCtx = stats.hero ? ctx.get(stats.hero.contractId) : undefined;
  const heroLoss = heroCtx?.risk?.lossUsd ?? (stats.hero?.businessId === "rainey-patio-bar" ? 1100 : undefined);
  const heroLabel = stats.hero ? label(stats.hero) : null;

  return (
    <div className="container">
      <section className={s.head}>
        <div>
          <span className="eyebrow">Coverage dashboard</span>
          <h1 style={{ fontSize: "clamp(1.9rem,4vw,2.5rem)", margin: "4px 0" }}>My cover</h1>
          <p className="muted small" style={{ margin: 0 }}>Wallet <span className="mono">{shortAddr(owner, 6)}</span> · Solana devnet · updates live</p>
        </div>
        <Link href="/" className="btn">+ New quote</Link>
      </section>

      <section className={s.stats}>
        <div className="card"><span className="xs muted">Active cover</span><b className="num pay">{usd(stats.openCover)}</b><span className="xs muted">paid if your triggers hit</span></div>
        <div className="card"><span className="xs muted">Premiums paid</span><b className="num cost">{usd(stats.premium, 2)}</b><span className="xs muted">hedges + Cover policies</span></div>
        <div className="card"><span className="xs muted">Paid out to you</span><b className="num">{usd(stats.paidOut)}</b><span className="xs muted">settled hedges</span></div>
      </section>

      {stats.hero && (
        <section className={s.hero}>
          <div>
            <span className="eyebrow" style={{ color: "inherit", opacity: 0.8 }}>Your bad day, covered</span>
            <p className={s.heroLine}>
              {heroLoss ? <>Lost ~<b>{usd(heroLoss)}</b> in sales. </> : null}Hedge paid <b>{usd(stats.hero.payoutUsd ?? stats.hero.contracts)}</b>.
            </p>
            <p className="small" style={{ margin: 0, opacity: 0.85 }}>{heroLabel?.title} · {heroLabel?.sub} · settled {stats.hero.settledAt ? shortDate(stats.hero.settledAt) : ""}. Premium was {usd(stats.hero.costUsd, 2)}.</p>
          </div>
          {stats.hero.redeemTxSig && <a className="btn" href={explorerTx(stats.hero.redeemTxSig, stats.hero.network)} target="_blank" rel="noreferrer">Payout tx ↗</a>}
        </section>
      )}

      <section className={s.cols}>
        <div className="stack">
          <h2 style={{ margin: 0 }}>Hedges</h2>
          {positions === null ? <div className="card muted">Loading positions…</div>
            : positions.length === 0 ? <div className="empty">No hedges yet. <Link href="/">Get a quote</Link> and buy one on devnet.</div>
            : positions.map((p) => {
              const lb = label(p);
              const mark = markOf(p);
              const value = mark != null ? mark * p.contracts : null;
              const pnl = p.status === "open" ? (value != null ? value - p.costUsd : null) : (p.payoutUsd ?? (p.status === "lost" ? 0 : p.contracts)) - p.costUsd;
              return (
                <article key={p.id} className={`card ${s.pos}`}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span className={`badge ${STATUS[p.status]?.cls ?? "badge-neutral"}`}>{p.status === "open" && <span className="dot live" />}{STATUS[p.status]?.label ?? p.status}</span>
                    <span className="xs muted">{timeAgo(p.createdAt)}</span>
                  </div>
                  <h3 style={{ margin: "8px 0 2px", fontSize: "1.1rem" }}>{lb.title}</h3>
                  <p className="small muted" style={{ margin: "0 0 10px" }}>{p.side.toUpperCase()} · {lb.sub || p.contractId}{lb.m?.expiry ? ` · expires ${shortDate(lb.m.expiry)}` : ""}</p>
                  <div className={s.posGrid}>
                    <div><span>Contracts</span><b className="num">{p.contracts.toLocaleString()}</b></div>
                    <div><span>Cost</span><b className="num cost">{usd(p.costUsd, 2)}</b></div>
                    <div><span>{p.status === "open" ? "Live mark" : "Payout"}</span><b className="num">{p.status === "open" ? (mark != null ? cents(mark) : "—") : usd(p.payoutUsd ?? (p.status === "lost" ? 0 : p.contracts))}</b></div>
                    <div><span>{p.status === "open" ? "Value / P&L" : "Net"}</span>
                      <b className={`num ${pnl != null && pnl >= 0 ? "pay" : "bad"}`}>{p.status === "open" ? `${usd(value)} ` : ""}{pnl != null ? `(${pnl >= 0 ? "+" : ""}${usd(pnl)})` : "—"}</b></div>
                  </div>
                  <div className="row xs" style={{ marginTop: 10, gap: 14 }}>
                    {p.txSig && <a href={explorerTx(p.txSig, p.network)} target="_blank" rel="noreferrer">Buy tx ↗</a>}
                    {p.redeemTxSig && <a href={explorerTx(p.redeemTxSig, p.network)} target="_blank" rel="noreferrer">Redeem tx ↗</a>}
                    {p.mint && <span className="muted">Mint <span className="mono">{shortAddr(p.mint)}</span></span>}
                    <span className="badge badge-neutral">{p.network}</span>
                  </div>
                </article>
              );
            })}

          <h2 style={{ margin: "28px 0 0" }}>Hedgehog Cover policies</h2>
          {policies === null ? <div className="card muted">Loading policies…</div>
            : policies.length === 0 ? <div className="empty">No Cover policies. On a quote, choose “Get Hedgehog Cover instead”.</div>
            : policies.map((x) => (
              <article key={x.policyId + (x.policyPda ?? "")} className={`card ${s.pos}`}>
                <div className="row between">
                  <span className={`badge ${/paid/i.test(x.status) ? "badge-good" : /open|active/i.test(x.status) ? "badge-brand" : "badge-neutral"}`}>{x.status}</span>
                  <span className="xs muted">Policy #{x.policyId}</span>
                </div>
                <h3 style={{ margin: "8px 0 2px", fontSize: "1.1rem" }}>{x.trigger ?? x.marketRef}</h3>
                <p className="small muted" style={{ margin: "0 0 10px" }}>{x.marketRef}{x.expiry ? ` · expires ${shortDate(x.expiry)}` : ""}</p>
                <div className={s.posGrid}>
                  <div><span>Pays</span><b className="num pay">{usd(x.payoutUsd)}</b></div>
                  <div><span>Premium</span><b className="num cost">{usd(x.premiumUsd, 2)}</b></div>
                  <div><span>Account</span><b className="mono xs">{x.policyPda ? shortAddr(x.policyPda) : "—"}</b></div>
                </div>
                <div className="row xs" style={{ marginTop: 10, gap: 14 }}>
                  {x.txSig && <a href={explorerTx(x.txSig)} target="_blank" rel="noreferrer">Buy tx ↗</a>}
                  {x.settleTxSig && <a href={explorerTx(x.settleTxSig)} target="_blank" rel="noreferrer">Settlement tx ↗</a>}
                  {x.policyPda && <a href={`https://explorer.solana.com/address/${x.policyPda}?cluster=devnet`} target="_blank" rel="noreferrer">Policy account ↗</a>}
                </div>
              </article>
            ))}
        </div>
        <FeedPanel feed={feed} />
      </section>
    </div>
  );
}

function FeedPanel({ feed }: { feed: FeedEvent[] }) {
  return (
    <aside className={`card ${s.feed}`} aria-label="Live event feed">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Live feed</h2>
        <span className="badge badge-good"><span className="dot live" /> Live · 5s</span>
      </div>
      <p className="xs muted" style={{ marginTop: 0 }}>Onchain events from QuickNode Streams, the settlement crank and the Cover program.</p>
      {feed.length === 0 ? <div className="empty small">Waiting for events…</div> : (
        <ol className={s.events}>
          {feed.map((e) => {
            const src = SOURCE[e.source] ?? SOURCE.app;
            return (
              <li key={e.id}>
                <div className="row between" style={{ gap: 6 }}>
                  <span className={`badge ${src.cls}`}>{src.label}</span>
                  <span className="xs muted" title={e.at}>{timeAgo(e.at)}</span>
                </div>
                <p>{e.text}</p>
                {e.txSig && <a className="xs mono" href={explorerTx(e.txSig)} target="_blank" rel="noreferrer">{shortAddr(e.txSig, 6)} ↗</a>}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
