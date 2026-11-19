---
name: build-box-compromised
description: "The hackathon build server was found compromised (miners, droppers, ssh-hijack guard) on 2026-11-18; no real secrets on it until the user decides"
metadata:
  node_type: memory
  type: project
  originSessionId: 45b304d7-5bc4-4519-8251-542eb0ad25b9
  modified: 2026-11-18T20:21:14.169Z
---

On 2026-11-18 ~20:20Z, the root crontab and /etc/cron.d on the build box were found to run xmrig and a kryptex miner. @reboot droppers pull from 162.240.226.121 (sync.x86_64, lava.x86_64, /opt/sys-services/NetworkHelper). A fake "systemd-network --guard" lives in /usr/lib/systemd/.network-helper and /var/lib/.systemd-backup; its .guard.log shows "ssh-hijack" and "spread". Process "usr" (from /root/basketrandom/) burns ~550% CPU. Processes randomly die with SIGTERM/exit 144 (rustup and npm were killed).

**Why:** Gemini API keys move real money, and the user's secrets would be exposed on this box.
**How to apply:** Don't ask for or store real secrets (Gemini keys, LLM keys) on this host until the user has cleaned it or moved to a new host. Don't remediate without the user's approval. Check whether the user has decided before resuming G1. Related: [[hedgehog-build-status]].
