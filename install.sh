#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_NAME="agy_sync_dashboard"
ENV_YML="$REPO_ROOT/environment.yml"
NO_CONDA=0
INSTALL_ARGS=()

for arg in "$@"; do
  if [[ "$arg" == "--no-conda" ]]; then
    NO_CONDA=1
  else
    INSTALL_ARGS+=("$arg")
  fi
done

find_conda() {
  if [[ -n "${CONDA_EXE:-}" && -x "${CONDA_EXE}" ]]; then
    echo "$CONDA_EXE"
    return 0
  fi
  if command -v conda >/dev/null 2>&1; then
    command -v conda
    return 0
  fi
  for cand in \
    "$HOME/miniconda3/bin/conda" \
    "$HOME/anaconda3/bin/conda" \
    "$HOME/miniforge3/bin/conda" \
    "$HOME/mambaforge/bin/conda" \
    "/opt/conda/bin/conda" \
    "/opt/homebrew/Caskroom/miniconda/base/bin/conda" \
    "/usr/local/Caskroom/miniconda/base/bin/conda"; do
    if [[ -x "$cand" ]]; then
      echo "$cand"
      return 0
    fi
  done
  return 1
}

find_env_python() {
  local conda_exe="$1"
  local env_list
  env_list="$("$conda_exe" env list 2>/dev/null || true)"
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    local path_part
    path_part="$(echo "$line" | awk '{print $NF}')"
    if [[ "$(basename "$path_part")" == "$ENV_NAME" && -x "$path_part/bin/python" ]]; then
      echo "$path_part/bin/python"
      return 0
    fi
  done <<< "$env_list"
  return 1
}

PY_CMD=""
CONDA_BIN=""

if [[ "$NO_CONDA" -eq 0 ]]; then
  CONDA_BIN="$(find_conda || true)"
  if [[ -n "$CONDA_BIN" ]]; then
    PY_CMD="$(find_env_python "$CONDA_BIN" || true)"
    if [[ -z "$PY_CMD" ]]; then
      echo "Creating isolated Conda environment '$ENV_NAME' from environment.yml..." >&2
      "$CONDA_BIN" env create -f "$ENV_YML" -y >&2
      PY_CMD="$(find_env_python "$CONDA_BIN" || true)"
    else
      echo "Using isolated Conda environment '$ENV_NAME' ($PY_CMD)" >&2
    fi
    if [[ -n "$PY_CMD" ]]; then
      export CONDA_DEFAULT_ENV="$ENV_NAME"
      export CONDA_PREFIX="$(dirname "$(dirname "$PY_CMD")")"
      export AGY_SYNC_NO_CONDA_REEXEC=1
    fi
  else
    echo "Warning: Conda not found; falling back to system Python 3.10+." >&2
  fi
fi

if [[ -z "$PY_CMD" ]]; then
  for cand in python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
      if "$cand" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >/dev/null 2>&1; then
        PY_CMD="$cand"
        break
      fi
    fi
  done
fi

if [[ -z "$PY_CMD" ]]; then
  echo "Error: Conda or Python 3.10+ is required." >&2
  exit 1
fi

if [[ "$NO_CONDA" -eq 1 ]]; then
  "$PY_CMD" "$REPO_ROOT/manage.py" --no-conda install ${INSTALL_ARGS[@]+"${INSTALL_ARGS[@]}"}
  "$PY_CMD" "$REPO_ROOT/manage.py" --no-conda sync
else
  "$PY_CMD" "$REPO_ROOT/manage.py" install ${INSTALL_ARGS[@]+"${INSTALL_ARGS[@]}"}
  "$PY_CMD" "$REPO_ROOT/manage.py" sync
fi
