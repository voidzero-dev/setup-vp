import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkgPrNewCommitSha } from "./install-script-urls.js";
import { parseInstalledVpVersion } from "./version.js";

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
  // Dist-tags resolve during installation. Keep the probe enabled so the
  // installed version can decide whether missing VpDirs output is valid.
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
  const output = readVitePlusProbe(filePath);
  return output === undefined ? undefined : parseVitePlusDirs(output);
}

function readVitePlusProbe(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function resolveVitePlusBinDir(
  requestedVersion: string,
  dirsFile: string | undefined,
  legacyBinDir: string,
): string {
  if (!dirsFile) {
    if (!supportsVitePlusDirs(requestedVersion)) return legacyBinDir;
    throw new Error("Vite+ was installed successfully, but setup-vp could not resolve its VpDirs.");
  }

  const output = readVitePlusProbe(dirsFile);
  const dirs = output === undefined ? undefined : parseVitePlusDirs(output);
  if (dirs) return dirs.bin;

  const hasKnownRequestedVersion =
    pkgPrNewCommitSha(requestedVersion) !== undefined || EXACT_VERSION_RE.test(requestedVersion);
  if (!hasKnownRequestedVersion && output !== undefined) {
    const installedVersion = parseInstalledVpVersion(output);
    if (installedVersion !== "unknown" && !supportsVitePlusDirs(installedVersion)) {
      return legacyBinDir;
    }
  }

  throw new Error("Vite+ was installed successfully, but setup-vp could not resolve its VpDirs.");
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
$vpDir = if ($script:ShimDir) {
  $script:ShimDir
} elseif ($InstallDir) {
  Join-Path $InstallDir 'bin'
} else {
  Join-Path $env:USERPROFILE '.vite-plus\\bin'
}
$vpPath = Join-Path $vpDir 'vp.exe'
if (-not (Test-Path -LiteralPath $vpPath)) {
  $vpPath = Join-Path $vpDir 'vp.cmd'
}
if (Test-Path -LiteralPath $vpPath) {
  & $vpPath --version | Set-Content -LiteralPath $dirsFile
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $env:VP_DUMP_DIRS = '1'
  & $vpPath | Add-Content -LiteralPath $dirsFile
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
vp_dir="\${SHIM_DIR:-\${INSTALL_DIR:-\${VP_HOME:-$HOME/.vite-plus}}/bin}"
if [ -x "$vp_dir/vp" ]; then
  "$vp_dir/vp" --version > "$${VP_DIRS_FILE_ENV}"
  VP_DUMP_DIRS=1 "$vp_dir/vp" >> "$${VP_DIRS_FILE_ENV}"
fi
`.trim();
  return { command: "bash", args: ["-c", script] };
}
