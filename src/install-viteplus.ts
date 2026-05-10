import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";

const INSTALL_URL_SH = "https://viteplus.dev/install.sh";
const INSTALL_URL_PS1 = "https://viteplus.dev/install.ps1";
const INSTALL_MAX_ATTEMPTS = 3;
const INSTALL_RETRY_DELAY_MS = 2000;

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
      const delay = INSTALL_RETRY_DELAY_MS * attempt;
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
      ["-Command", `& ([scriptblock]::Create((irm ${INSTALL_URL_PS1})))`],
      options,
    );
  }
  return exec("bash", ["-c", `set -o pipefail; curl -fsSL ${INSTALL_URL_SH} | bash`], options);
}

function ensureVitePlusBinInPath(): void {
  const binDir = join(getVitePlusHome(), "bin");
  if (!process.env.PATH?.includes(binDir)) {
    addPath(binDir);
  }
}
