// Anchor client for `hedgehog_promise`: PDA helpers, instruction builders (connection-free), account decoding.
import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction,
  TransactionInstruction, type AccountMeta,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import idlJson from "./idl/hedgehog_promise.json";

export const IDL = idlJson as Idl;
export const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);
export const USDC_MINT = new PublicKey(process.env.USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
// Defaults = the devnet program (keys on the user's PC). The build server sets HH_ATTESTOR/HH_RELAYER for localnet runs.
export const ATTESTOR = new PublicKey(process.env.HH_ATTESTOR || "BC2GGEKLBxCKMsAakUaHckmMuEjF71fmoPCFjP4E4aVN");
export const RELAYER = new PublicKey(process.env.HH_RELAYER || "Abq5tHs4mFZWFXNK53B5aKfgfnAPDa6jQHmTexDwDAGi");

export const ERRORS: Record<number, string> = {
  6000: "SalesClosed", 6001: "SoldOut", 6002: "Unhedged", 6003: "LiabilityLocked", 6004: "UnauthorizedAttestor",
  6005: "AlreadyRefunded", 6006: "NotSettled", 6007: "AlreadySettled", 6008: "InvalidStrip", 6009: "InvalidAmount",
  6010: "InvalidTimes", 6011: "TooEarly", 6012: "StaleAttestation", 6013: "ReceiptMismatch", 6014: "WrongMint", 6015: "NotMerchant",
};
/** Extract an Anchor error code/name from logs or an error object. */
export function parseError(e: unknown, logs?: string[] | null): { code: number; name: string } | null {
  const text = [String((e as Error)?.message ?? e ?? ""), ...(logs ?? []), ...(((e as { logs?: string[] })?.logs) ?? [])].join("\n");
  let m = text.match(/Error Number: (\d+)/) || text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (!m) return null;
  const code = m[0].includes("0x") ? parseInt(m[1], 16) : Number(m[1]);
  return { code, name: ERRORS[code] ?? `Error${code}` };
}

let _program: Program | null = null;
export function program(): Program {
  if (_program) return _program;
  const dummy = { connection: new Connection("http://127.0.0.1:1"), publicKey: PublicKey.default } as unknown as AnchorProvider;
  _program = new Program(IDL, dummy);
  return _program;
}

const le64 = (n: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const merchantPda = (authority: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("merchant"), authority.toBuffer()], PROGRAM_ID)[0];
export const promisePda = (authority: PublicKey, id: bigint | number) => PublicKey.findProgramAddressSync([Buffer.from("promise"), authority.toBuffer(), le64(id)], PROGRAM_ID)[0];
export const vaultPda = (promise: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("vault"), promise.toBuffer()], PROGRAM_ID)[0];
export const receiptPda = (promise: PublicKey, index: number) => PublicKey.findProgramAddressSync([Buffer.from("receipt"), promise.toBuffer(), le32(index)], PROGRAM_ID)[0];
export const usdcAta = (owner: PublicKey, mint = USDC_MINT) => getAssociatedTokenAddressSync(mint, owner, true);

export type CreateArgs = {
  promiseId: bigint | number; eventTicker: string; strip: string[]; refundUnits: number; cap: number;
  salesCloseTs: number; expectedResolveTs: number; termsHash: Uint8Array;
};

