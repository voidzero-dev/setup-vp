import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";

// Try the CDN first, then fall back to the install scripts in the vite-plus
// repo so a CDN/edge incident doesn't fully block CI.
const INSTALL_URLS_SH = [
  "https://viteplus.dev/install.sh",
  "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.sh",
];
const INSTALL_URLS_PS1 = [
  "https://viteplus.dev/install.ps1",
  "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.ps1",
];
// Alternate primary/fallback for up to N rounds (max attempts = rounds * URLs).
// Two rounds × two URLs = 4 attempts, ~1 minute worst case.
const INSTALL_MAX_ROUNDS = 2;
const INSTALL_RETRY_DELAY_MS = 2000;
// Cap each network call so a hung connection fails fast (failing runs showed
// ~30s default hangs); the outer loop then immediately tries the next URL.
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 15";
const PWSH_TIMEOUT_SEC = 15;

// pkg.pr.new preview builds are published as `0.0.0-commit.<sha>` (for example
// via the vite-plus registry bridge that `vp migrate` writes into `.npmrc`).
// Those builds live only on pkg.pr.new, never on the npm registry, and the
// install script does not read `.npmrc`: it resolves `VP_VERSION` straight
// from the npm registry, so a commit build 404s there. Extract the commit SHA
// so we can route it through the script's pkg.pr.new path via VP_PR_VERSION.
// The bridge only ever publishes `0.0.0-commit.<full 40-char sha>`, and the
// install script maps a 40-char SHA straight to that build, so require exactly
// 40 hex chars and nothing shorter is mistaken for a commit build.
const PKG_PR_NEW_COMMIT_RE = /^0\.0\.0-commit\.([0-9a-f]{40})$/i;

function pkgPrNewCommitSha(version: string): string | undefined {
  return version.match(PKG_PR_NEW_COMMIT_RE)?.[1];
}

export async function installVitePlus(inputs: Inputs): Promise<void> {
  const { version } = inputs;

  info(`Installing ${DISPLAY_NAME}@${version}...`);

  // TODO: Remove VITE_PLUS_VERSION once vite-plus versions before the VP_* env var
  // rename (see https://github.com/voidzero-dev/vite-plus/pull/1166) are no longer supported.
  const env = {
    ...process.env,
    VP_VERSION: version,
    VITE_PLUS_VERSION: version,
  } as { [key: string]: string };

  // For pkg.pr.new preview builds, tell the install script to fetch from
  // pkg.pr.new (bypassing the npm registry) instead of resolving VP_VERSION.
  const prVersion = pkgPrNewCommitSha(version);
  if (prVersion) {
    env.VP_PR_VERSION = prVersion;
  }

  const urls = process.platform === "win32" ? INSTALL_URLS_PS1 : INSTALL_URLS_SH;
  const maxAttempts = INSTALL_MAX_ROUNDS * urls.length;
  let failureReason = "";
  let attempt = 0;
  for (let round = 0; round < INSTALL_MAX_ROUNDS; round++) {
    for (const url of urls) {
      attempt++;
      try {
        const exitCode = await runInstallCommand(url, env);
        if (exitCode === 0) {
          ensureVitePlusBinInPath();
          return;
        }
        failureReason = `exit code ${exitCode}`;
      } catch (error) {
        failureReason = error instanceof Error ? error.message : String(error);
      }

      if (attempt < maxAttempts) {
        warning(
          `Failed to install ${DISPLAY_NAME} from ${url} (${failureReason}). Retrying in ${INSTALL_RETRY_DELAY_MS}ms... (attempt ${attempt + 1}/${maxAttempts})`,
        );
        await sleep(INSTALL_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `Failed to install ${DISPLAY_NAME} after ${maxAttempts} attempts across ${urls.length} URL(s): ${failureReason}`,
  );
}

async function runInstallCommand(url: string, env: { [key: string]: string }): Promise<number> {
  const options = { env, ignoreReturnCode: true };
  if (process.platform === "win32") {
    return exec(
      "pwsh",
      ["-Command", `& ([scriptblock]::Create((irm -TimeoutSec ${PWSH_TIMEOUT_SEC} ${url})))`],
      options,
    );
  }
  return exec(
    "bash",
    ["-c", `set -o pipefail; curl -fsSL ${CURL_TIMEOUT_FLAGS} ${url} | bash`],
    options,
  );
}

function ensureVitePlusBinInPath(): void {
  const binDir = join(getVitePlusHome(), "bin");
  if (!process.env.PATH?.includes(binDir)) {
    addPath(binDir);
  }
}
