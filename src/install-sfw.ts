import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Inputs } from "./types.js";

// Pin sfw so a re-run of the same commit gets the same binary. Renovate
// watches SFW_VERSION (see .github/renovate.json customManagers entry) and
// opens PRs whenever SocketDev publishes a new sfw-free release, keeping
// us close to the latest malware-detection updates without giving up
// reproducibility. For stricter supply-chain hygiene, users can compose
// `socketdev/action@<sha>` ahead of this action — see README "Advanced:
// stricter supply chain via socketdev/action".
const SFW_VERSION = "v1.10.0";
const SFW_RELEASE_BASE = `https://github.com/SocketDev/sfw-free/releases/download/${SFW_VERSION}`;
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

// Returns the absolute path to a pre-existing sfw binary on PATH, or null.
// Used to detect when the user composed `socketdev/action@<sha>` (or
// installed sfw via some other means) before invoking this action.
export function findSfwOnPath(): string | null {
  const lookupCmd = process.platform === "win32" ? "where" : "which";
  try {
    const stdout = execFileSync(lookupCmd, ["sfw"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const firstLine = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    return firstLine ? firstLine.trim() : null;
  } catch {
    return null;
  }
}

// Decide what to do with `sfw: true`. Returns whether `vp install` should be
// wrapped with sfw. Centralizes the four cases (run-install disabled / sfw
// already on PATH / supported platform / unsupported platform) and emits one
// log message per branch so the chosen path is always visible.
export async function setupSfw(inputs: Inputs): Promise<boolean> {
  if (!inputs.sfw) return false;

  if (inputs.runInstall.length === 0) {
    info("sfw was requested but `run-install` is disabled; sfw will not be invoked.");
    return false;
  }

  // Prefer an externally-provided sfw — typically installed by a prior
  // `socketdev/action@<sha>` step. That path lets users SHA-pin sfw via
  // Renovate against the upstream action repo, which is stricter than our
  // bundled releases/download URL.
  const existing = findSfwOnPath();
  if (existing) {
    info(`Using existing sfw on PATH: ${existing}`);
    return true;
  }

  if (!isSfwSupported()) {
    const env = `process.platform=${process.platform}, process.arch=${process.arch}, musl=${isMuslLinux()}`;
    warning(
      `sfw is temporarily not supported on this runner (${env}) and no sfw was found on PATH; falling back to plain \`vp install\`. To enable sfw here, install it via \`socketdev/action@<sha>\` in an earlier step. Tracking: https://github.com/voidzero-dev/setup-vp/issues/73`,
    );
    return false;
  }

  await installSfw();
  return true;
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
