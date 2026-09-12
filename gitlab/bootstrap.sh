#!/usr/bin/env bash
set -euo pipefail

# Start with the image's Node before the installer puts managed shims on PATH.
# Installation, version resolution, and environment configuration live in the
# same portable runtime on Unix and Windows.
setup_vp_runtime_node="$(command -v node)" || {
  echo "setup-vp: Node.js is required in the GitLab runner image." >&2
  exit 127
}
setup_vp_download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 5 --max-time 60 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 60 -t 2 -O "$2" "$1"
  else
    echo "setup-vp: curl or wget is required to download the runtime." >&2
    return 127
  fi
}
SETUP_VP_SETUP_REF="${SETUP_VP_SETUP_REF:-v1}"
setup_vp_runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/setup-vp-gitlab-runtime.XXXXXX")"
setup_vp_runtime_tmp="$setup_vp_runtime_dir/index.mjs"
trap 'rm -f "$setup_vp_runtime_tmp"; rmdir "$setup_vp_runtime_dir"' EXIT
setup_vp_download \
  "https://raw.githubusercontent.com/voidzero-dev/setup-vp/${SETUP_VP_SETUP_REF}/dist/gitlab/index.mjs" \
  "$setup_vp_runtime_tmp"
"$setup_vp_runtime_node" "$setup_vp_runtime_tmp"
