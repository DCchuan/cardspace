#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export CARDSPACE_DATA_DIR="${CARDSPACE_DATA_DIR:-$HOME/Library/Application Support/CardSpace-v04}"
export CARDSPACE_PORT="${CARDSPACE_PORT:-8766}"
if [ ! -x .venv/bin/python ] || [ ! -f packages/experience-runtime/trusted.js ] || [ ! -f apps/web/dist/index.html ]; then
  bash scripts/setup.sh
fi
if curl --noproxy '*' -fsS "http://127.0.0.1:$CARDSPACE_PORT/api/health" >/dev/null 2>&1; then
  open "http://127.0.0.1:$CARDSPACE_PORT/"
  exit 0
fi
npm start &
CARDSPACE_V04_LAUNCH_PID=$!
trap 'kill -TERM "$CARDSPACE_V04_LAUNCH_PID" 2>/dev/null || true' INT TERM EXIT
for attempt in {1..40}; do
  if curl --noproxy '*' -fsS "http://127.0.0.1:$CARDSPACE_PORT/api/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:$CARDSPACE_PORT/"
    wait "$CARDSPACE_V04_LAUNCH_PID"
    exit $?
  fi
  sleep 0.25
done
printf '服务未能启动，请检查上方错误信息。\n'
wait "$CARDSPACE_V04_LAUNCH_PID"
