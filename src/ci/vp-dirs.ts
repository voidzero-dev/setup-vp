import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pkgPrNewCommitSha, type InstallScriptSource } from "./install-script-urls.js";
import { isWindows } from "./platform.js";
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

export interface VitePlusBinDirs {
  bin: string;
  fallbackBin?: string;
}

export function getVitePlusBinDirs(dirs: VitePlusDirs): VitePlusBinDirs {
  const fallbackBin = join(dirs.data, "fallback-bin");
  // Older releases do not create a fallback directory. Use the resolved data
  // root because split layouts can place it outside the main bin directory.
  return statSync(fallbackBin, { throwIfNoEntry: false })?.isDirectory()
    ? { bin: dirs.bin, fallbackBin }
    : { bin: dirs.bin };
}

export function appendFallbackBinToPath(
  path: string | undefined,
  fallbackBin: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const separator = isWindows(platform) ? ";" : ":";
  const entries = path ? path.split(separator).filter((entry) => entry !== fallbackBin) : [];
  return [...entries, fallbackBin].join(separator);
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

export function resolveVitePlusBinDirs(
  requestedVersion: string,
  dirsFile: string | undefined,
  legacyBinDir: string,
): VitePlusBinDirs {
  if (!dirsFile) {
    if (!supportsVitePlusDirs(requestedVersion)) return { bin: legacyBinDir };
    throw new Error("Vite+ was installed successfully, but setup-vp could not resolve its VpDirs.");
  }

  const output = readVitePlusProbe(dirsFile);
  const dirs = output === undefined ? undefined : parseVitePlusDirs(output);
  if (dirs) return getVitePlusBinDirs(dirs);

  const hasKnownRequestedVersion =
    pkgPrNewCommitSha(requestedVersion) !== undefined || EXACT_VERSION_RE.test(requestedVersion);
  if (!hasKnownRequestedVersion && output !== undefined) {
    const installedVersion = parseInstalledVpVersion(output);
    if (installedVersion !== "unknown" && !supportsVitePlusDirs(installedVersion)) {
      return { bin: legacyBinDir };
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
  source: InstallScriptSource,
  platform: NodeJS.Platform = process.platform,
  detectDirs = true,
): { command: string; args: string[] } {
  const files = [{ ...source, name: isWindows(platform) ? "install.ps1" : "install.sh" }];
  if (source.legacy) {
    files.push({
      ...source.legacy,
      name: isWindows(platform) ? "install-legacy.ps1" : "install-legacy.sh",
    });
  }
  for (const file of files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error("A trusted SHA-256 checksum is required for the Vite+ installer.");
    }
  }

  if (isWindows(platform)) {
    const probe = `
$dirsFile = $env:${VP_DIRS_FILE_ENV}
Set-Content -LiteralPath $dirsFile -Value '' -NoNewline -Encoding UTF8
. $installerFile
$vpDir = if ($script:ShimDir) {
  $script:ShimDir
} elseif ($InstallDir) {
  Join-Path $InstallDir 'bin'
} else {
  Join-Path $env:USERPROFILE '.vite-plus\\bin'
}
$vpPath = Join-Path $vpDir 'vp.exe'
if (-not (Test-Path -LiteralPath $vpPath -PathType Leaf)) {
  throw "setup-vp requires vp.exe in the installed bin directory: $vpDir"
}
& $vpPath --version | Set-Content -LiteralPath $dirsFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$env:VP_DUMP_DIRS = '1'
& $vpPath | Add-Content -LiteralPath $dirsFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`.trim();
    const script = `
$ErrorActionPreference = 'Stop'
$installerDir = Join-Path ([System.IO.Path]::GetTempPath()) ('setup-vp-install-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $installerDir
$installerFile = Join-Path $installerDir 'install.ps1'
try {
  ${files
    .map(
      ({ url, sha256, name }) => `
  $downloadFile = Join-Path $installerDir '${name}'
  Invoke-WebRequest -UseBasicParsing -TimeoutSec ${PWSH_TIMEOUT_SEC} -Uri '${url.replaceAll("'", "''")}' -OutFile $downloadFile
  if ((Get-FileHash -LiteralPath $downloadFile -Algorithm SHA256).Hash -ne '${sha256}') {
    throw 'setup-vp: installer SHA-256 checksum mismatch; refusing to execute it.'
  }`,
    )
    .join("\n")}
  $global:LASTEXITCODE = 0
  ${detectDirs ? probe : "& $installerFile\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"}
} finally {
  Remove-Item -LiteralPath $installerDir -Recurse -Force
}
`.trim();
    // The verified files replace the old in-memory script blocks. Permit them
    // in this child session without changing the runner's persistent policy.
    return { command: "pwsh", args: ["-ExecutionPolicy", "Bypass", "-Command", script] };
  }

  // Use the same Node executable as this runtime so minimal runners do not
  // need sha256sum/shasum or a separate node command on PATH.
  const verify = `const fs = require("node:fs");
const crypto = require("node:crypto");
const actual = crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex");
if (actual !== process.argv[2]) {
  console.error("setup-vp: installer SHA-256 checksum mismatch; refusing to execute it.");
  process.exit(1);
}`;
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  // Upstream installers read optional positional arguments without defaults.
  // Do not inherit nounset from a caller that exports SHELLOPTS.
  const script = `
set +u
set -eo pipefail
installer_dir="$(mktemp -d "\${TMPDIR:-/tmp}/setup-vp-install.XXXXXX")"
trap 'rm -rf "$installer_dir"' EXIT
installer_file="$installer_dir/install.sh"
${files
  .map(
    ({ url, sha256, name }) => `
download_file="$installer_dir/${name}"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL ${CURL_TIMEOUT_FLAGS} ${quote(url)} -o "$download_file"
elif command -v wget >/dev/null 2>&1; then
  wget -q -T 15 -t 1 -O "$download_file" ${quote(url)}
else
  echo "setup-vp: curl or wget is required to download the installer." >&2
  exit 127
fi
${quote(process.execPath)} -e ${quote(verify)} "$download_file" '${sha256}'
`,
  )
  .join("\n")}
${
  detectDirs
    ? `: > "$${VP_DIRS_FILE_ENV}"
source "$installer_file"
vp_dir="\${SHIM_DIR:-\${INSTALL_DIR:-\${VP_HOME:-$HOME/.vite-plus}}/bin}"
if [ -x "$vp_dir/vp" ]; then
  "$vp_dir/vp" --version > "$${VP_DIRS_FILE_ENV}"
  VP_DUMP_DIRS=1 "$vp_dir/vp" >> "$${VP_DIRS_FILE_ENV}"
fi`
    : 'bash "$installer_file"'
}
`.trim();
  return { command: "bash", args: ["-c", script] };
}
