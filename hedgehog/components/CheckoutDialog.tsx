"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { Position, QuoteLine, Risk } from "@/lib/types";
import { addMockPosition, coverBuy, coverConfirm, devnetFaucet, hedgeBuy, hedgeConfirm, sleep, type DeskHedge } from "@/lib/client/api";
import { isMock } from "@/lib/client/mode";
import { signAndSend, walletErrorMessage, type Network } from "@/lib/client/tx";
import { cents, explorerTx, orderText, shortAddr, usd, VENUE_LABEL } from "@/lib/client/format";
import { setLastOwner } from "@/lib/client/storage";
import { DEMO_OWNER } from "@/lib/fixtures";
import Link from "next/link";
import { GuillocheBand, Seal } from "./Engraving";
import { IconArrowRight, IconCheck, IconExternal } from "./Icons";
import s from "./CheckoutDialog.module.css";

export type CheckoutKind = "hedge" | "cover";
type Stage = "review" | "connect" | "build" | "signing" | "sending" | "confirming" | "record" | "done" | "error";
export type CheckoutResult = { kind: CheckoutKind; signature: string; network: Network; position?: Position; policyId?: string; policyPda?: string; simulated?: boolean; backing?: DeskHedge };

const ORDER: Stage[] = ["connect", "build", "signing", "sending", "confirming", "record", "done"];

