import { info, debug, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { join } from "node:path";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";

const INSTALL_URL_SH = "https://staging.viteplus.dev/install.sh";
const INSTALL_URL_PS1 = "https://staging.viteplus.dev/install.ps1";

export async function installVitePlus(inputs: Inputs): Promise<void> {
  const { version } = inputs;
  info(`Installing ${DISPLAY_NAME}@${version}...`);

  const env = { ...process.env, VITE_PLUS_VERSION: version };
  let exitCode: number;

  if (process.platform === "win32") {
    exitCode = await exec(
      "pwsh",
      ["-Command", `& ([scriptblock]::Create((irm ${INSTALL_URL_PS1})))`],
      { env },
    );
  } else {
    exitCode = await exec("bash", ["-c", `curl -fsSL ${INSTALL_URL_SH} | bash`], { env });
  }

  if (exitCode !== 0) {
    throw new Error(`Failed to install ${DISPLAY_NAME}. Exit code: ${exitCode}`);
  }

  ensureVitePlusBinInPath();
}

function ensureVitePlusBinInPath(): void {
  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  if (!home) {
    debug("Could not determine home directory");
    return;
  }
  const binDir = join(home, ".vite-plus", "bin");
  if (!process.env.PATH?.includes(binDir)) {
    addPath(binDir);
    debug(`Added ${binDir} to PATH`);
  }
}
