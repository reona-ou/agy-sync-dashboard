#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_CMD=""

for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    if "$cand" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >/dev/null 2>&1; then
      PY_CMD="$cand"
      break
    fi
  fi
done

if [[ -z "$PY_CMD" ]]; then
  echo "Error: Python 3.10+ is required." >&2
  exit 1
fi

"$PY_CMD" "$REPO_ROOT/manage.py" install "$@"
"$PY_CMD" "$REPO_ROOT/manage.py" sync