export async function ixCreatePromise(authority: PublicKey, a: CreateArgs, mint = USDC_MINT): Promise<TransactionInstruction> {
  const promise = promisePda(authority, a.promiseId);
  return program().methods
    .createPromise(new BN(a.promiseId.toString()), a.eventTicker, a.strip, new BN(a.refundUnits), a.cap, new BN(a.salesCloseTs), new BN(a.expectedResolveTs), Array.from(a.termsHash))
    .accountsStrict({
      authority, merchant: merchantPda(authority), promise, vault: vaultPda(promise), authorityUsdc: usdcAta(authority, mint),
      usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

export async function ixAttestHedge(attestor: PublicKey, promise: PublicKey, phase: number, qtyCenti: number[], premiumMicros: number, ordersHash: Uint8Array, observedAt: number) {
  return program().methods
    .attestHedge(phase, qtyCenti, new BN(premiumMicros), Array.from(ordersHash), new BN(observedAt))
    .accountsStrict({ attestor, promise })
    .instruction();
}

export async function ixIssueReceipt(authority: PublicKey, promise: PublicKey, sold: number, holder: PublicKey, codeHash: Uint8Array, mint = USDC_MINT) {
  return program().methods
    .issueReceipt(Array.from(codeHash))
    .accountsStrict({
      authority, merchant: merchantPda(authority), promise, receipt: receiptPda(promise, sold), holder,
      holderAta: usdcAta(holder, mint), systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function ixAttestOutcome(relayer: PublicKey, promise: PublicKey, merchantAuthority: PublicKey, winning: string, hash: Uint8Array, resolvedAt: number) {
  return program().methods
    .attestOutcome(winning, Array.from(hash), new BN(resolvedAt))
    .accountsStrict({ relayer, promise, merchant: merchantPda(merchantAuthority) })
    .instruction();
}

export async function ixRefundCrank(cranker: PublicKey, promise: PublicKey, merchantAuthority: PublicKey, pairs: { receipt: PublicKey; holderAta: PublicKey }[], mint = USDC_MINT) {
  const rem: AccountMeta[] = pairs.flatMap((p) => [
    { pubkey: p.receipt, isSigner: false, isWritable: true },
    { pubkey: p.holderAta, isSigner: false, isWritable: true },
  ]);
  return program().methods
    .refundCrank()
    .accountsStrict({ cranker, promise, vault: vaultPda(promise), merchant: merchantPda(merchantAuthority), usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
    .remainingAccounts(rem)
    .instruction();
}

/** Crank tx: ATA creates (payer = cranker) + refund_crank. */
export async function crankInstructions(cranker: PublicKey, promise: PublicKey, merchantAuthority: PublicKey, holders: { receipt: PublicKey; holder: PublicKey }[], mint = USDC_MINT) {
  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })];
  for (const h of holders) ixs.push(createAssociatedTokenAccountIdempotentInstruction(cranker, usdcAta(h.holder, mint), h.holder, mint));
  ixs.push(await ixRefundCrank(cranker, promise, merchantAuthority, holders.map((h) => ({ receipt: h.receipt, holderAta: usdcAta(h.holder, mint) })), mint));
  return ixs;
}

export async function ixRelease(authority: PublicKey, promise: PublicKey, mint = USDC_MINT) {
  return program().methods
    .release()
    .accountsStrict({ authority, merchant: merchantPda(authority), promise, vault: vaultPda(promise), authorityUsdc: usdcAta(authority, mint), usdcMint: mint, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
}

export async function ixCloseReceipts(authority: PublicKey, promise: PublicKey, receipts: PublicKey[]) {
  return program().methods
    .closeReceipts()
    .accountsStrict({ authority, promise })
    .remainingAccounts(receipts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
    .instruction();
}

// ---------------------------------------------------------------- decoding

export type PromiseAcct = {
  merchant: PublicKey; promiseId: bigint; vault: PublicKey; eventTicker: string; strip: string[]; hedgedCenti: number[];
  refundUnits: number; cap: number; sold: number; refunded: number; hedgedCapacity: number; heldBpsCutoff: number; heldBpsMin: number;
  phasesDone: number; premiumMicros: number; ordersHash: string; salesCloseTs: number; expectedResolveTs: number; termsHash: string;
  status: number; winningSymbol: string; outcomeHash: string; resolvedAt: number; createdAt: number;
};
const hex = (a: number[] | Uint8Array) => Buffer.from(a as number[]).toString("hex");
const str48 = (a: number[] | Uint8Array) => Buffer.from(a as number[]).toString("utf8").replace(/\0+$/, "");
const num = (x: BN | number) => (typeof x === "number" ? x : Number(BigInt.asIntN(64, BigInt("0x" + x.toTwos(64).toString(16)))));

export function decodePromise(data: Buffer | Uint8Array): PromiseAcct {
  const p = program().coder.accounts.decode("promise", Buffer.from(data)) as Record<string, any>;
  const stripLen = p.stripLen as number;
  return {
    merchant: p.merchant, promiseId: BigInt("0x" + p.promiseId.toString(16)), vault: p.vault, eventTicker: p.eventTicker,
    strip: (p.strip as number[][]).slice(0, stripLen).map(str48), hedgedCenti: (p.hedgedCenti as number[]).slice(0, stripLen),
    refundUnits: num(p.refundUnits), cap: p.cap, sold: p.sold, refunded: p.refunded, hedgedCapacity: p.hedgedCapacity,
    heldBpsCutoff: p.heldBpsCutoff, heldBpsMin: p.heldBpsMin, phasesDone: p.phasesDone, premiumMicros: num(p.premiumMicros),
    ordersHash: hex(p.ordersHash), salesCloseTs: num(p.salesCloseTs), expectedResolveTs: num(p.expectedResolveTs), termsHash: hex(p.termsHash),
    status: p.status, winningSymbol: str48(p.winningSymbol), outcomeHash: hex(p.outcomeHash), resolvedAt: num(p.resolvedAt), createdAt: num(p.createdAt),
  };
}
export type MerchantAcct = { authority: PublicKey; promisesCreated: number; promisesClosed: number; cutoffHeldFull: number; hedgeBreaks: number; receiptsIssued: number; refundsPaid: number };
export function decodeMerchant(data: Buffer | Uint8Array): MerchantAcct {
  const m = program().coder.accounts.decode("merchant", Buffer.from(data)) as Record<string, any>;
  return { authority: m.authority, promisesCreated: m.promisesCreated, promisesClosed: m.promisesClosed, cutoffHeldFull: m.cutoffHeldFull, hedgeBreaks: m.hedgeBreaks, receiptsIssued: num(m.receiptsIssued), refundsPaid: num(m.refundsPaid) };
}
export type ReceiptAcct = { promise: PublicKey; index: number; holder: PublicKey; holderAta: PublicKey; codeHash: string; issuedAt: number; refunded: boolean };
export function decodeReceipt(data: Buffer | Uint8Array): ReceiptAcct {
  const r = program().coder.accounts.decode("receipt", Buffer.from(data)) as Record<string, any>;
  return { promise: r.promise, index: r.index, holder: r.holder, holderAta: r.holderAta, codeHash: hex(r.codeHash), issuedAt: num(r.issuedAt), refunded: r.refunded };
}
export const RECEIPT_SIZE = 8 + 32 + 4 + 32 + 32 + 32 + 8 + 1 + 1;
export const STATUS = ["OPEN", "SETTLED_YES", "SETTLED_NO", "CLOSED"] as const;

export function txOf(feePayer: PublicKey, ixs: TransactionInstruction[], blockhash: string) {
  const tx = new Transaction({ feePayer, recentBlockhash: blockhash });
  tx.add(...ixs);
  return tx;
}
export type Signer = Keypair;
