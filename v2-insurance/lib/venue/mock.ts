// MockDflowVenue (DEVNET). Mirrors DFlow's shape: the API returns a tx for the owner's wallet to sign.
// A "desk" keypair (keys/desk.json) is market maker + mint authority of one 0-decimal SPL outcome mint per (contract, side).
//
// Buy tx (fee payer = owner; desk partially signs):
//   1. transferChecked  owner settlement ATA -> desk settlement ATA   (contracts × ask, rounded up to cents)
//   2. createATAIdempotent  owner outcome ATA
//   3. mintTo           desk mints `contracts` outcome tokens -> owner
//   4. approve          owner approves the desk as delegate over its outcome ATA (existing delegation + contracts)
//   5. memo             "hedgehog:{positionId}"
// Redeem (crank, desk-only signature, atomic):
//   burn (desk as delegate) min(contracts, balance, delegated) outcome tokens from the owner's ATA,
//   transferChecked $1 × burned from desk -> owner settlement ATA (desk mints the shortfall if it is the settlement
//   mint authority, i.e. our e2e test dollar), memo "hedgehog:redeem:{positionId}".
// The approve at buy time is what lets the desk burn the winner's tokens without a second owner signature, so the
// payout is automatic (insurance-like). If the owner moved the tokens away, only what's still burnable is paid.
import {
  PublicKey, Transaction, TransactionInstruction,
  type Connection, type Keypair, type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  TokenAccountNotFoundError, TokenInvalidAccountOwnerError, createApproveInstruction, createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction, createMint, createMintToInstruction, createTransferCheckedInstruction, getAccount,
  getAssociatedTokenAddressSync, getMint, getOrCreateAssociatedTokenAccount, type Account,
} from "@solana/spl-token";
import { env } from "../env";
import { store } from "../store";
import type { Position } from "../types";
import { getConnection } from "../solana/connection";
import { deskKeypair } from "./desk";
import { MintRegistry } from "./mints";
import { sendAndPoll } from "./tx";
import { priceBuy, usdToRaw } from "./pricing";
import { VenueError, type BuyArgs, type Side, type Venue } from "./types";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const memoIx = (text: string) => new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(text, "utf8") });
export const buyMemo = (positionId: string) => `hedgehog:${positionId}`;
export const redeemMemo = (positionId: string) => `hedgehog:redeem:${positionId}`;

