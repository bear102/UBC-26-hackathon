// Writes account JSON files for solana-test-validator: the Circle devnet USDC mint (same address, our own authority)
// and a funded USDC account for the merchant. Local e2e only.
import fs from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MintLayout, AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
const MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const merchant = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("keys/merchant.json", "utf8")))).publicKey;
const dir = ".data/localnet";
const write = (name: string, pubkey: PublicKey, data: Buffer, lamports: number) =>
  fs.writeFileSync(`${dir}/${name}.json`, JSON.stringify({ pubkey: pubkey.toBase58(), account: { lamports, data: [data.toString("base64"), "base64"], owner: TOKEN_PROGRAM_ID.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
const m = Buffer.alloc(MintLayout.span);
MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: merchant, supply: BigInt(1e12), decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, m);
write("mint", MINT, m, 1_461_600);
const a = Buffer.alloc(AccountLayout.span);
AccountLayout.encode({ mint: MINT, owner: merchant, amount: BigInt(1e12), delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, a);
write("merchant-usdc", getAssociatedTokenAddressSync(MINT, merchant), a, 2_039_280);
console.log("ok", merchant.toBase58());
