#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CARDSPACE_PY="${CARDSPACE_PYTHON:-}"
if [ -z "$CARDSPACE_PY" ]; then
  for candidate in python3.13 python3.12 python3.11 python3.10 python3 "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert sys.version_info >= (3,10)' >/dev/null 2>&1; then
      CARDSPACE_PY="$candidate"
      break
    fi
  done
fi
if [ -z "$CARDSPACE_PY" ]; then
  printf '需要 Python 3.10+。安装后重新运行，或设置 CARDSPACE_PYTHON。\n' >&2
  exit 1
fi
"$CARDSPACE_PY" -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
npm --prefix apps/web ci
npm run build
printf '\n安装完成。运行 npm start，打开 http://127.0.0.1:8765\n'
