import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getInstallScriptUrls, pkgPrNewCommitSha } from "./ci/install-script-urls.js";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";

// Alternate through each URL group's sources for up to N rounds (max attempts
// per group = rounds * URLs). Two rounds × two URLs = 4 attempts, ~1 minute
// worst case per group.
const INSTALL_MAX_ROUNDS = 2;
const INSTALL_RETRY_DELAY_MS = 2000;
// Cap each network call so a hung connection fails fast (failing runs showed
// ~30s default hangs); the outer loop then immediately tries the next URL.
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 15";
const PWSH_TIMEOUT_SEC = 15;

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

  // The install script auto-enables the Node.js manager on CI; VP_NODE_MANAGER
  // overrides that (yes/no; "no" skips node/npm/npx shim creation). The runtime
  // half of the opt-out (`vp env off`) runs after install in runMain.
  if (inputs.nodeManager !== undefined) {
    env.VP_NODE_MANAGER = inputs.nodeManager ? "yes" : "no";
  }

  // For pkg.pr.new preview builds, tell the install script to fetch from
  // pkg.pr.new (bypassing the npm registry) instead of resolving VP_VERSION.
  const prVersion = pkgPrNewCommitSha(version);
  if (prVersion) {
    env.VP_PR_VERSION = prVersion;
  }

  // Prefer the install script pinned to the requested version's git ref, and
  // fall back to the latest script only after exhausting the pinned sources
  // (see ci/install-script-urls.ts for the rationale).
  const { pinned, latest } = getInstallScriptUrls(version);
  const totalUrls = pinned.length + latest.length;
  const maxAttempts = INSTALL_MAX_ROUNDS * totalUrls;
  let failureReason = "";
  let attempt = 0;

  const tryUrls = async (urls: string[]): Promise<boolean> => {
    for (let round = 0; round < INSTALL_MAX_ROUNDS; round++) {
      for (const url of urls) {
        attempt++;
        try {
          const exitCode = await runInstallCommand(url, env);
          if (exitCode === 0) return true;
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
    return false;
  };

  if (pinned.length > 0) {
    if (await tryUrls(pinned)) {
      ensureVitePlusBinInPath();
      return;
    }
    warning(
      `Could not fetch the install script pinned to ${DISPLAY_NAME}@${version}; falling back to the latest install script, which may not be compatible with ${version}.`,
    );
  }

  if (await tryUrls(latest)) {
    ensureVitePlusBinInPath();
    return;
  }

  throw new Error(
    `Failed to install ${DISPLAY_NAME} after ${maxAttempts} attempts across ${totalUrls} URL(s): ${failureReason}`,
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
