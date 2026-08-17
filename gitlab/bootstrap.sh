#!/usr/bin/env bash
set -eu

# GitLab remote includes can only start from YAML, so setup-vp.yml downloads
# this bootstrap first. Keep this file as a thin shell entrypoint: install vp,
# export PATH for the rest of the job, verify Node.js is available in the
# runner image, then download and execute the compiled TypeScript runtime from
# dist/gitlab/index.mjs.

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

setup_vp_shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

setup_vp_export_env() {
  if [ -z "${SETUP_VP_ENV_FILE:-}" ]; then
    return 0
  fi

  setup_vp_name="$1"
  setup_vp_value="$2"
  printf "export %s=" "$setup_vp_name" >> "$SETUP_VP_ENV_FILE"
  setup_vp_shell_quote "$setup_vp_value" >> "$SETUP_VP_ENV_FILE"
  printf "\n" >> "$SETUP_VP_ENV_FILE"
}

setup_vp_install_viteplus_from() {
  setup_vp_url="$1"
  setup_vp_download "$setup_vp_url" "$setup_vp_install_tmp" || return 1

  if [ -n "$setup_vp_pr_version" ]; then
    VP_VERSION="$SETUP_VP_VERSION" \
      VITE_PLUS_VERSION="$SETUP_VP_VERSION" \
      VP_PR_VERSION="$setup_vp_pr_version" \
      bash "$setup_vp_install_tmp"
  else
    VP_VERSION="$SETUP_VP_VERSION" \
      VITE_PLUS_VERSION="$SETUP_VP_VERSION" \
      bash "$setup_vp_install_tmp"
  fi
}

setup_vp_try_install_urls() {
  setup_vp_round=1
  while [ "$setup_vp_round" -le 2 ]; do
    for setup_vp_url in "$@"; do
      echo "setup-vp: installing Vite+ ${SETUP_VP_VERSION} from ${setup_vp_url}"
      if setup_vp_install_viteplus_from "$setup_vp_url"; then
        return 0
      fi
      echo "setup-vp: install attempt failed; retrying if another source is available." >&2
    done
    setup_vp_round=$((setup_vp_round + 1))
    if [ "$setup_vp_round" -le 2 ]; then
      sleep 2
    fi
  done

  return 1
}

# Prefer the install script pinned to the requested version's git ref (release
# tag, or the commit itself for pkg.pr.new preview builds): the latest script
# tracks the latest CLI and can break older installs. Exhaust the pinned
# sources before falling back to the latest script, so a missing tag or a full
# mirror outage degrades to the previous behavior instead of blocking CI.
setup_vp_install_viteplus() {
  if [ -n "$setup_vp_pinned_ref" ]; then
    if setup_vp_try_install_urls \
      "https://raw.githubusercontent.com/voidzero-dev/vite-plus/${setup_vp_pinned_ref}/packages/cli/install.sh" \
      "https://cdn.jsdelivr.net/gh/voidzero-dev/vite-plus@${setup_vp_pinned_ref}/packages/cli/install.sh"
    then
      return 0
    fi
    echo "setup-vp: could not fetch the install script pinned to Vite+ ${SETUP_VP_VERSION}; falling back to the latest install script, which may not be compatible with ${SETUP_VP_VERSION}." >&2
  fi

  if setup_vp_try_install_urls \
    "https://viteplus.dev/install.sh" \
    "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.sh"
  then
    return 0
  fi

  echo "setup-vp: failed to install Vite+ after retrying all installer URLs." >&2
  return 1
}

SETUP_VP_VERSION="${SETUP_VP_VERSION:-latest}"
SETUP_VP_SETUP_REF="${SETUP_VP_SETUP_REF:-v1}"
SETUP_VP_NODE_MANAGER="${SETUP_VP_NODE_MANAGER:-}"

# Map the tri-state node-manager input onto the install script's
# VP_NODE_MANAGER override (empty keeps the script's CI auto-detection).
# The runtime completes the "false" opt-out with `vp env off` after install.
case "$SETUP_VP_NODE_MANAGER" in
  true | True | TRUE) export VP_NODE_MANAGER="yes" ;;
  false | False | FALSE) export VP_NODE_MANAGER="no" ;;
  "") ;;
  *)
    echo "setup-vp: invalid node-manager value \"${SETUP_VP_NODE_MANAGER}\"; expected \"true\", \"false\", or empty." >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

setup_vp_pr_version=""
if [[ "$SETUP_VP_VERSION" =~ ^0\.0\.0-commit\.([0-9a-fA-F]{40})$ ]]; then
  setup_vp_pr_version="${BASH_REMATCH[1]}"
fi

# Git ref serving the install script that matches the requested version: the
# preview build's commit, or the `v<version>` release tag for an exact version
# (dist-tags like "latest" cannot be mapped and keep the latest script).
setup_vp_pinned_ref=""
if [ -n "$setup_vp_pr_version" ]; then
  setup_vp_pinned_ref="$(printf "%s" "$setup_vp_pr_version" | tr '[:upper:]' '[:lower:]')"
elif [[ "$SETUP_VP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  setup_vp_pinned_ref="v${SETUP_VP_VERSION}"
fi
setup_vp_install_tmp="$(mktemp "${TMPDIR:-/tmp}/setup-vp-install.XXXXXX")"
setup_vp_runtime_tmp="$(mktemp "${TMPDIR:-/tmp}/setup-vp-gitlab-runtime.XXXXXX.mjs")"
trap 'rm -f "$setup_vp_install_tmp" "$setup_vp_runtime_tmp"' EXIT

setup_vp_install_viteplus
export PATH="$HOME/.vite-plus/bin:$PATH"
setup_vp_export_env PATH "$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "setup-vp: Node.js is required in the GitLab runner image to execute the setup-vp runtime." >&2
  return 127 2>/dev/null || exit 127
fi

setup_vp_runtime_url="https://raw.githubusercontent.com/voidzero-dev/setup-vp/${SETUP_VP_SETUP_REF}/dist/gitlab/index.mjs"
setup_vp_download "$setup_vp_runtime_url" "$setup_vp_runtime_tmp"
node "$setup_vp_runtime_tmp"
