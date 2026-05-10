import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";

// Primary CDN first; if it stays down, fall back to the install scripts in the
// vite-plus repo so a CDN/edge incident doesn't fully block CI.
const INSTALL_URLS_SH = [
  "https://viteplus.dev/install.sh",
  "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.sh",
];
const INSTALL_URLS_PS1 = [
  "https://viteplus.dev/install.ps1",
  "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.ps1",
];
const INSTALL_MAX_ATTEMPTS = 3;
const INSTALL_RETRY_DELAY_MS = 2000;
// Cap each curl invocation so a hung connection fails fast and the outer
// retry can move on (default observed in failing runs was ~30s per call).
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 30";

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

  const urls = process.platform === "win32" ? INSTALL_URLS_PS1 : INSTALL_URLS_SH;
  let failureReason = "";
  for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
    const url = urls[urlIndex];
    if (urlIndex > 0) {
      info(`Retrying with fallback URL: ${url}`);
    }
    for (let attempt = 1; attempt <= INSTALL_MAX_ATTEMPTS; attempt++) {
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

      const isLastAttemptOnLastUrl =
        attempt === INSTALL_MAX_ATTEMPTS && urlIndex === urls.length - 1;
      if (!isLastAttemptOnLastUrl) {
        const delay = INSTALL_RETRY_DELAY_MS * attempt;
        const nextAttempt =
          attempt < INSTALL_MAX_ATTEMPTS
            ? `attempt ${attempt + 1}/${INSTALL_MAX_ATTEMPTS}`
            : "fallback URL";
        warning(
          `Failed to install ${DISPLAY_NAME} (${failureReason}). Retrying in ${delay}ms... (${nextAttempt})`,
        );
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `Failed to install ${DISPLAY_NAME} after ${INSTALL_MAX_ATTEMPTS} attempts on ${urls.length} URL(s): ${failureReason}`,
  );
}

async function runInstallCommand(url: string, env: { [key: string]: string }): Promise<number> {
  const options = { env, ignoreReturnCode: true };
  if (process.platform === "win32") {
    return exec("pwsh", ["-Command", `& ([scriptblock]::Create((irm ${url})))`], options);
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