export function CheckoutDialog({ kind, line, risk, businessId, onClose, onDone }: {
  kind: CheckoutKind; line: QuoteLine; risk?: Risk; businessId: string; onClose: () => void; onDone: (r: CheckoutResult) => void;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [stage, setStage] = useState<Stage>("review");
  const [err, setErr] = useState<string | null>(null);
  const [failedAt, setFailedAt] = useState<Stage | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const running = useRef(false);
  const mock = typeof window !== "undefined" && isMock();
  const isCover = kind === "cover";
  const gemini = line.contract.venue === "gemini";

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    let at: Stage = "build";
    const go = (s: Stage) => { at = s; setStage(s); };
    try {
      const owner = publicKey?.toBase58() ?? DEMO_OWNER;
      if (publicKey) setLastOwner(owner);
      if (mock) {
        go("build"); await sleep(700); go("signing"); await sleep(900); go("sending"); await sleep(600); go("confirming"); await sleep(900);
        const sig = `SIMULATED${Math.random().toString(36).slice(2)}${"1".repeat(40)}`;
        const position: Position | undefined = isCover ? undefined : {
          id: `pos_sim_${Date.now()}`, businessId, owner, contractId: line.contractId, side: line.side, contracts: line.contracts,
          costUsd: line.premiumUsd, mint: "SimulatedMint", txSig: sig, network: "devnet", status: "open", createdAt: new Date().toISOString(),
        };
        if (position) addMockPosition(position);
        const r: CheckoutResult = { kind, signature: sig, network: "devnet", position, policyId: isCover ? "sim" : undefined, simulated: true };
        setResult(r); go("done"); onDone(r); return;
      }
      if (!publicKey) throw new Error("Connect a wallet first.");
      go("build");
      await devnetFaucet(owner, line.premiumUsd); // devnet only: tops the wallet up to cover this purchase (min $500 test dollars) + fee SOL; no-op otherwise
      if (isCover) {
        const r = await coverBuy({
          owner, businessId, peril: risk?.peril ?? line.contract.peril, marketRef: line.contractId, trigger: risk?.trigger ?? line.contract.label,
          premiumUsd: line.premiumUsd, payoutUsd: line.payoutUsd, expiry: line.contract.expiry, side: line.side,
        });
        const sig = await signAndSend(signTransaction, r.txBase64, "devnet", (s) => go(s));
        let backing: DeskHedge | undefined;
        try { backing = (await coverConfirm(r.policyPda, sig))?.backing; } catch (e) { console.warn("cover confirm failed", e); }
        const res: CheckoutResult = { kind, signature: sig, network: "devnet", policyId: r.policyId, policyPda: r.policyPda, backing };
        setResult(res); go("done"); onDone(res);
      } else {
        // maxCostUsd = what the owner was shown; the server refuses (409 price_moved) if the live price is higher.
        const r = await hedgeBuy({ owner, contractId: line.contractId, side: line.side, contracts: line.contracts, businessId, maxCostUsd: line.premiumUsd });
        const net: Network = r.network === "mainnet" ? "mainnet" : "devnet";
        const sig = await signAndSend(signTransaction, r.txBase64, net, (s) => go(s));
        go("record");
        let position: Position | undefined, backing: DeskHedge | undefined;
        try { const p = await hedgeConfirm(r.positionId, sig); backing = p.backing; position = p; } catch (e) { console.warn("confirm failed", e); }
        const res: CheckoutResult = { kind, signature: sig, network: net, position, backing };
        setResult(res); go("done"); onDone(res);
      }
    } catch (e) {
      setFailedAt(at); setErr(walletErrorMessage(e)); setStage("error");
    } finally { running.current = false; }
  }, [publicKey, signTransaction, mock, isCover, kind, line, risk, businessId, onDone]);

  // When we're waiting for the wallet and it connects, continue automatically.
  useEffect(() => { if (stage === "connect" && connected && publicKey) run(); }, [stage, connected, publicKey, run]);

  function start() {
    setErr(null); setFailedAt(null);
    if (!mock && !connected) { setStage("connect"); setVisible(true); return; }
    run();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !["build", "signing", "sending", "confirming", "record"].includes(stage)) onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [stage, onClose]);

  const busy = ["build", "signing", "sending", "confirming", "record"].includes(stage);
  const cur = stage === "error" ? failedAt : stage;
  const steps: { id: Stage; label: string }[] = [
    { id: "connect", label: connected || mock ? `Wallet ${mock ? "(simulated)" : shortAddr(publicKey?.toBase58())}` : "Connect Phantom (devnet)" },
    { id: "build", label: isCover ? "Building policy transaction" : "Building hedge transaction" },
    { id: "signing", label: "Approve in your wallet" },
    { id: "sending", label: "Sending to Solana devnet" },
    { id: "confirming", label: "Waiting for confirmation" },
    ...(isCover ? [] : [{ id: "record" as Stage, label: "Recording your position" }]),
  ];
  const idxOf = (s: Stage | null) => (s ? ORDER.indexOf(s) : -1);

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="co-title">
        <div className={s.kindRow}>
          <span className="eyebrow">{isCover ? "Hedgehog Cover · policy on Solana" : "Buy hedge · outcome tokens"}</span>
        </div>
        <h2 id="co-title" className={s.title}>{risk?.title ?? line.contract.eventTitle}</h2>
        <p className={s.lede}>{isCover
          ? <>Pay the premium in test USDC. If <b>{risk?.trigger ?? line.contract.label}</b>, the Hedgehog program pays you from its vault.</>
          : <>{line.contracts.toLocaleString()} × <b>{line.contract.label}</b> on {VENUE_LABEL[line.contract.venue]} at ~{cents(line.pricePerContract)}. Each token pays $1 if it happens.</>}
        </p>

        {stage !== "done" && (
          <div className={`terms ${s.terms}`}>
            <div className="term pay"><span className="lab">Pays you if it happens</span><span className="amt">{usd(line.payoutUsd)}</span></div>
            <div className="term cost"><span className="lab">You pay now (test USDC)</span><span className="amt">{usd(line.premiumUsd, 2)}</span></div>
          </div>
        )}

        {stage === "review" && (
          <>
            <p className={`xs muted ${s.trust}`}>{isCover
              ? "Hedgehog settles it from the market's official result. If it never settles, you can reclaim the premium after expiry."
              : "The outcome tokens go straight to your wallet."}
              {gemini && " Backed by the same contract on Gemini."}
              {line.contract.venue === "hedgehog" && " Settles from public data (USGS, NOAA, NIFC, US AQI). Underwritten by the Hedgehog pool · no exchange backing."}
              {" "}Devnet prototype, not an insurance product. Pays on the market's result, not your actual loss.</p>
            {mock && <div className="alert alert-info small" style={{ marginBottom: 12 }}>Demo mode: simulated, nothing goes onchain.</div>}
            <div className={s.actions}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={start}>{connected || mock ? (isCover ? "Get covered" : "Buy hedge") : "Connect wallet & get covered"}</button>
            </div>
          </>
        )}

        {stage !== "review" && (
          <ol className={`steps ${s.steps}`} aria-live="polite">
            {steps.map((s) => {
              const i = idxOf(s.id), c = idxOf(cur);
              const cls = stage === "done" || i < c || (s.id === "connect" && (connected || mock) && stage !== "connect") ? "done"
                : stage === "error" && s.id === failedAt ? "fail" : i === c ? "active" : "";
              return <li key={s.id} className={cls}><span className="ic">{cls === "done" ? <IconCheck size={14} /> : cls === "fail" ? "!" : ""}</span>{s.label}</li>;
            })}
          </ol>
        )}

        {stage === "connect" && <div className={s.actions}><button className="btn" onClick={() => setVisible(true)}>Open wallet list</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>}

        {stage === "error" && (
          <>
            <div className="alert alert-bad" role="alert" style={{ marginBottom: 12 }}>{err}</div>
            <div className={s.actions}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={start}>Try again</button>
            </div>
          </>
        )}

        {stage === "done" && result && (
          <>
            <div className={`cert ${s.receipt}`}>
              <div className="cert-frame">
                <GuillocheBand />
                <div className={`cert-in ${s.receiptIn}`}>
                  <div className="cert-head">
                    <div><div className="cert-kicker">{result.simulated ? "Simulated · devnet" : "Solana devnet"}</div><div className="cert-title">{isCover ? "Cover bound" : "Hedge bought"}</div></div>
                  </div>
                  <p className={s.receiptMsg}>
                    <b>{isCover ? "You're covered." : "Hedge bought."}</b>{" "}
                    {isCover ? `Policy ${result.policyId ? `#${result.policyId}` : ""} is live onchain.` : `${line.contracts.toLocaleString()} outcome tokens are in your wallet.`}
                    {result.simulated && " (simulated)"}
                  </p>
                  <div className="terms">
                    <div className="term pay"><span className="lab">Pays if it happens</span><span className={`amt ${s.amt}`}>{usd(line.payoutUsd)}</span></div>
                    <div className="term cost"><span className="lab">Premium paid</span><span className={`amt ${s.amt}`}>{usd(line.premiumUsd, 2)}</span></div>
                  </div>
                </div>
                <GuillocheBand tone="red" />
              </div>
              <div className={`seal-stamp now ${s.seal}`}><Seal /></div>
            </div>
            <dl className={`kv ${s.kv}`}>
              <dt>Transaction</dt>
              <dd>{result.simulated ? <span className="mono">{shortAddr(result.signature, 8)}</span>
                : <a href={explorerTx(result.signature, result.network)} target="_blank" rel="noreferrer" className={`mono ${s.ext}`}>{shortAddr(result.signature, 8)} <IconExternal size={12} /></a>}</dd>
              {result.policyPda && <><dt>Policy account</dt><dd className="mono">{shortAddr(result.policyPda, 6)}</dd></>}
              {result.position?.mint && !result.simulated && <><dt>Token mint</dt><dd className="mono">{shortAddr(result.position.mint, 6)}</dd></>}
              {(result.backing || (gemini && result.simulated)) && <>
                <dt>Backed on Gemini</dt>
                <dd className="small">
                  {result.backing
                    ? <><span className="mono">{orderText(result.backing)}</span> <span className="badge badge-gemini">{result.backing.mode === "live" ? result.backing.status : "dry-run"}</span>{result.backing.error ? <span className="muted"> · {result.backing.error}</span> : null}</>
                    : <><span className="mono">BUY {line.contracts.toLocaleString()} {line.side.toUpperCase()} {line.contract.symbol}</span> <span className="badge badge-gemini">dry-run</span></>}
                </dd>
              </>}
            </dl>
            <div className={s.actions}>
              <button className="btn btn-ghost" onClick={onClose}>Back to plan</button>
              <Link href="/dashboard" className="btn btn-primary">View my cover <IconArrowRight size={16} /></Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
