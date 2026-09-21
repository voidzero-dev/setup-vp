#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$RUNNER_TEMP/reuse-curl"
{
  echo "SETUP_VP_REUSE_CURL=$(command -v curl)"
  echo "SETUP_VP_REUSE_DOWNLOADS=$RUNNER_TEMP/setup-vp-reuse-downloads.log"
} >> "$GITHUB_ENV"
: > "$RUNNER_TEMP/setup-vp-reuse-downloads.log"
cat > "$RUNNER_TEMP/reuse-curl/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    */vite-plus-cli-*.tgz) printf '%s\n' "$arg" >> "$SETUP_VP_REUSE_DOWNLOADS" ;;
  esac
done
exec "$SETUP_VP_REUSE_CURL" "$@"
SH
chmod +x "$RUNNER_TEMP/reuse-curl/curl"
echo "$RUNNER_TEMP/reuse-curl" >> "$GITHUB_PATH"
