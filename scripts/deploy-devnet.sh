#!/usr/bin/env bash
# Build + deploy hedgehog_promise to devnet with the committed program id (keys/program.json),
# then hand the upgrade authority to the user's own deployer key (kept only on the user's PC).
# The default build bakes in the user's attestor/relayer pubkeys; tests use `npm run build:program:test`.
set -euo pipefail
export PATH=$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH
cd "$(dirname "$0")/.."
USER_AUTHORITY=${USER_AUTHORITY:-EyyPr9uDbRze8Bc6fA4JxfkznL2bw5CbxH761ewo6VWj}
anchor build --no-idl -- --tools-version v1.57
anchor idl build -o target/idl/hedgehog_promise.json -t target/types/hedgehog_promise.ts
cp target/idl/hedgehog_promise.json target/types/hedgehog_promise.ts lib/hh/idl/
cp keys/program.json target/deploy/hedgehog_promise-keypair.json
solana -u devnet balance keys/deployer.json
solana program deploy -u devnet --keypair keys/deployer.json --program-id keys/program.json \
  --with-compute-unit-price 50000 --max-sign-attempts 30 target/deploy/hedgehog_promise.so
solana program set-upgrade-authority -u devnet --keypair keys/deployer.json 6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf \
  --upgrade-authority keys/deployer.json --new-upgrade-authority "$USER_AUTHORITY" --skip-new-upgrade-authority-signer-check
solana program show -u devnet 6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf
