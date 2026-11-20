"use client";
// "Cover all": every remaining line of the plan in one wallet approval. Server prices each line live and returns
// co-signed txs (≤3 policies each); the wallet signs them all at once; we send in order and confirm each policy.
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { coverBuyPlan, coverConfirm, devnetFaucet, sleep, type DeskHedge } from "@/lib/client/api";
import { isMock } from "@/lib/client/mode";
import { signAllAndSend, walletErrorMessage } from "@/lib/client/tx";
import { plainError } from "@/lib/client/errors";
import { explorerTx, shortAddr, usd } from "@/lib/client/format";
import { setLastOwner } from "@/lib/client/storage";
import { DEMO_OWNER } from "@/lib/fixtures";
import type { CheckoutResult } from "../CheckoutDialog";
import type { CoverItem } from "./CoverChecklist";
import { GuillocheBand, Seal } from "../Engraving";
import { IconArrowRight, IconCheck, IconExternal } from "../Icons";
import c from "../CheckoutDialog.module.css";
import s from "./CoverAllDialog.module.css";

type Stage = "review" | "connect" | "build" | "signing" | "sending" | "done" | "error";

export function CoverAllDialog({ items: initial, businessId, budgetUsd, onClose, onDone, onRefresh }: {
  items: CoverItem[]; businessId: string; budgetUsd?: number; onClose: () => void; onDone: (r: CheckoutResult & { contractId: string }) => void;
  /** Re-price the plan at live asks (after "price moved"); returns the not-yet-covered items at the new prices. */
  onRefresh?: () => Promise<CoverItem[]>;
}) {
  const [items, setItems] = useState(initial);
  const [moved, setMoved] = useState<{ before: number; after: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // what the server actually charged per line (premium incl. fee), keyed by contract; shown on the receipt
  const [charged, setCharged] = useState<Map<string, number> | null>(null);
  const { publicKey, signTransaction, signAllTransactions, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [stage, setStage] = useState<Stage>("review");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sigs, setSigs] = useState<string[]>([]);
  const [simulated, setSimulated] = useState(false);
  const running = useRef(false);
  const mock = typeof window !== "undefined" && isMock();
  const premium = items.reduce((a, i) => a + i.line.premiumUsd, 0);
  const payout = items.reduce((a, i) => a + i.line.payoutUsd, 0);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setErr(null);
    try {
      const owner = publicKey?.toBase58() ?? DEMO_OWNER;
      if (publicKey) setLastOwner(owner);
      if (mock) {
        setStage("build"); await sleep(700); setStage("signing"); setProgress("Approve once in your wallet"); await sleep(900);
        setStage("sending"); setProgress("Sending to Solana devnet"); await sleep(1200);
        const sig = `SIMULATED${Math.random().toString(36).slice(2)}${"1".repeat(40)}`;
        setSigs([sig]); setSimulated(true);
        for (const it of items) onDone({ kind: "cover", signature: sig, network: "devnet", policyId: "sim", simulated: true, contractId: it.line.contractId });
        setStage("done"); return;
      }
      if (!publicKey) throw new Error("Connect a wallet first.");
      setStage("build"); setProgress("Pricing every line from the live markets");
      await devnetFaucet(owner, premium); // devnet only: tops up test dollars to cover the whole plan
      const plan = await coverBuyPlan({
        owner, businessId, monthlyBudgetUsd: budgetUsd && budgetUsd >= premium ? budgetUsd : undefined,
        lines: items.map((it) => ({
          marketRef: it.line.contractId, side: it.line.side, contracts: it.line.contracts, premiumUsd: it.line.premiumUsd,
          trigger: it.risk?.trigger ?? it.line.contract.label, peril: it.risk?.peril ?? it.line.contract.peril,
        })),
      });
      const signed = await signAllAndSend(signAllTransactions, signTransaction, plan.txs, "devnet", (st, i, n) => {
        setStage(st === "signing" ? "signing" : "sending");
        setProgress(st === "signing" ? `Approve once in your wallet (${n} transaction${n === 1 ? "" : "s"})` : `${st === "sending" ? "Sending" : "Confirming"} ${n > 1 ? `${i + 1} of ${n}` : ""} on Solana devnet`);
      });
      setSigs(signed);
      setCharged(new Map(plan.policies.map((p) => [items[p.index].line.contractId, p.premiumUsd])));
      setProgress("Recording your policies");
      await Promise.all(plan.policies.map(async (p) => {
        let backing: DeskHedge | undefined;
        try { backing = (await coverConfirm(p.policyPda, signed[p.tx]))?.backing; } catch (e) { console.warn("cover confirm failed", e); }
        onDone({ kind: "cover", signature: signed[p.tx], network: "devnet", policyId: String(p.policyId), policyPda: p.policyPda, backing, contractId: items[p.index].line.contractId });
      }));
      setStage("done");
    } catch (e) {
      setErr(plainError(e, walletErrorMessage)); setStage("error");
    } finally { running.current = false; }
  }, [publicKey, signTransaction, signAllTransactions, mock, items, businessId, budgetUsd, premium, onDone]);

  useEffect(() => { if (stage === "connect" && connected && publicKey) run(); }, [stage, connected, publicKey, run]);
  const busy = stage === "build" || stage === "signing" || stage === "sending";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const priceMoved = !!err && /price moved/i.test(err);
  const closed = !!err && /market has closed|can't be covered on Hedgehog/i.test(err);
  const noRetry = !!err && /budget|can't take on|already have this cover/i.test(err); // retrying the same plan fails the same way
  async function refresh() {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      const before = items.reduce((a, i) => a + i.line.premiumUsd, 0);
      const fresh = await onRefresh();
      setItems(fresh);
      setMoved({ before, after: fresh.reduce((a, i) => a + i.line.premiumUsd, 0) });
      setErr(null); setStage("review");
    } catch (e) { setErr(plainError(e, walletErrorMessage)); }
    finally { setRefreshing(false); }
  }

  function start() {
    setErr(null);
    if (!mock && !connected) { setStage("connect"); setVisible(true); return; }
    run();
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ca-title">
        <div className="doc-head">
          <span className="caps-title">Binding cover · whole plan</span>
        </div>
        <h2 id="ca-title" className={c.title}>Cover all {items.length} risks</h2>
        <p className={c.lede}>One approval in your wallet. Each risk becomes its own Hedgehog Cover policy on Solana.</p>

        <ul className={s.lines}>
          {items.map((it) => (
            <li key={it.line.contractId}>
              <span className={s.name}>{stage === "done" && <IconCheck size={14} />}{it.risk?.title ?? it.line.contract.eventTitle}</span>
              <span className={s.nums}>pays <b className="pay">{usd(it.line.payoutUsd)}</b> · {stage === "done" && charged ? "paid" : "costs"} <b>{usd(charged?.get(it.line.contractId) ?? it.line.premiumUsd, 2)}</b></span>
            </li>
          ))}
        </ul>

        {stage !== "done" && (
          <div className={`terms ${c.terms}`}>
            <div className="term pay"><span className="lab">Pays you up to</span><span className="amt">{usd(payout)}</span></div>
            <div className="term cost"><span className="lab">You pay now (test USDC)</span><span className="amt">{usd(premium, 2)}</span></div>
          </div>
        )}

        {stage === "review" && (
          <>
            {moved && <div className="alert alert-info small" style={{ marginBottom: 12 }}>Prices updated to the live market: total {moved.after > moved.before ? "up" : moved.after < moved.before ? "down" : "unchanged"} from {usd(moved.before, 2)} to <b>{usd(moved.after, 2)}</b>. Check the lines above, then cover all.</div>}
            <p className={`xs muted ${c.trust}`}>Prices are re-checked live before you sign. Devnet prototype, not an insurance product. Each policy pays on its market&apos;s result, not your actual loss.</p>
            {mock && <div className="alert alert-info small" style={{ marginBottom: 12 }}>Demo mode: simulated, nothing goes onchain.</div>}
            <div className={c.actions}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={start} autoFocus>{connected || mock ? `Cover all · ${usd(premium, 2)}` : "Connect wallet & cover all"}</button>
            </div>
          </>
        )}

        {busy && <p className={s.progress} aria-live="polite"><span className="spinner" /> {progress}</p>}
        {stage === "connect" && <div className={c.actions}><button className="btn" onClick={() => setVisible(true)}>Open wallet list</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>}

        {stage === "error" && (
          <>
            <div className="alert alert-bad" role="alert" style={{ marginBottom: 12 }}>{priceMoved ? <>A market price moved since your quote. <span className="muted">({err})</span></> : err}</div>
            <div className={c.actions}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              {(priceMoved || closed) && onRefresh
                ? <button className="btn btn-primary" onClick={refresh} disabled={refreshing}>{refreshing ? <><span className="spinner" /> Refreshing…</> : "Refresh prices"}</button>
                : noRetry ? null : <button className="btn btn-primary" onClick={start}>Try again</button>}
            </div>
          </>
        )}

        {stage === "done" && (
          <>
            <div className={`cert ${c.receipt}`}>
              <div className="cert-frame">
                <GuillocheBand />
                <div className={`cert-in ${c.receiptIn}`}>
                  <div className="cert-head"><div><div className="cert-kicker">{simulated ? "Simulated · devnet" : "Solana devnet"}</div><div className="cert-title">Plan covered</div></div></div>
                  <p className={c.receiptMsg}><b>You&apos;re covered on {items.length} risks.</b> {simulated ? "(simulated)" : `${items.length} policies are live onchain.`}</p>
                  <div className="terms">
                    <div className="term pay"><span className="lab">Pays up to</span><span className={`amt ${c.amt}`}>{usd(payout)}</span></div>
                    <div className="term cost"><span className="lab">Premium paid</span><span className={`amt ${c.amt}`}>{usd(charged ? [...charged.values()].reduce((a, v) => a + v, 0) : premium, 2)}</span></div>
                  </div>
                </div>
                <GuillocheBand tone="red" />
              </div>
              <div className={`seal-stamp now ${c.seal}`}><Seal /></div>
            </div>
            {!simulated && (
              <dl className={`kv ${c.kv}`}>
                {sigs.map((sig, i) => (
                  <Fragment key={sig}><dt>Transaction{sigs.length > 1 ? ` ${i + 1}` : ""}</dt>
                    <dd><a href={explorerTx(sig, "devnet")} target="_blank" rel="noreferrer" className={`mono ${c.ext}`}>{shortAddr(sig, 8)} <IconExternal size={12} /></a></dd></Fragment>
                ))}
              </dl>
            )}
            <div className={c.actions}>
              <button className="btn btn-ghost" onClick={onClose}>Back to plan</button>
              <Link href="/dashboard" className="btn btn-primary">View my cover <IconArrowRight size={16} /></Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
