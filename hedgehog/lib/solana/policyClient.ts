// Hedgehog Cover (hedgehog_policy Anchor program) client. Server-only (reads keys/ from disk).
// - Builds UNSIGNED, owner-pays-fee txs (base64) for register_business + buy_policy, for Phantom to sign.
// - Reads policies / underwriter state.
// - Sends attestor-signed settle_policy and anyone-signed expire_policy (the crank).
import { getConnection } from "./connection";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { env } from "../env";
import type { Peril } from "../types";
import idlJson from "./idl/hedgehog_policy.json";
import type { HedgehogPolicy } from "./idl/hedgehog_policy";

export const PROGRAM_ID = new PublicKey(idlJson.address);
export const USDC_DECIMALS = 6;

/** Peril <-> on-chain u8 code. */
export const PERIL_CODES: Record<Peril, number> = {
  other: 0, heat: 1, cold: 2, rain: 3, game: 4, oil: 5, gas: 6, fed: 7, cpi: 8, crypto: 9,
  snow: 10, power: 11, water: 12, quake: 13, storm: 14, natgas: 15, metals: 16,
  flood: 17, smoke: 18, hail: 19, wildfire: 20, // Hedgehog parametric cover (lib/markets/parametric)
};
export const perilFromCode = (c: number): Peril =>
  (Object.entries(PERIL_CODES).find(([, v]) => v === c)?.[0] as Peril) ?? "other";

export type PolicyStatus = "open" | "paidOut" | "expired" | "refunded";

export interface DecodedPolicy {
  pda: string;
  owner: string;
  business: string;
  policyId: number;
  peril: Peril;
  perilCode: number;
  marketRef: string;
  triggerHash: string; // hex
  premiumUsd: number;
  payoutUsd: number;
  createdAt: string; // ISO
  expiry: string; // ISO
  status: PolicyStatus;
  settledAt: string | null;
}

export interface CoverInfo {
  programId: string;
  underwriterPda: string;
  initialized: boolean;
  authority?: string;
  attestor?: string;
  mint?: string;
  vault?: string;
  vaultBalance?: number; // USD
  exposure?: number; // USD
  maxExposure?: number; // USD
  freeCapacity?: number; // USD = vault - exposure
  graceSecs?: number;
  policiesSold?: number;
}

// ---------------------------------------------------------------- helpers

export const toUnits = (usd: number) => new BN(Math.round(usd * 10 ** USDC_DECIMALS));
/** Purchases are not capped by a monthly budget (the owner's budget only sizes the quote). The deployed program still
 *  enforces a per-business 30-day budget, so every business is registered / topped up to this effectively unlimited
 *  value and the check can never trip. ($1B: 1e15 units, inside JS's safe-integer range.) */
export const NO_BUDGET_USD = 1_000_000_000;
export const fromUnits = (v: BN | bigint | number | string) => Number(v.toString()) / 10 ** USDC_DECIMALS;
export const triggerHash = (trigger: string) => Array.from(createHash("sha256").update(trigger).digest());

/** Underwriter PDA, one per settlement mint: ["uw", mint]. */
export function underwriterPda(mint: PublicKey, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from("uw"), mint.toBuffer()], programId)[0];
}
export function businessPda(owner: PublicKey, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from("biz"), owner.toBuffer()], programId)[0];
}
/** Policy PDA: ["pol", underwriter, business, policy_id] (policies are bound to their underwriter's vault). */
export function policyPda(underwriter: PublicKey, business: PublicKey, policyId: number | BN, programId = PROGRAM_ID) {
  const id = new BN(policyId.toString()).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync([Buffer.from("pol"), underwriter.toBuffer(), business.toBuffer(), id], programId)[0];
}