export function newPositionId(): string {
  return `pos_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function parsePubkey(s: string, what = "owner"): PublicKey {
  try { return new PublicKey(s); } catch { throw new VenueError(`invalid ${what} pubkey`); }
}

async function tryGetAccount(conn: Connection, addr: PublicKey): Promise<Account | null> {
  try { return await getAccount(conn, addr, "confirmed"); } catch (e) {
    if (e instanceof TokenAccountNotFoundError || e instanceof TokenInvalidAccountOwnerError) return null;
    throw e;
  }
}

export interface MockVenueOpts { conn?: Connection; desk?: Keypair; mints?: MintRegistry; confirmTimeoutMs?: number }

export class MockDflowVenue implements Venue {
  readonly id = "mock" as const;
  readonly network = "devnet" as const;
  private decimalsCache = new Map<string, { decimals: number; authority: string | null }>();
  private deskAtas = new Set<string>();
  private mintLocks = new Map<string, Promise<PublicKey>>();

  constructor(private opts: MockVenueOpts = {}) {}
  get conn() { return this.opts.conn ?? getConnection("devnet"); }
  get desk() { return this.opts.desk ?? deskKeypair(); }
  get mints() { return (this.opts.mints ??= new MintRegistry()); }
  settlementMint() { return parsePubkey(env.usdcMint(), "USDC_MINT"); }

  async settlementInfo(mint = this.settlementMint()) {
    const k = mint.toBase58();
    let v = this.decimalsCache.get(k);
    if (!v) {
      const m = await getMint(this.conn, mint, "confirmed");
      v = { decimals: m.decimals, authority: m.mintAuthority?.toBase58() ?? null };
      this.decimalsCache.set(k, v);
    }
    return v;
  }

  /** Desk's settlement-token ATA (created by the desk if missing). */
  async deskSettlementAta(mint = this.settlementMint()): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, this.desk.publicKey);
    if (!this.deskAtas.has(ata.toBase58())) {
      await getOrCreateAssociatedTokenAccount(this.conn, this.desk, mint, this.desk.publicKey, false, "confirmed");
      this.deskAtas.add(ata.toBase58());
    }
    return ata;
  }

  /** Get or create the outcome mint for (contractId, side). Desk pays rent and is mint authority. */
  async outcomeMint(contractId: string, side: Side): Promise<PublicKey> {
    const rec = this.mints.get(contractId, side, this.desk.publicKey.toBase58());
    if (rec) return new PublicKey(rec.mint);
    const key = `${contractId}|${side}`;
    let p = this.mintLocks.get(key);
    if (!p) {
      p = (async () => {
        const mint = await createMint(this.conn, this.desk, this.desk.publicKey, null, 0, undefined, { commitment: "confirmed" });
        this.mints.set({ contractId, side, mint: mint.toBase58(), authority: this.desk.publicKey.toBase58(), createdAt: new Date().toISOString() });
        return mint;
      })().finally(() => this.mintLocks.delete(key));
      this.mintLocks.set(key, p);
    }
    return p;
  }

  async buildBuyTx(a: BuyArgs): Promise<{ position: Position; txBase64: string }> {
    const owner = parsePubkey(a.owner);
    const settle = this.settlementMint();
    const { decimals } = await this.settlementInfo(settle);
    const { costUsd, raw } = priceBuy(a.contract, a.side, a.contracts, decimals);

    const ownerSettleAta = getAssociatedTokenAddressSync(settle, owner, true);
    const ownerSettle = await tryGetAccount(this.conn, ownerSettleAta);
    if (!ownerSettle) throw new VenueError(`wallet has no test-USDC account for mint ${settle.toBase58()} (get devnet USDC at faucet.circle.com)`, 402, "no_usdc");
    if (ownerSettle.amount < raw) throw new VenueError(`wallet has ${Number(ownerSettle.amount) / 10 ** decimals} test USDC, needs ${costUsd}`, 402, "insufficient_usdc");

    const deskAta = await this.deskSettlementAta(settle);
    const mint = await this.outcomeMint(a.contract.id, a.side);
    const ownerOutcomeAta = getAssociatedTokenAddressSync(mint, owner, true);
    const existing = await tryGetAccount(this.conn, ownerOutcomeAta);
    const priorDelegated = existing?.delegate?.equals(this.desk.publicKey) ? existing.delegatedAmount : 0n;

    const position: Position = {
      id: newPositionId(), businessId: a.businessId, owner: owner.toBase58(), contractId: a.contract.id, side: a.side,
      contracts: a.contracts, costUsd, mint: mint.toBase58(), txSig: "", network: "devnet", status: "open",
      createdAt: new Date().toISOString(),
    };

    const tx = new Transaction();
    tx.add(
      createTransferCheckedInstruction(ownerSettleAta, settle, deskAta, owner, raw, decimals),
      createAssociatedTokenAccountIdempotentInstruction(owner, ownerOutcomeAta, owner, mint),
      createMintToInstruction(mint, ownerOutcomeAta, this.desk.publicKey, BigInt(a.contracts)),
      createApproveInstruction(ownerOutcomeAta, this.desk.publicKey, owner, priorDelegated + BigInt(a.contracts)),
      memoIx(buyMemo(position.id)),
    );
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("confirmed");
    tx.feePayer = owner;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.partialSign(this.desk);
    const txBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    store.upsert("positions", position);
    return { position, txBase64 };
  }

  private async fetchTx(signature: string, timeoutMs: number): Promise<ParsedTransactionWithMeta | null> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const t = await this.conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (t || Date.now() > until) return t;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async confirmBuy(positionId: string, signature: string): Promise<Position> {
    const pos = store.get("positions", positionId);
    if (!pos) throw new VenueError(`unknown position ${positionId}`, 404, "not_found");
    if (pos.txSig) {
      if (pos.txSig === signature) return pos;
      throw new VenueError(`position ${positionId} already confirmed with another tx`, 409, "conflict");
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new VenueError("invalid signature");
    const t = await this.fetchTx(signature, this.opts.confirmTimeoutMs ?? 30_000);
    if (!t) throw new VenueError(`tx ${signature} not found/confirmed on devnet yet; retry`, 404, "not_confirmed");
    verifyBuyTx(t, pos);
    const updated: Position = { ...pos, txSig: signature };
    store.upsert("positions", updated);
    store.feed({
      id: `fill:${signature}`, source: "app", kind: "fill", txSig: signature, positionId,
      text: `Hedge filled: ${pos.contracts} ${pos.side.toUpperCase()} × ${pos.contractId} for $${pos.costUsd.toFixed(2)} (devnet)`,
    });
    return updated;
  }

  /** Recovery for the crank: find a landed buy tx for an unconfirmed position via the memo on the owner's outcome ATA. */
  async findBuySignature(pos: Position): Promise<string | null> {
    const ata = getAssociatedTokenAddressSync(new PublicKey(pos.mint), new PublicKey(pos.owner), true);
    const sigs = await this.conn.getSignaturesForAddress(ata, { limit: 50 }, "confirmed");
    const hit = sigs.find((s) => !s.err && s.memo?.includes(buyMemo(pos.id)) && !s.memo.includes(redeemMemo(pos.id)));
    return hit?.signature ?? null;
  }

  async redeem(pos: Position): Promise<{ txSig: string; payoutUsd: number }> {
    if (pos.network !== "devnet") throw new VenueError("mock venue only redeems devnet positions");
    if (!pos.txSig) throw new VenueError(`position ${pos.id} has no confirmed buy`);
    const owner = new PublicKey(pos.owner);
    const mint = new PublicKey(pos.mint);
    const ownerOutcomeAta = getAssociatedTokenAddressSync(mint, owner, true);

    // Idempotency: a previous crank run may have paid but crashed before saving.
    const prev = (await this.conn.getSignaturesForAddress(ownerOutcomeAta, { limit: 50 }, "confirmed"))
      .find((s) => !s.err && s.memo?.includes(redeemMemo(pos.id)));
    if (prev) return { txSig: prev.signature, payoutUsd: pos.payoutUsd ?? pos.contracts };

    const acct = await tryGetAccount(this.conn, ownerOutcomeAta);
    const delegated = acct?.delegate?.equals(this.desk.publicKey) ? acct.delegatedAmount : 0n;
    const burnable = [BigInt(pos.contracts), acct?.amount ?? 0n, delegated].reduce((m, v) => (v < m ? v : m));
    if (burnable <= 0n) return { txSig: "", payoutUsd: 0 };

    const settle = this.settlementMint();
    const { decimals, authority } = await this.settlementInfo(settle);
    const payoutUsd = Number(burnable);
    const payoutRaw = usdToRaw(payoutUsd, decimals);
    const deskAta = await this.deskSettlementAta(settle);
    const deskBal = (await getAccount(this.conn, deskAta, "confirmed")).amount;
    const ownerSettleAta = getAssociatedTokenAddressSync(settle, owner, true);

    const tx = new Transaction();
    if (deskBal < payoutRaw) {
      if (authority !== this.desk.publicKey.toBase58()) {
        throw new VenueError(`desk underfunded: has ${Number(deskBal) / 10 ** decimals}, owes ${payoutUsd} (fund ${this.desk.publicKey.toBase58()} with devnet USDC)`, 503, "desk_underfunded");
      }
      tx.add(createMintToInstruction(settle, deskAta, this.desk.publicKey, payoutRaw - deskBal));
    }
    tx.add(
      createBurnInstruction(ownerOutcomeAta, mint, this.desk.publicKey, burnable),
      createAssociatedTokenAccountIdempotentInstruction(this.desk.publicKey, ownerSettleAta, owner, settle),
      createTransferCheckedInstruction(deskAta, settle, ownerSettleAta, this.desk.publicKey, payoutRaw, decimals),
      memoIx(redeemMemo(pos.id)),
    );
    const txSig = await sendAndPoll(this.conn, tx, [this.desk]);
    return { txSig, payoutUsd };
  }
}

/** Checks a landed tx really is the buy for this position (success, memo, owner signed, outcome mint touched). */
export function verifyBuyTx(t: ParsedTransactionWithMeta, pos: Position) {
  if (t.meta?.err) throw new VenueError(`tx failed on-chain: ${JSON.stringify(t.meta.err)}`, 400, "tx_failed");
  const keys = t.transaction.message.accountKeys.map((k) => ({ key: k.pubkey.toBase58(), signer: k.signer }));
  if (!keys.some((k) => k.key === pos.owner && k.signer)) throw new VenueError("tx not signed by the position owner", 400, "mismatch");
  if (!keys.some((k) => k.key === pos.mint)) throw new VenueError("tx does not touch the position's outcome mint", 400, "mismatch");
  const logs = (t.meta?.logMessages ?? []).join("\n");
  const memoInIx = JSON.stringify(t.transaction.message.instructions).includes(buyMemo(pos.id));
  if (!logs.includes(buyMemo(pos.id)) && !memoInIx) throw new VenueError("tx memo does not match the position", 400, "mismatch");
}
