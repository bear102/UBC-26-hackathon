// LiteSVM harness for hedgehog_promise (clock warp, fixed USDC mint, known attestor/relayer keys).
import { LiteSVM, Clock, FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { MintLayout, AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from "node:fs";
import { PROGRAM_ID, USDC_MINT, ERRORS } from "../../lib/hh/program";

export const loadKey = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`keys/${n}.json`, "utf8"))));

export class H {
  svm: LiteSVM;
  attestor = loadKey("attestor");
  relayer = loadKey("relayer");
  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(PROGRAM_ID, fs.existsSync("target/test/hedgehog_promise.so") ? "target/test/hedgehog_promise.so" : "target/deploy/hedgehog_promise.so"); // tests need the --features server-keys build (npm run build:program:test)
    const data = Buffer.alloc(MintLayout.span);
    MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: Keypair.generate().publicKey, supply: BigInt(1e15), decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
    this.svm.setAccount(USDC_MINT, { lamports: 1_000_000_000, data, owner: TOKEN_PROGRAM_ID, executable: false });
    for (const k of [this.attestor, this.relayer]) this.svm.airdrop(k.publicKey, BigInt(10e9));
  }
  now() { return Number(this.svm.getClock().unixTimestamp); }
  setTime(t: number) {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, BigInt(t)));
    this.svm.expireBlockhash();
  }
  warp(dt: number) { this.setTime(this.now() + dt); }
  fund(k: PublicKey, sol = 10) { this.svm.airdrop(k, BigInt(sol * 1e9)); }
  /** create/overwrite a USDC token account at the owner's ATA with `amount` micros */
  setUsdc(owner: PublicKey, amount: bigint) {
    const ata = getAssociatedTokenAddressSync(USDC_MINT, owner, true);
    const data = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode({ mint: USDC_MINT, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    this.svm.setAccount(ata, { lamports: 2_039_280, data, owner: TOKEN_PROGRAM_ID, executable: false });
    return ata;
  }
  usdc(addr: PublicKey): bigint | null {
    const a = this.svm.getAccount(addr);
    if (!a || a.data.length !== AccountLayout.span) return null;
    return AccountLayout.decode(Buffer.from(a.data)).amount;
  }
  data(addr: PublicKey) { const a = this.svm.getAccount(addr); return a ? Buffer.from(a.data) : null; }
  send(ixs: TransactionInstruction[], signers: Keypair[]): { ok: true; logs: string[] } | { ok: false; err: string; code?: number; name?: string; logs: string[] } {
    const tx = new Transaction();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.add(...ixs);
    tx.sign(...signers);
    const r = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    if (r instanceof FailedTransactionMetadata) {
      const logs = r.meta().logs();
      const txt = logs.join("\n") + String(r.err());
      const m = txt.match(/Error Number: (\d+)/);
      const code = m ? Number(m[1]) : undefined;
      return { ok: false, err: String(r.err()), code, name: code ? ERRORS[code] : undefined, logs };
    }
    return { ok: true, logs: (r as TransactionMetadata).logs() };
  }
}
