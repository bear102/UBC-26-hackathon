#!/usr/bin/env bash
# Keeps the demo up: restarts the Next server (:5390) and the payout worker if either stops.
# Start detached so it survives any terminal / Claude session:
#   cd v2-insurance && setsid nohup bash scripts/keepalive.sh >> .data/keepalive.log 2>&1 < /dev/null &
# Stop: kill "$(cat .data/keepalive.pid)"   (the server and worker keep running; kill them separately if needed)
set -u
cd "$(dirname "$0")/.."
mkdir -p .data
if [ -f .data/keepalive.pid ] && kill -0 "$(cat .data/keepalive.pid)" 2>/dev/null; then
  echo "$(date -u +%FT%TZ) keepalive already running (pid $(cat .data/keepalive.pid))"; exit 0
fi
echo $$ > .data/keepalive.pid
log() { echo "$(date -u +%FT%TZ) $*"; }
port_up() { (exec 3<>/dev/tcp/127.0.0.1/5390) 2>/dev/null; }
worker_up() { pgrep -f "tsx scripts/worker.ts" >/dev/null 2>&1; }
log "keepalive started (pid $$)"
while true; do
  if ! port_up; then
    sleep 5; if ! port_up; then   # double-check: a hot reload can blip the port
      log "server down: starting next dev on :5390"
      setsid nohup npx next dev -p 5390 >> .data/dev.log 2>&1 < /dev/null &
      sleep 25
    fi
  fi
  if ! worker_up; then
    log "worker down: starting payout worker"
    setsid nohup npm run worker >> .data/worker.log 2>&1 < /dev/null &
    sleep 5
  fi
  sleep 15
done