/** Load a keypair JSON from keys/ (e.g. "attestor"). Never log its contents. */
export function loadKeypair(nameOrPath: string): Keypair {
  const p = nameOrPath.includes("/") || nameOrPath.endsWith(".json")
    ? path.resolve(nameOrPath)
    : path.join(env.keysDir(), `${nameOrPath}.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function walletFor(kp?: Keypair) {
  const pk = kp?.publicKey ?? Keypair.generate().publicKey;
  return {
    publicKey: pk,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (!kp) throw new Error("read-only wallet");
      if (tx instanceof Transaction) tx.partialSign(kp); else (tx as VersionedTransaction).sign([kp]);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const t of txs) await this.signTransaction(t);
      return txs;
    },
  };
}

function decodeStatus(s: Record<string, unknown>): PolicyStatus {
  const k = Object.keys(s)[0];
  return (k === "paidOut" || k === "expired" || k === "refunded" ? k : "open") as PolicyStatus;
}

const iso = (secs: BN | number) => new Date(Number(secs.toString()) * 1000).toISOString();

// ---------------------------------------------------------------- client

export interface CoverClientOpts {
  connection?: Connection;
  /** Signer for program.methods...rpc() calls (scripts/tests). Omit for read-only / unsigned-tx building. */
  signer?: Keypair;
  /** Settlement mint (selects the underwriter PDA). Defaults to env USDC_MINT (devnet test dollar). */
  mint?: PublicKey;
  /** Token program of the mint (classic SPL by default; Circle devnet USDC is classic SPL). */
  tokenProgram?: PublicKey;
}

export class CoverClient {
  readonly connection: Connection;
  readonly program: Program<HedgehogPolicy>;
  readonly tokenProgram: PublicKey;
  readonly mint: PublicKey;
  readonly uw: PublicKey;

  constructor(opts: CoverClientOpts = {}) {
    this.connection = opts.connection ?? getConnection("devnet"); // QuickNode + public fallback (lib/solana/connection.ts)
    const provider = new AnchorProvider(this.connection, walletFor(opts.signer), { commitment: "confirmed" });
    this.program = new Program<HedgehogPolicy>(idlJson as HedgehogPolicy, provider);
    this.tokenProgram = opts.tokenProgram ?? TOKEN_PROGRAM_ID;
    this.mint = opts.mint ?? new PublicKey(env.usdcMint());
    this.uw = underwriterPda(this.mint, this.program.programId);
  }

  withSigner(signer: Keypair) {
    return new CoverClient({ connection: this.connection, signer, mint: this.mint, tokenProgram: this.tokenProgram });
  }

  async fetchUnderwriter() {
    return this.program.account.underwriter.fetchNullable(this.uw);
  }

  async fetchBusiness(owner: PublicKey) {
    return this.program.account.business.fetchNullable(businessPda(owner, this.program.programId));
  }

  async info(): Promise<CoverInfo> {
    const base = { programId: this.program.programId.toBase58(), underwriterPda: this.uw.toBase58(), mint: this.mint.toBase58() };
    const u = await this.fetchUnderwriter();
    if (!u) return { ...base, initialized: false };
    let vaultBalance = 0;
    try {
      const b = await this.connection.getTokenAccountBalance(u.vault);
      vaultBalance = fromUnits(b.value.amount);
    } catch { /* vault missing */ }
    const exposure = fromUnits(u.totalExposure);
    return {
      ...base,
      initialized: true,
      authority: u.authority.toBase58(),
      attestor: u.attestor.toBase58(),
      mint: u.mint.toBase58(),
      vault: u.vault.toBase58(),
      vaultBalance,
      exposure,
      maxExposure: fromUnits(u.maxExposure),
      freeCapacity: Math.max(0, vaultBalance - exposure),
      graceSecs: Number(u.graceSecs.toString()),
      policiesSold: Number(u.policiesSold.toString()),
    };
  }

  // ------------------------------------------------ admin (signed by this.signer)

  /** Creates the underwriter for this client's mint. */
  async initUnderwriter(p: { attestor: PublicKey; maxExposureUsd: number; graceSecs: number }) {
    return this.program.methods
      .initUnderwriter(p.attestor, toUnits(p.maxExposureUsd), new BN(p.graceSecs))
      .accountsPartial({
        authority: this.program.provider.publicKey!,
        underwriter: this.uw,
        mint: this.mint,
        vault: getAssociatedTokenAddressSync(this.mint, this.uw, true, this.tokenProgram),
        tokenProgram: this.tokenProgram,
      })
      .rpc();
  }

  async fundVault(amountUsd: number) {
    const u = await this.fetchUnderwriter();
    if (!u) throw new Error("underwriter not initialized");
    const funder = this.program.provider.publicKey!;
    return this.program.methods
      .fundVault(toUnits(amountUsd))
      .accountsPartial({
        funder,
        underwriter: this.uw,
        vault: u.vault,
        funderToken: getAssociatedTokenAddressSync(u.mint, funder, true, this.tokenProgram),
        mint: u.mint,
        tokenProgram: this.tokenProgram,
      })
      .rpc();
  }

  // ------------------------------------------------ owner txs (unsigned)

  /**
   * Build an UNSIGNED tx (fee payer = owner) that registers the business if needed,
   * adjusts its budget if `monthlyBudgetUsd` differs, and buys a policy.
   */
  async buildBuyTx(p: {
    owner: PublicKey;
    peril: Peril | number;
    marketRef: string;
    trigger: string;
    premiumUsd: number;
    payoutUsd: number;
    expiry: Date | number; // Date or unix seconds
    monthlyBudgetUsd?: number;
    /** Hedgehog's quoter (= underwriter attestor) co-signs the sale; the program rejects unquoted buys. */
    quoter: Keypair;
  }): Promise<{ policyId: number; policyPda: string; businessPda: string; txBase64: string; warnings: string[]; instructions: string[]; quoteExpiresAt: string }> {
    const warnings: string[] = [];
    if (Buffer.byteLength(p.marketRef, "utf8") > 64) throw new Error("marketRef must be <= 64 bytes");
    if (!(p.premiumUsd > 0 && p.payoutUsd >= p.premiumUsd)) throw new Error("need premium > 0 and payout >= premium");
    const expirySecs = typeof p.expiry === "number" ? Math.floor(p.expiry) : Math.floor(p.expiry.getTime() / 1000);
    if (expirySecs <= Math.floor(Date.now() / 1000)) throw new Error("expiry must be in the future");

    const u = await this.fetchUnderwriter();
    if (!u) throw new Error("underwriter not initialized (run scripts/init-underwriter.ts)");
    const biz = businessPda(p.owner, this.program.programId);
    const existing = await this.program.account.business.fetchNullable(biz);
    const ixs: TransactionInstruction[] = [];
    const names: string[] = [];

    if (!existing) {
      ixs.push(await this.program.methods.registerBusiness(toUnits(NO_BUDGET_USD)).accountsPartial({ owner: p.owner, business: biz }).instruction());
      names.push("register_business");
    } else if (existing.monthlyBudget.lt(toUnits(NO_BUDGET_USD))) {
      ixs.push(await this.program.methods.setBudget(toUnits(NO_BUDGET_USD)).accountsPartial({ owner: p.owner, business: biz }).instruction());
      names.push("set_budget");
    }

    const policyId = existing ? Number(existing.policyCount.toString()) : 0;
    const pol = policyPda(this.uw, biz, policyId, this.program.programId);
    const ownerToken = getAssociatedTokenAddressSync(u.mint, p.owner, true, this.tokenProgram);
    const perilCode = typeof p.peril === "number" ? p.peril : PERIL_CODES[p.peril] ?? 0;

    // Friendly pre-checks (the program enforces these too).
    try {
      const bal = await this.connection.getTokenAccountBalance(ownerToken);
      if (Number(bal.value.amount) < toUnits(p.premiumUsd).toNumber()) warnings.push(`owner has ${bal.value.uiAmountString} USDC, premium is ${p.premiumUsd}`);
    } catch {
      warnings.push("owner has no USDC token account for the underwriter's mint");
    }
    try {
      const vb = await this.connection.getTokenAccountBalance(u.vault);
      const free = fromUnits(vb.value.amount) - fromUnits(u.totalExposure);
      if (p.payoutUsd > free) warnings.push(`vault free capacity is ${free} USDC < payout ${p.payoutUsd} (InsufficientCapacity)`);
    } catch { /* ignore */ }

    ixs.push(
      await this.program.methods
        .buyPolicy(new BN(policyId), perilCode, p.marketRef, triggerHash(p.trigger), toUnits(p.premiumUsd), toUnits(p.payoutUsd), new BN(expirySecs))
        .accountsPartial({
          owner: p.owner,
          quoter: p.quoter.publicKey,
          underwriter: this.uw,
          business: biz,
          policy: pol,
          vault: u.vault,
          ownerToken,
          mint: u.mint,
          tokenProgram: this.tokenProgram,
        })
        .instruction(),
    );
    names.push("buy_policy");

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: p.owner, recentBlockhash: blockhash }).add(...ixs);
    // The quoter's signature covers the exact premium/payout/market/expiry and dies with the blockhash (~60-90 s).
    tx.partialSign(p.quoter);
    const txBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const quoteExpiresAt = new Date(Date.now() + 60_000).toISOString();
    return { policyId, policyPda: pol.toBase58(), businessPda: biz.toBase58(), txBase64, warnings, instructions: names, quoteExpiresAt };
  }

  /**
   * "Cover all": build several buy_policy txs for one owner (fee payer = owner), at most `perTx` policies each, with
   * consecutive policy ids (the program sets policy_count = max(id+1) on every buy, so ids count+0..n-1 are valid).
   * The first tx carries register_business / set_budget. Every tx is co-signed by the quoter and shares one blockhash,
   * so the wallet can approve them all at once (signAllTransactions); they must be SENT in order (tx 1 creates the
   * business account the others use).
   */
  async buildBuyBatchTxs(p: {
    owner: PublicKey;
    items: { peril: Peril | number; marketRef: string; trigger: string; premiumUsd: number; payoutUsd: number; expiry: Date | number }[];
    monthlyBudgetUsd?: number;
    quoter: Keypair;
    perTx?: number;
  }): Promise<{ txs: string[]; policies: { index: number; policyId: number; policyPda: string; tx: number }[]; businessPda: string; warnings: string[]; quoteExpiresAt: string }> {
    const perTx = Math.max(1, Math.min(3, p.perTx ?? 3));
    if (!p.items.length) throw new Error("no policies to buy");
    const now = Math.floor(Date.now() / 1000);
    const warnings: string[] = [];
    const u = await this.fetchUnderwriter();
    if (!u) throw new Error("underwriter not initialized (run scripts/init-underwriter.ts)");
    const biz = businessPda(p.owner, this.program.programId);
    const existing = await this.program.account.business.fetchNullable(biz);
    const ownerToken = getAssociatedTokenAddressSync(u.mint, p.owner, true, this.tokenProgram);
    const totalPremium = p.items.reduce((a, i) => a + i.premiumUsd, 0);
    const totalPayout = p.items.reduce((a, i) => a + i.payoutUsd, 0);

    const setup: TransactionInstruction[] = [];
    if (!existing) {
      setup.push(await this.program.methods.registerBusiness(toUnits(NO_BUDGET_USD)).accountsPartial({ owner: p.owner, business: biz }).instruction());
    } else if (existing.monthlyBudget.lt(toUnits(NO_BUDGET_USD))) {
      setup.push(await this.program.methods.setBudget(toUnits(NO_BUDGET_USD)).accountsPartial({ owner: p.owner, business: biz }).instruction());
    }
    // Friendly pre-checks (the program enforces these too): wallet balance, vault capacity. No monthly-budget check on purchase.
    try {
      const bal = await this.connection.getTokenAccountBalance(ownerToken);
      if (Number(bal.value.amount) < toUnits(totalPremium).toNumber()) warnings.push(`owner has ${bal.value.uiAmountString} USDC, premiums total ${totalPremium.toFixed(2)}`);
    } catch { warnings.push("owner has no USDC token account for the underwriter's mint"); }
    try {
      const vb = await this.connection.getTokenAccountBalance(u.vault);
      const free = fromUnits(vb.value.amount) - fromUnits(u.totalExposure);
      if (totalPayout > free) throw new Error(`vault free capacity is ${free.toFixed(2)} USDC < total payout ${totalPayout} (InsufficientCapacity)`);
    } catch (e) { if (e instanceof Error && /InsufficientCapacity/.test(e.message)) throw e; }

    const firstId = existing ? Number(existing.policyCount.toString()) : 0;
    const policies: { index: number; policyId: number; policyPda: string; tx: number }[] = [];
    const groups: TransactionInstruction[][] = [];
    for (let i = 0; i < p.items.length; i++) {
      const it = p.items[i];
      if (Buffer.byteLength(it.marketRef, "utf8") > 64) throw new Error(`line ${i + 1}: marketRef must be <= 64 bytes`);
      if (!(it.premiumUsd > 0 && it.payoutUsd >= it.premiumUsd)) throw new Error(`line ${i + 1}: need premium > 0 and payout >= premium`);
      const expirySecs = typeof it.expiry === "number" ? Math.floor(it.expiry) : Math.floor(it.expiry.getTime() / 1000);
      if (expirySecs <= now) throw new Error(`line ${i + 1}: expiry must be in the future`);
      const policyId = firstId + i;
      const pol = policyPda(this.uw, biz, policyId, this.program.programId);
      const perilCode = typeof it.peril === "number" ? it.peril : PERIL_CODES[it.peril] ?? 0;
      const ix = await this.program.methods
        .buyPolicy(new BN(policyId), perilCode, it.marketRef, triggerHash(it.trigger), toUnits(it.premiumUsd), toUnits(it.payoutUsd), new BN(expirySecs))
        .accountsPartial({ owner: p.owner, quoter: p.quoter.publicKey, underwriter: this.uw, business: biz, policy: pol, vault: u.vault, ownerToken, mint: u.mint, tokenProgram: this.tokenProgram })
        .instruction();
      const g = Math.floor(i / perTx);
      (groups[g] ??= []).push(ix);
      policies.push({ index: i, policyId, policyPda: pol.toBase58(), tx: g });
    }

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const txs = groups.map((ixs, g) => {
      const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 + 110_000 * ixs.length }), ...(g === 0 ? setup : []), ...ixs];
      const tx = new Transaction({ feePayer: p.owner, recentBlockhash: blockhash }).add(...all);
      tx.partialSign(p.quoter);
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      if (bytes.length > 1232) throw new Error(`tx ${g + 1} is ${bytes.length} bytes (> 1232); buy fewer lines at once`);
      return bytes.toString("base64");
    });
    return { txs, policies, businessPda: biz.toBase58(), warnings, quoteExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  // ------------------------------------------------ reads

  decode(pda: PublicKey, a: Awaited<ReturnType<Program<HedgehogPolicy>["account"]["policy"]["fetch"]>>): DecodedPolicy {
    const settled = Number(a.settledAt.toString());
    return {
      pda: pda.toBase58(),
      owner: a.owner.toBase58(),
      business: a.business.toBase58(),
      policyId: Number(a.policyId.toString()),
      peril: perilFromCode(a.peril),
      perilCode: a.peril,
      marketRef: a.marketRef,
      triggerHash: Buffer.from(a.triggerHash).toString("hex"),
      premiumUsd: fromUnits(a.premium),
      payoutUsd: fromUnits(a.payout),
      createdAt: iso(a.createdAt),
      expiry: iso(a.expiry),
      status: decodeStatus(a.status as Record<string, unknown>),
      settledAt: settled ? iso(settled) : null,
    };
  }

  async getPolicy(pda: PublicKey | string): Promise<DecodedPolicy | null> {
    const k = new PublicKey(pda);
    const a = await this.program.account.policy.fetchNullable(k);
    return a ? this.decode(k, a) : null;
  }

  /** All policies, or those of one owner (memcmp on Policy.owner at offset 8). Newest first. */
  async listPolicies(owner?: PublicKey | string): Promise<DecodedPolicy[]> {
    const filters = owner ? [{ memcmp: { offset: 8, bytes: new PublicKey(owner).toBase58() } }] : [];
    const rows = await this.program.account.policy.all(filters);
    return rows.map((r) => this.decode(r.publicKey, r.account)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ------------------------------------------------ crank (signed server-side)

  private async settleAccounts(pda: PublicKey) {
    const pol = await this.program.account.policy.fetch(pda);
    const u = await this.fetchUnderwriter();
    if (!u) throw new Error("underwriter not initialized");
    return {
      pol,
      accts: {
        underwriter: this.uw,
        policy: pda,
        vault: u.vault,
        ownerToken: getAssociatedTokenAddressSync(u.mint, pol.owner, true, this.tokenProgram),
        mint: u.mint,
        tokenProgram: this.tokenProgram,
      },
    };
  }

  /** settle_policy signed by `attestor` (defaults to keys/attestor.json). Returns tx signature. */
  async settlePolicy(pda: PublicKey | string, outcome: boolean, attestor: Keypair = loadKeypair("attestor")): Promise<string> {
    const k = new PublicKey(pda);
    const { accts } = await this.settleAccounts(k);
    return this.withSigner(attestor).program.methods
      .settlePolicy(outcome)
      .accountsPartial({ attestor: attestor.publicKey, ...accts })
      .rpc();
  }

  /** expire_policy (anyone may call after expiry + grace). Refunds the premium to the owner. */
  async expirePolicy(pda: PublicKey | string, caller: Keypair = loadKeypair("attestor")): Promise<string> {
    const k = new PublicKey(pda);
    const { accts } = await this.settleAccounts(k);
    return this.withSigner(caller).program.methods
      .expirePolicy()
      .accountsPartial({ caller: caller.publicKey, ...accts })
      .rpc();
  }
}

let _default: CoverClient | null = null;
/** Read-only default client on env.rpc() (devnet). */
export function coverClient(): CoverClient {
  if (!_default) _default = new CoverClient();
  return _default;
}
