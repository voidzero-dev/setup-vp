#!/usr/bin/env bash
set -euo pipefail

# Azure step templates expand YAML from an external repository but do not check
# out bootstrap/runtime files onto the agent. Download the compiled runtime and
# execute its prepare phase, which installs Vite+ and emits cache metadata.

setup_vp_download() {
  setup_vp_url="$1"
  setup_vp_out="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 5 --max-time 60 "$setup_vp_url" -o "$setup_vp_out"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 60 -t 2 -O "$setup_vp_out" "$setup_vp_url"
  else
    echo "setup-vp: curl or wget is required to download files." >&2
    return 127
  fi
}

SETUP_VP_SETUP_REF="${SETUP_VP_SETUP_REF:-v1}"
SETUP_VP_RUNTIME_OUT="${SETUP_VP_RUNTIME_OUT:-${TMPDIR:-/tmp}/setup-vp-azure/dist/azure/index.mjs}"
setup_vp_runtime_dir="$(dirname "$SETUP_VP_RUNTIME_OUT")"
setup_vp_chunk_dir="$(dirname "$setup_vp_runtime_dir")"
mkdir -p "$setup_vp_runtime_dir" "$setup_vp_chunk_dir"
chmod 600 "$SETUP_VP_RUNTIME_OUT" 2>/dev/null || true

setup_vp_runtime_url="https://raw.githubusercontent.com/voidzero-dev/setup-vp/${SETUP_VP_SETUP_REF}/dist/azure/index.mjs"
setup_vp_download "$setup_vp_runtime_url" "$SETUP_VP_RUNTIME_OUT"

while IFS= read -r setup_vp_chunk; do
  setup_vp_chunk_name="${setup_vp_chunk#../}"
  setup_vp_download \
    "https://raw.githubusercontent.com/voidzero-dev/setup-vp/${SETUP_VP_SETUP_REF}/dist/${setup_vp_chunk_name}" \
    "$setup_vp_chunk_dir/${setup_vp_chunk_name}"
done < <(grep -Eo "['\"]\.\./[^'\"]+\.mjs['\"]" "$SETUP_VP_RUNTIME_OUT" | tr -d "'\"" | sort -u)

node "$SETUP_VP_RUNTIME_OUT" prepare
