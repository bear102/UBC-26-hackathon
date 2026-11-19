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
      await devnetFaucet(owner); // devnet only: tops the wallet up to $50 test dollars + fee SOL; no-op otherwise
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
    { id: "build", label: isCover ? "Building policy transaction" : "Building hedge transaction (desk co-signs)" },
    { id: "signing", label: "Approve in your wallet" },
    { id: "sending", label: "Sending to Solana devnet" },
    { id: "confirming", label: "Waiting for confirmation" },
    ...(isCover ? [] : [{ id: "record" as Stage, label: "Recording your position" }]),
  ];
  const idxOf = (s: Stage | null) => (s ? ORDER.indexOf(s) : -1);

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="co-title">
        <div className="row between" style={{ marginBottom: 8 }}>
          <span className="eyebrow">{isCover ? "Hedgehog Cover · onchain policy" : "Buy hedge · outcome tokens"}</span>
          <span className="badge badge-devnet">Devnet</span>
        </div>
        <h2 id="co-title" style={{ fontSize: "1.5rem" }}>{risk?.title ?? line.contract.eventTitle}</h2>
        <p className="muted small">{isCover
          ? <>Pay the premium in test USDC to the Hedgehog underwriter program. If <b>{risk?.trigger ?? line.contract.label}</b>, the program pays you from its vault.</>
          : <>{line.contracts.toLocaleString()} × <b>{line.contract.label}</b> on {VENUE_LABEL[line.contract.venue]} at ~{cents(line.pricePerContract)}. Each token pays $1 if it happens.</>}
        </p>

        <div className="grid grid-2" style={{ margin: "14px 0" }}>
          <div className="card-soft"><span className="xs muted">Pays you if it happens</span><div className="num pay" style={{ fontSize: "1.5rem", fontWeight: 700 }}>{usd(line.payoutUsd)}</div></div>
          <div className="card-soft"><span className="xs muted">You pay now (test USDC)</span><div className="num cost" style={{ fontSize: "1.5rem", fontWeight: 700 }}>{usd(line.premiumUsd, 2)}</div></div>
        </div>

        {stage === "review" && (
          <>
            <p className="xs muted">{isCover
              ? "Trust model: Hedgehog's attestor settles the policy from the market's official result. If it never settles, you can reclaim the premium after expiry."
              : "The trade desk partially signs the transaction; your wallet adds your signature. You receive SPL outcome tokens you can see in your wallet."}
              {gemini && " Priced off Gemini's live book; Hedgehog backs your cover with the same contract on Gemini."}</p>
            {mock && <div className="alert alert-info small" style={{ marginBottom: 12 }}>Demo mode: this checkout is simulated, nothing is sent onchain.</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={start}>{connected || mock ? (isCover ? "Buy cover" : "Buy hedge") : "Connect wallet & buy"}</button>
            </div>
          </>
        )}

        {stage !== "review" && (
          <ol className="steps" style={{ margin: "8px 0 16px" }} aria-live="polite">
            {steps.map((s) => {
              const i = idxOf(s.id), c = idxOf(cur);
              const cls = stage === "done" || i < c || (s.id === "connect" && (connected || mock) && stage !== "connect") ? "done"
                : stage === "error" && s.id === failedAt ? "fail" : i === c ? "active" : "";
              return <li key={s.id} className={cls}><span className="ic">{cls === "done" ? "✓" : cls === "fail" ? "!" : ""}</span>{s.label}</li>;
            })}
          </ol>
        )}

        {stage === "connect" && <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={() => setVisible(true)}>Open wallet list</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>}

        {stage === "error" && (
          <>
            <div className="alert alert-bad" role="alert" style={{ marginBottom: 12 }}>{err}</div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button className="btn btn-primary" onClick={start}>Try again</button>
            </div>
          </>
        )}

        {stage === "done" && result && (
          <>
            <div className="alert alert-good" style={{ marginBottom: 12 }}>
              <b>{isCover ? "You're covered." : "Hedge bought."}</b>{" "}
              {isCover ? `Policy ${result.policyId ? `#${result.policyId}` : ""} is live onchain.` : `${line.contracts.toLocaleString()} outcome tokens are in your wallet.`}
              {result.simulated && " (simulated)"}
            </div>
            <dl className="kv" style={{ marginBottom: 16 }}>
              <dt>Transaction</dt>
              <dd>{result.simulated ? <span className="mono">{shortAddr(result.signature, 8)}</span>
                : <a href={explorerTx(result.signature, result.network)} target="_blank" rel="noreferrer" className="mono">{shortAddr(result.signature, 8)} ↗</a>}</dd>
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
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={onClose}>Back to plan</button>
              <Link href="/dashboard" className="btn btn-primary">View my cover →</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
