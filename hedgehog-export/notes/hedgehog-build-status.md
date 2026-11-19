---
name: hedgehog-build-status
description: Hedgehog build progress as of 2026-11-18 20:25Z (H1.4): what exists, devnet pubkeys, toolchain state
metadata:
  type: project
---
As of 2026-11-18 20:25Z: commit 9227969 adds package.json (deps installed), lib/hh/{env,gemini,geminiPrivate}.ts, scripts/h0-gate.ts (dry run by default; `--buy` places a real ~$1.30 batch) and scripts/keys.ts. The devnet keypairs are in keys/ (gitignored): deployer 3H7Vbk…t4yX, merchant J4FoVw…A81p, attestor 5LQKRa…u5Es, relayer FtVpLm…kVZr, crank GWDG4n…t7Hd, attacker 2dHPY1…nu6m. The program id keypair is in keys/program.json (6x27yJ…Qraf). The faucet pubkeys were sent to the user on Telegram.
Toolchain: NOT installed. rustup was killed mid-download (see [[build-box-compromised]]). The plan is Agave v4.4.1 + avm with Anchor 0.31.3 and 1.2.2 (Spendthrift needs 1.2.2; its session is spendthrift-8c). Write /root/blockchainHackathon26/projects/TOOLCHAIN.md when done.
Shell quirk: commands often return exit 144 even when they succeed, so redirect output to a file and check it.
