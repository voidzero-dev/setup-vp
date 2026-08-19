import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkgPrNewCommitSha } from "./install-script-urls.js";

// Keep installer network calls bounded so a hung source fails over quickly.
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 15";
const PWSH_TIMEOUT_SEC = 15;

export const VP_DIRS_FILE_ENV = "SETUP_VP_DIRS_FILE";

export interface VitePlusDirs {
  data: string;
  bin: string;
  cache: string;
  config: string;
  state: string;
}

const EXACT_VERSION_RE = /^v?(\d+)\.(\d+)\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function supportsVitePlusDirs(version: string): boolean {
  if (pkgPrNewCommitSha(version)) return true;

  const match = version.match(EXACT_VERSION_RE);
  // Dist-tags resolve during installation. They track current releases, so
  // keep VpDirs detection enabled when an exact version is not available.
  if (!match) return true;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 3;
}

export function createVitePlusDirsFile(): string {
  return join(tmpdir(), `setup-vp-dirs-${randomUUID()}.txt`);
}

export function removeVitePlusDirsFile(filePath: string): void {
  rmSync(filePath, { force: true });
}

export function readVitePlusDirs(filePath: string): VitePlusDirs | undefined {
  try {
    return parseVitePlusDirs(readFileSync(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function resolveVitePlusBinDir(dirsFile: string | undefined, legacyBinDir: string): string {
  if (!dirsFile) return legacyBinDir;

  const dirs = readVitePlusDirs(dirsFile);
  if (!dirs) {
    throw new Error("Vite+ was installed successfully, but setup-vp could not resolve its VpDirs.");
  }
  return dirs.bin;
}

export function parseVitePlusDirs(output: string): VitePlusDirs | undefined {
  const dirs = new Map<string, string>();

  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("\t");
    if (separator < 1) continue;
    const key = line.slice(0, separator).replace(/^\uFEFF/, "");
    const value = line.slice(separator + 1).trim();
    if (value) dirs.set(key, value);
  }

  const data = dirs.get("data");
  const bin = dirs.get("bin");
  const cache = dirs.get("cache");
  const config = dirs.get("config");
  const state = dirs.get("state");
  if (!data || !bin || !cache || !config || !state) return undefined;

  return { data, bin, cache, config, state };
}

export function getInstallScriptCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  detectDirs = true,
): { command: string; args: string[] } {
  if (platform === "win32") {
    if (!detectDirs) {
      return {
        command: "pwsh",
        args: [
          "-Command",
          `& ([scriptblock]::Create((irm -TimeoutSec ${PWSH_TIMEOUT_SEC} ${url})))`,
        ],
      };
    }

    const script = `
$dirsFile = $env:${VP_DIRS_FILE_ENV}
Set-Content -LiteralPath $dirsFile -Value '' -NoNewline
. ([scriptblock]::Create((irm -TimeoutSec ${PWSH_TIMEOUT_SEC} ${url})))
$vpPath = if ($script:ShimDir) { Join-Path $script:ShimDir 'vp.exe' } else { $null }
if ($vpPath -and (Test-Path -LiteralPath $vpPath)) {
  $env:VP_DUMP_DIRS = '1'
  & $vpPath | Set-Content -LiteralPath $dirsFile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
`.trim();
    return { command: "pwsh", args: ["-Command", script] };
  }

  if (!detectDirs) {
    const script = `
set -o pipefail
curl -fsSL ${CURL_TIMEOUT_FLAGS} ${url} | bash
`.trim();
    return { command: "bash", args: ["-c", script] };
  }

  const script = `
set -eo pipefail
installer_file="$(mktemp "\${TMPDIR:-/tmp}/setup-vp-install.XXXXXX")"
trap 'rm -f "$installer_file"' EXIT
: > "$${VP_DIRS_FILE_ENV}"
curl -fsSL ${CURL_TIMEOUT_FLAGS} ${url} -o "$installer_file"
source "$installer_file"
if [ -n "\${SHIM_DIR:-}" ] && [ -x "$SHIM_DIR/vp" ]; then
  VP_DUMP_DIRS=1 "$SHIM_DIR/vp" > "$${VP_DIRS_FILE_ENV}"
fi
`.trim();
  return { command: "bash", args: ["-c", script] };
}
