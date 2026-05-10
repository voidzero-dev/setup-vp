import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";

const INSTALL_URL_SH = "https://viteplus.dev/install.sh";
const INSTALL_URL_PS1 = "https://viteplus.dev/install.ps1";
const INSTALL_MAX_ATTEMPTS = 5;
// Exponential-ish back-off between outer attempts (ms). Length must be
// INSTALL_MAX_ATTEMPTS - 1; the last attempt has no trailing wait.
const INSTALL_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];
// Per-attempt curl options: retry transient network errors inside one attempt
// so a brief blip doesn't burn an outer attempt. --retry-all-errors covers
// connection resets during TLS handshake (curl error 35 / "Recv failure").
const CURL_RETRY_FLAGS =
  "--connect-timeout 10 --max-time 60 --retry 3 --retry-delay 5 --retry-all-errors";

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

  let failureReason = "";
  for (let attempt = 1; attempt <= INSTALL_MAX_ATTEMPTS; attempt++) {
    try {
      const exitCode = await runInstallCommand(env);
      if (exitCode === 0) {
        ensureVitePlusBinInPath();
        return;
      }
      failureReason = `exit code ${exitCode}`;
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
    }

    if (attempt < INSTALL_MAX_ATTEMPTS) {
      const delay = INSTALL_RETRY_DELAYS_MS[attempt - 1];
      warning(
        `Failed to install ${DISPLAY_NAME} (${failureReason}). Retrying in ${delay}ms... (attempt ${attempt + 1}/${INSTALL_MAX_ATTEMPTS})`,
      );
      await sleep(delay);
    }
  }

  throw new Error(
    `Failed to install ${DISPLAY_NAME} after ${INSTALL_MAX_ATTEMPTS} attempts: ${failureReason}`,
  );
}

async function runInstallCommand(env: { [key: string]: string }): Promise<number> {
  const options = { env, ignoreReturnCode: true };
  if (process.platform === "win32") {
    return exec(
      "pwsh",
      [
        "-Command",
        `& ([scriptblock]::Create((irm -MaximumRetryCount 3 -RetryIntervalSec 5 ${INSTALL_URL_PS1})))`,
      ],
      options,
    );
  }
  return exec(
    "bash",
    ["-c", `set -o pipefail; curl -fsSL ${CURL_RETRY_FLAGS} ${INSTALL_URL_SH} | bash`],
    options,
  );
}

function ensureVitePlusBinInPath(): void {
  const binDir = join(getVitePlusHome(), "bin");
  if (!process.env.PATH?.includes(binDir)) {
    addPath(binDir);
  }
}
