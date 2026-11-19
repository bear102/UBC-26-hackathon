"use client";
// Wallet diagnostics: talks to Phantom's injected provider directly (no wallet-adapter) and shows the raw error.
import { useState } from "react";

type Line = { t: string; msg: string };
type PhantomProvider = {
  isPhantom?: boolean; isConnected?: boolean; publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  on?(ev: string, cb: (...a: unknown[]) => void): void;
};

function provider(): PhantomProvider | undefined {
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : undefined);
}

function describe(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return JSON.stringify({ name: o.name, code: o.code, message: o.message, data: o.data, cause: String(o.cause ?? "") });
  }
  return String(e);
}

export default function WalletDebug() {
  const [log, setLog] = useState<Line[]>([]);
  const add = (msg: string) => setLog((l) => [...l, { t: new Date().toLocaleTimeString(), msg }]);

  function env() {
    const p = provider();
    add(`origin=${location.origin} secureContext=${window.isSecureContext} inIframe=${window.self !== window.top}`);
    add(`window.phantom.solana=${!!(window as any).phantom?.solana} window.solana.isPhantom=${!!(window as any).solana?.isPhantom} provider.isConnected=${p?.isConnected}`);
    const ws = (window as any).navigator?.wallets;
    add(`navigator.wallets (wallet standard registry) present=${!!ws}`);
  }
  async function connect(onlyIfTrusted: boolean) {
    const p = provider();
    if (!p) return add("No Phantom provider injected (extension missing/disabled for this site?)");
    try {
      const r = await p.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
      add(`CONNECTED ${r.publicKey.toString()}`);
    } catch (e) { add(`connect(${onlyIfTrusted ? "onlyIfTrusted" : ""}) FAILED: ${describe(e)}`); }
  }
  async function disconnect() {
    try { await provider()?.disconnect(); add("disconnected"); } catch (e) { add(`disconnect FAILED: ${describe(e)}`); }
  }
  function clearStorage() {
    try { ["walletName", "hh.walletOk"].forEach((k) => localStorage.removeItem(k)); add("cleared saved wallet choice"); } catch (e) { add(String(e)); }
  }

  return (
    <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "ui-monospace, monospace" }}>
      <h1 style={{ fontFamily: "inherit" }}>Wallet diagnostics</h1>
      <p>Talks to Phantom directly (no wallet-adapter). Copy the log below and send it over.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        <button onClick={env}>1. Check environment</button>
        <button onClick={() => connect(false)}>2. Connect (popup)</button>
        <button onClick={() => connect(true)}>3. Connect only if trusted</button>
        <button onClick={disconnect}>Disconnect</button>
        <button onClick={clearStorage}>Clear saved wallet</button>
      </div>
      <pre style={{ whiteSpace: "pre-wrap", background: "#111", color: "#9f9", padding: 12, borderRadius: 8, minHeight: 120 }}>
        {log.map((l) => `${l.t}  ${l.msg}`).join("\n") || "(log empty)"}
      </pre>
    </main>
  );
}
