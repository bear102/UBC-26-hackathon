#!/usr/bin/env bash
# Build + deploy hedgehog_promise to devnet with the committed program id (keys/program.json).
set -euo pipefail
export PATH=$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH
cd "$(dirname "$0")/.."
anchor build -- --tools-version v1.57
cp keys/program.json target/deploy/hedgehog_promise-keypair.json
solana -u devnet balance keys/deployer.json
solana program deploy -u devnet --keypair keys/deployer.json --program-id keys/program.json \
  --with-compute-unit-price 50000 --max-sign-attempts 30 target/deploy/hedgehog_promise.so
solana program show -u devnet 6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf
