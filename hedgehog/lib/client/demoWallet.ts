"use client";
// Demo wallet: a devnet-only burner keypair kept in this browser's localStorage, exposed as a normal wallet-adapter
// wallet ("Demo wallet"). Lets judges try Hedgehog without installing Phantom/MetaMask. Never use with real funds.
import {
  BaseSignerWalletAdapter, WalletName, WalletReadyState, WalletNotConnectedError, WalletSignTransactionError,
  isVersionedTransaction, type TransactionOrVersionedTransaction, type SupportedTransactionVersions,
} from "@solana/wallet-adapter-base";
import { Keypair, type PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";

export const DemoWalletName = "Demo wallet" as WalletName<"Demo wallet">;
const KEY = "hh.demoWallet";
const ICON = "data:image/svg+xml;base64," + (typeof btoa !== "undefined" ? btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1f5c3a"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="#fff" font-family="sans-serif">D</text></svg>') : "");

export function hasDemoWallet(): boolean { try { return !!localStorage.getItem(KEY); } catch { return false; } }
function loadOrCreate(): Keypair {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    const kp = Keypair.generate();
    localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  } catch { return Keypair.generate(); }
}
export function resetDemoWallet() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

export class DemoWalletAdapter extends BaseSignerWalletAdapter {
  name = DemoWalletName;
  url = "https://178-156-138-228.sslip.io";
  icon = ICON;
  supportedTransactionVersions: SupportedTransactionVersions = new Set(["legacy", 0] as const);
  private _kp: Keypair | null = null;
  get publicKey(): PublicKey | null { return this._kp?.publicKey ?? null; }
  get connecting() { return false; }
  get readyState() { return typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable; }

  async connect(): Promise<void> {
    // Yield first: this wallet connects synchronously, and React runs child effects (our ConnectOnSelect) before
    // WalletProvider's effect attaches its "connect" listener. Emitting immediately lost the event, the adapter
    // then reported connected=true and every later connect() returned early, leaving the UI stuck on "Connect".
    await new Promise((r) => setTimeout(r, 0));
    if (!this._kp) this._kp = loadOrCreate();
    this.emit("connect", this._kp.publicKey); // (re-)emit even if already connected, so the provider's state syncs
  }
  async disconnect(): Promise<void> {
    this._kp = null;
    this.emit("disconnect");
  }
  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(tx: T): Promise<T> {
    const kp = this._kp;
    if (!kp) throw new WalletNotConnectedError();
    try {
      // Keep any existing signatures (the desk/quoter co-signs first): partialSign / VersionedTransaction.sign.
      if (isVersionedTransaction(tx)) (tx as VersionedTransaction).sign([kp]);
      else (tx as Transaction).partialSign(kp);
      return tx;
    } catch (e) { throw new WalletSignTransactionError((e as Error)?.message, e); }
  }
  /** "Cover all": sign several txs in one go (what Phantom shows as a single approval). */
  async signAllTransactions<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(txs: T[]): Promise<T[]> {
    const out: T[] = [];
    for (const tx of txs) out.push(await this.signTransaction(tx));
    return out;
  }

}
