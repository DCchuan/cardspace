#!/bin/zsh
cd "${0:A:h}"
if [[ ! -x .venv/bin/python || ! -d apps/web/dist ]]; then
  bash scripts/setup.sh || exit 1
fi
if curl --noproxy '*' -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
  open http://127.0.0.1:8765
  exit 0
fi
npm start &
CARDSPACE_LAUNCH_PID=$!
trap 'kill -TERM "$CARDSPACE_LAUNCH_PID" 2>/dev/null' INT TERM EXIT
for attempt in {1..40}; do
  if curl --noproxy '*' -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    open http://127.0.0.1:8765
    wait "$CARDSPACE_LAUNCH_PID"
    exit $?
  fi
  sleep 0.25
done
printf '服务未能启动，请检查上方错误信息。\n'
wait "$CARDSPACE_LAUNCH_PID"
