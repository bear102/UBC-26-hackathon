// DflowVenue (MAINNET). Real Kalshi outcome tokens via the DFlow Trade API.
// The server only ever RECEIVES unsigned txs from DFlow and hands them to the owner's wallet (Phantom); it never signs or
// sends anything on mainnet. Reads (getParsedTransaction) use MAINNET_RPC_URL.
//
// Buy:    GET {DFLOW_TRADE_BASE}/order?inputMint=USDC&outputMint=<YES|NO outcome mint>&amount=<raw USDC>&userPublicKey=<owner>
//         -> { transaction: base64, inAmount, outAmount, lastValidBlockHeight, routePlan[...] }
// Mints:  GET {DFLOW_METADATA_BASE}/market/{kalshiTicker} -> accounts[<settlement mint>].{yesMint,noMint}
// Redeem: after settlement, the winning outcome token is swapped back to USDC via /order (outcome -> USDC). That needs the
//         owner's signature, so redeem() throws OwnerSignatureRequired carrying the tx for the UI to get signed.
import { type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { env } from "../env";
import { store } from "../store";
import type { MarketContract, Position } from "../types";
import { getConnection } from "../solana/connection";
import { newPositionId, parsePubkey } from "./mock";
import { priceBuy } from "./pricing";
import { OwnerSignatureRequired, VenueError, type BuyArgs, type Side, type Venue } from "./types";

export const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface DflowOrder {
  transaction?: string; inAmount?: string; outAmount?: string; inputMint?: string; outputMint?: string;
  lastValidBlockHeight?: number; executionMode?: string; routePlan?: { outputMintDecimals?: number; inputMintDecimals?: number }[];
  [k: string]: unknown;
}

type FetchLike = typeof fetch;
export interface DflowOpts { fetch?: FetchLike; conn?: Connection; slippageBps?: number; confirmTimeoutMs?: number }

/** Pulls {yesMint,noMint} for a settlement mint out of a DFlow metadata market object (tolerant to shape drift). */
export function outcomeMintsFromMarket(m: unknown, settlement = MAINNET_USDC): { yesMint: string; noMint: string } | null {
  const o = (m && typeof m === "object" && "market" in (m as object) ? (m as { market: unknown }).market : m) as Record<string, unknown> | null;
  if (!o) return null;
  const accts = o.accounts as Record<string, { yesMint?: string; noMint?: string }> | undefined;
  const a = accts?.[settlement] ?? (accts ? Object.values(accts)[0] : undefined);
  const yesMint = a?.yesMint ?? (o.yesMint as string | undefined);
  const noMint = a?.noMint ?? (o.noMint as string | undefined);
  return yesMint && noMint ? { yesMint, noMint } : null;
}

export class DflowVenue implements Venue {
  readonly id = "dflow" as const;
  readonly network = "mainnet" as const;
  constructor(private opts: DflowOpts = {}) {}
  private get f(): FetchLike { return this.opts.fetch ?? fetch; }
  private get conn() { return this.opts.conn ?? getConnection("mainnet"); }
  private headers(): HeadersInit {
    const h: Record<string, string> = { accept: "application/json" };
    if (process.env.DFLOW_API_KEY) h["x-api-key"] = process.env.DFLOW_API_KEY;
    return h;
  }
  private async getJson<T>(url: string): Promise<T> {
    const r = await this.f(url, { headers: this.headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const text = await r.text();
    if (!r.ok) throw new VenueError(`DFlow ${r.status}: ${text.slice(0, 300)}`, 502, "dflow_http");
    try { return JSON.parse(text) as T; } catch { throw new VenueError(`DFlow returned non-JSON: ${text.slice(0, 200)}`, 502, "dflow_json"); }
  }

  async outcomeMint(contract: MarketContract, side: Side): Promise<string> {
    // 1) mints the market layer already pulled from DFlow metadata (lib/markets contractMeta), 2) ask DFlow directly.
    try {
      const cached = (await import("../markets")).contractMeta(contract.id)?.outcomeMints;
      if (cached) return side === "yes" ? cached.yesMint : cached.noMint;
    } catch { /* markets layer unavailable */ }
    const ticker = contract.symbol || contract.id.replace(/^kalshi:/, "");
    const m = await this.getJson<unknown>(`${env.dflowMeta()}/market/${encodeURIComponent(ticker)}`);
    const mints = outcomeMintsFromMarket(m);
    if (!mints) throw new VenueError(`DFlow market ${ticker} has no outcome mints (not tokenized yet?)`, 502, "dflow_no_mints");
    return side === "yes" ? mints.yesMint : mints.noMint;
  }

  /** GET /order — returns an UNSIGNED tx for `owner`. Never signed/sent here. */
  async order(p: { inputMint: string; outputMint: string; amount: bigint; owner: string }): Promise<DflowOrder> {
    const q = new URLSearchParams({
      inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString(),
      slippageBps: String(this.opts.slippageBps ?? 100), userPublicKey: p.owner,
    });
    const o = await this.getJson<DflowOrder>(`${env.dflowTrade()}/order?${q}`);
    if (!o.transaction) throw new VenueError(`DFlow /order returned no transaction: ${JSON.stringify(o).slice(0, 300)}`, 502, "dflow_no_tx");
    return o;
  }

  async buildBuyTx(a: BuyArgs): Promise<{ position: Position; txBase64: string }> {
    if (a.contract.venue !== "kalshi") throw new VenueError("DFlow only trades Kalshi contracts");
    const owner = parsePubkey(a.owner).toBase58();
    const { costUsd, raw } = priceBuy(a.contract, a.side, a.contracts, 6);
    const mint = await this.outcomeMint(a.contract, a.side);
    const o = await this.order({ inputMint: MAINNET_USDC, outputMint: mint, amount: raw, owner });
    const outDec = o.routePlan?.at(-1)?.outputMintDecimals ?? 6;
    const got = o.outAmount ? Math.floor(Number(o.outAmount) / 10 ** outDec) : a.contracts;
    const position: Position = {
      id: newPositionId(), businessId: a.businessId, owner, contractId: a.contract.id, side: a.side,
      contracts: got || a.contracts, costUsd: o.inAmount ? Number(o.inAmount) / 1e6 : costUsd, mint, txSig: "",
      network: "mainnet", status: "open", createdAt: new Date().toISOString(),
    };
    store.upsert("positions", position);
    return { position, txBase64: o.transaction! };
  }

  async confirmBuy(positionId: string, signature: string): Promise<Position> {
    const pos = store.get("positions", positionId);
    if (!pos) throw new VenueError(`unknown position ${positionId}`, 404, "not_found");
    if (pos.txSig) { if (pos.txSig === signature) return pos; throw new VenueError("already confirmed with another tx", 409, "conflict"); }
    const until = Date.now() + (this.opts.confirmTimeoutMs ?? 30_000);
    let t: ParsedTransactionWithMeta | null = null;
    for (;;) {
      t = await this.conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (t || Date.now() > until) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!t) throw new VenueError(`tx ${signature} not confirmed on mainnet yet; retry`, 404, "not_confirmed");
    if (t.meta?.err) throw new VenueError(`tx failed: ${JSON.stringify(t.meta.err)}`, 400, "tx_failed");
    const signed = t.transaction.message.accountKeys.some((k) => k.signer && k.pubkey.toBase58() === pos.owner);
    const post = (t.meta?.postTokenBalances ?? []).find((b) => b.mint === pos.mint && b.owner === pos.owner);
    if (!signed || !post) throw new VenueError("tx does not match position (owner/outcome mint)", 400, "mismatch");
    const updated = { ...pos, txSig: signature };
    store.upsert("positions", updated);
    store.feed({ id: `fill:${signature}`, source: "app", kind: "fill", txSig: signature, positionId,
      text: `Hedge filled on DFlow: ${pos.contracts} ${pos.side.toUpperCase()} × ${pos.contractId} for $${pos.costUsd.toFixed(2)} (mainnet)` });
    return updated;
  }

  /** Unsigned outcome -> USDC redemption tx for the owner to sign (after the market settles). */
  async buildRedeemTx(pos: Position): Promise<string> {
    const o = await this.order({ inputMint: pos.mint, outputMint: MAINNET_USDC, amount: BigInt(pos.contracts) * 1_000_000n, owner: pos.owner });
    return o.transaction!;
  }

  async redeem(pos: Position): Promise<{ txSig: string; payoutUsd: number }> {
    let tx: string | undefined;
    try { tx = await this.buildRedeemTx(pos); } catch { /* redemption may not be open yet */ }
    throw new OwnerSignatureRequired(`position ${pos.id} won: owner must sign the DFlow redemption`, tx);
  }
}

