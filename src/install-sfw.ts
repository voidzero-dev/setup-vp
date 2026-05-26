import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Track upstream's latest tagged release rather than pinning a specific
// version: sfw is an actively-evolving security tool and a pinned version
// would freeze users on a release the moment a malware-detection update
// shipped upstream. The corresponding risk is reproducibility — a re-run
// of the same commit may pick up a newer sfw — which is a tradeoff we
// accept for now.
const SFW_RELEASE_BASE = "https://github.com/SocketDev/sfw-free/releases/latest/download";
const INSTALL_MAX_ROUNDS = 2;
const INSTALL_RETRY_DELAY_MS = 2000;
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 60";
const PWSH_TIMEOUT_SEC = 60;

// sfw is temporarily only enabled on Linux: sfw's CA cert has an empty
// Extended Key Usage extension that rustls (used by vp) rejects, so
// `sfw vp install` fails the TLS handshake on macOS / Windows before sfw can
// inspect anything. We also fall back when no sfw asset exists for the
// runner's arch (e.g., riscv64, ppc64 self-hosted Linux runners), so the
// action degrades gracefully instead of throwing. Tracking + cleanup
// checklist: https://github.com/voidzero-dev/setup-vp/issues/73
export function isSfwSupported(): boolean {
  if (process.platform !== "linux") return false;
  // Defensive: `!!asset` keeps this correct even if `getSfwAssetName` is later
  // refactored to return `undefined`/`null` instead of throw. The try/catch
  // still covers the current throwing contract.
  try {
    const asset = getSfwAssetName(process.platform, process.arch, isMuslLinux());
    return !!asset;
  } catch {
    return false;
  }
}

export function isMuslLinux(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (report?.header && !report.header.glibcVersionRuntime) {
      return true;
    }
  } catch {
    // fall through to filesystem fallback
  }
  return existsSync("/etc/alpine-release");
}

export function getSfwAssetName(platform: NodeJS.Platform, arch: string, isMusl: boolean): string {
  if (platform === "darwin") {
    if (arch === "arm64") return "sfw-free-macos-arm64";
    if (arch === "x64") return "sfw-free-macos-x86_64";
  } else if (platform === "linux") {
    if (arch === "arm64") {
      return isMusl ? "sfw-free-musl-linux-arm64" : "sfw-free-linux-arm64";
    }
    if (arch === "x64") {
      return isMusl ? "sfw-free-musl-linux-x86_64" : "sfw-free-linux-x86_64";
    }
  } else if (platform === "win32") {
    if (arch === "arm64") return "sfw-free-windows-arm64.exe";
    if (arch === "x64") return "sfw-free-windows-x86_64.exe";
  }
  const libcSuffix = platform === "linux" ? ` (${isMusl ? "musl" : "glibc"})` : "";
  throw new Error(`Unsupported platform/arch for sfw: ${platform}/${arch}${libcSuffix}`);
}

function getSfwBinDir(): string {
  const tmp = process.env.RUNNER_TEMP || process.env.TMPDIR || process.env.TEMP || "/tmp";
  return join(tmp, "sfw-bin");
}

export async function installSfw(): Promise<void> {
  const assetName = getSfwAssetName(process.platform, process.arch, isMuslLinux());
  const url = `${SFW_RELEASE_BASE}/${assetName}`;
  const binDir = getSfwBinDir();
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, process.platform === "win32" ? "sfw.exe" : "sfw");

  info(`Installing sfw from ${url}...`);

  const maxAttempts = INSTALL_MAX_ROUNDS;
  let failureReason = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const exitCode = await runDownloadCommand(url, binPath);
      if (exitCode === 0 && existsSync(binPath)) {
        if (process.platform !== "win32") {
          chmodSync(binPath, 0o755);
        }
        addPath(binDir);
        info(`sfw installed at ${binPath}`);
        return;
      }
      failureReason = `exit code ${exitCode}`;
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxAttempts) {
      warning(
        `Failed to install sfw from ${url} (${failureReason}). Retrying in ${INSTALL_RETRY_DELAY_MS}ms... (attempt ${attempt + 1}/${maxAttempts})`,
      );
      await sleep(INSTALL_RETRY_DELAY_MS);
    }
  }

  throw new Error(
    `Failed to install sfw from ${url} after ${maxAttempts} attempts: ${failureReason}`,
  );
}

async function runDownloadCommand(url: string, outPath: string): Promise<number> {
  const options = { ignoreReturnCode: true };
  if (process.platform === "win32") {
    return exec(
      "pwsh",
      [
        "-Command",
        `Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '${outPath}' -TimeoutSec ${PWSH_TIMEOUT_SEC}`,
      ],
      options,
    );
  }
  return exec(
    "bash",
    ["-c", `set -o pipefail; curl -fsSL ${CURL_TIMEOUT_FLAGS} -o '${outPath}' '${url}'`],
    options,
  );
}
