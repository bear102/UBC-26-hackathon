"use client";
import { use, useEffect, useRef, useState } from "react";
import type { Keypair } from "@solana/web3.js";
import { getJSON, post, getKeypair, secretB58, sendUsdc, verify, usd, ex, short, type Config, type VerifyTick } from "@/lib/hh/client";
import type { PromiseView } from "@/lib/hh/views";

type RData = {
  code: { state: string; mine: boolean; receiptIndex?: number };
  promise: Omit<PromiseView, "orders" | "attestations"> & { orderCount: number; ordersFilled: number; attestations: { phase: number; capacity: number; sig?: string }[] };
  receipt: { index: number; sig: string; refunded: boolean; refundSig?: string } | null;
  balance: number | null;
};
type IssueRes = { ok: boolean; index?: number; sig?: string; error?: string; retry?: boolean };

export default function Receipt({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [kp, setKp] = useState<Keypair | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [d, setD] = useState<RData | null>(null);
  const [phase, setPhase] = useState<"issuing" | "issued" | "unhedged" | "error">("issuing");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ sig: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticks, setTicks] = useState<{ ticks: VerifyTick[]; source: string } | null>(null);
  const [cashTo, setCashTo] = useState("");
  const [showKey, setShowKey] = useState(false);
  const started = useRef(false);

  const refresh = async (k: Keypair) => {
    const r = await getJSON<RData>(`/api/receipts/${code}?holder=${k.publicKey.toBase58()}`).catch(() => null);
    if (r) { setD(r); if (r.code.mine && r.receipt) setPhase("issued"); }
    return r;
  };

  useEffect(() => {
    if (started.current) return; started.current = true;
    const k = getKeypair(); setKp(k);
    getJSON<Config>("/api/config").then(setCfg).catch((e) => setError(String(e.message)));
    (async () => {
      const first = await refresh(k);
      if (first?.code.mine && first.receipt) return;
      if (first && first.code.state === "used" && !first.code.mine) { setPhase("error"); setError("This code was already used on another phone."); return; }
      const t0 = Date.now();
      while (true) {
        const r = await post<IssueRes>("/api/receipts", { code, holder: k.publicKey.toBase58() }).catch((e) => ({ ok: false, error: String(e) }) as IssueRes);
        if (r.ok) { setPhase("issued"); await refresh(k); return; }
        if (r.error === "Unhedged") {
          setPhase("unhedged");
          if (Date.now() - t0 > 45_000) { setPhase("error"); setError("Sold out at this price."); return; }
          await new Promise((res) => setTimeout(res, 3000)); continue;
        }
        if (r.error === "Busy" && Date.now() - t0 < 20_000) { await new Promise((res) => setTimeout(res, 1500)); continue; }
        setPhase("error");
        setError(({ SalesClosed: "Sales closed.", SoldOut: "All promises at this price are taken.", CodeExpired: "This code expired. Ask the cashier for a new one.", CodeUsed: "This code was already used.", UnknownCode: "Unknown code." } as Record<string, string>)[r.error ?? ""] ?? `Busy, please ask the cashier again (${r.error})`);
        return;
      }
    })();
  }, [code]);

  useEffect(() => { if (!kp || phase !== "issued") return; const t = setInterval(() => refresh(kp), 5000); return () => clearInterval(t); }, [kp, phase]);

  const p = d?.promise;
  const oc = p?.onchain;
  const refund = p ? p.refundUnits / 1e6 : 1;
  const settledYes = p && (p.status === "SETTLED_YES" || (p.status === "CLOSED" && p.outcome?.yes));
  const settledNo = p && (p.status === "SETTLED_NO" || (p.status === "CLOSED" && p.outcome && !p.outcome.yes));
  const cutoffAtt = p?.attestations.filter((a) => a.phase >= 1) ?? [];

  async function spend(to: string) {
    if (!kp || !cfg) return;
    setBusy(true); setError("");
    try { const sig = await sendUsdc(cfg, kp, to, d?.balance ?? refund); setSent({ sig, to }); await refresh(kp); }
    catch (e) { setError(String((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <main className="narrow">
      {phase === "issuing" && <p className="big" style={{ marginTop: 40 }}><span className="spin" /> Locking in your promise…</p>}
      {phase === "unhedged" && (
        <div className="card" style={{ marginTop: 30 }}>
          <p className="big">No hedge, no promise (yet).</p>
          <p><span className="spin" /> The shop’s agent is buying cover on Gemini…</p>
          <p className="small muted">A receipt can’t exist until Gemini says the hedge exists. This page retries by itself.</p>
        </div>
      )}
      {phase === "error" && <div className="card" style={{ marginTop: 30 }}><p className="big">{error}</p></div>}

      {phase === "issued" && p && (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            {settledYes ? (
              <>
                <p className="huge">{usd(refund)} is yours.</p>
                <p>Balance: <b>{d?.balance == null ? "Paying out…" : `${usd(d.balance)} test USDC`}</b> {d?.receipt?.refundSig && <a className="small" href={ex(d.receipt.refundSig)} target="_blank">payout tx</a>}</p>
                {!!d?.balance && d.balance > 0 && (
                  <div className="row">
                    <button onClick={() => spend(cfg!.merchant)} disabled={busy || !cfg}>Spend it here</button>
                    <input placeholder="Solana address" value={cashTo} onChange={(e) => setCashTo(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                    <button className="secondary" onClick={() => spend(cashTo)} disabled={busy || cashTo.length < 32}>Cash out</button>
                  </div>
                )}
                {sent && <p className="ok small">Sent {usd(refund)} {sent.to === cfg?.merchant ? `to ${p.merchantName}` : `to ${short(sent.to)}`}. Your balance {usd(d?.balance)}. <a href={ex(sent.sig)} target="_blank">tx</a>{sent.to === cfg?.merchant && <><br />The shop honors it as {usd(refund * 1.25)} off your next visit (merchant’s choice).</>}</p>}
              </>
            ) : settledNo ? (
              <><p className="big">{p.card.sentence.replace(/→.*$/, "")}: didn’t happen. No refund this time.</p><p className="muted">The shop’s whole cost was its {usd(p.premium)} hedge.</p></>
            ) : (
              <>
                <p className="big">{promiseLine(p.card.sentence, refund)}</p>
                <p className="small">Receipt #{d?.receipt?.index} · {p.merchantName} already locked {usd(oc ? (oc.cap * refund) : p.cap * refund)} for {p.cap} customers in a vault it can’t touch · {p.mode === "paper" ? "Hedge simulated on Gemini’s live book (paper)" : p.venue.sandbox ? "Hedged on Gemini (sandbox) ✓" : "Hedged on Gemini ✓"}</p>
                {cutoffAtt.length > 0 && (oc && oc.heldBpsMin >= 10000 ? <p className="ok small">Hedge held at sales close ✓</p> : <p className="small"><b>Hedge reduced: your {usd(refund)} is still in the vault.</b></p>)}
              </>
            )}
            {error && <p className="err small">{error}</p>}
          </div>

          {(settledYes || settledNo) && (
            <div className="card">
              <button className="secondary" onClick={async () => setTicks(await verify({ id: p.id, resolveBase: p.venue.resolve, card: p.card, onchain: oc ? { status: oc.status, outcomeHash: oc.outcomeHash, winningSymbol: oc.winningSymbol, strip: oc.strip, refunded: oc.refunded } : null }))}>Verify with Gemini</button>
              {ticks && <div style={{ marginTop: 8 }}>{ticks.ticks.map((t, i) => <div className="tick" key={i}><span className={t.ok ? "ok" : t.ok === false ? "err" : "muted"}>{t.ok ? "✓" : t.ok === false ? "✗" : "…"}</span><span>{t.label}{t.ok === false && " · Does not match: report"}</span></div>)}<p className="small muted">{ticks.source}</p></div>}
            </div>
          )}

          <details className="card"><summary>How do I know?</summary>
            <p className="small">Vault balance: <b>{usd(p.vaultBalance)}</b> · <a href={p.links.vault} target="_blank">vault on Explorer</a> · <a href={p.links.promise} target="_blank">promise account</a></p>
            <p className="small">Hedge: {p.ordersFilled} contracts across {p.orderCount} Gemini orders{p.mode === "paper" ? " (PAPER: simulated against the live book)" : ""} · <a href={`/p/${p.id}/hedge.json`} target="_blank">order ids</a> · order hash <span className="mono">{oc ? short(oc.ordersHash, 6) : ""}</span></p>
            <p className="small"><b>Gemini’s rules (your terms):</b> {p.card.rules_text}</p>
            <p className="small">If the event is cancelled or Gemini’s review runs past 72 h, customers are paid and the shop bears the cost.</p>
            <p className="small"><a href={`/p/${p.id}/terms.json`} target="_blank">terms.json</a> (sha256 <span className="mono">{short(p.termsHash, 6)}</span>, stored onchain)</p>
          </details>

          <details className="card"><summary>Save my backup link</summary>
            <p className="small">Your $ lives with a key in this browser. Save this link somewhere safe to open it on another device.</p>
            {kp && <><button className="secondary" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/w#sk=${secretB58(kp)}`); setShowKey(true); }}>Copy backup link</button>{showKey && <p className="mono small">{location.origin}/w#sk={secretB58(kp)}</p>}</>}
            <p className="small"><a href="/w">All my receipts</a></p>
          </details>
        </>
      )}
      <p className="footer">Demo: test dollars (devnet USDC). Hedges are {p?.mode === "paper" ? "simulated against Gemini’s live book (paper mode)" : p?.venue.sandbox ? "real orders on Gemini’s sandbox exchange" : "real Gemini contracts"}.</p>
    </main>
  );
}

function promiseLine(sentence: string, refund: number) {
  const cond = sentence.split("→")[0].trim().replace(/\s+$/, "");
  return `If ${cond.replace(/\btonight\b/i, "tonight")}, ${usd(refund)} comes back to you.`;
}
