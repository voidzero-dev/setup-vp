import { info, debug, warning, addPath } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import type { Inputs } from "./types.js";
import { PACKAGE_NAME } from "./types.js";

export async function installVitePlus(inputs: Inputs): Promise<void> {
  const { version } = inputs;

  info(`Installing ${PACKAGE_NAME}@${version}...`);

  // Build npm install command arguments
  const packageSpec = version === "latest" ? PACKAGE_NAME : `${PACKAGE_NAME}@${version}`;
  const args = ["install", "-g", packageSpec];

  debug(`Running: npm ${args.join(" ")}`);

  const exitCode = await exec("npm", args);

  if (exitCode !== 0) {
    throw new Error(`Failed to install ${PACKAGE_NAME}. Exit code: ${exitCode}`);
  }

  // Ensure global bin is in PATH
  await ensureGlobalBinInPath();
}

async function ensureGlobalBinInPath(): Promise<void> {
  try {
    // Use 'npm config get prefix' instead of deprecated 'npm bin -g'
    const result = await getExecOutput("npm", ["config", "get", "prefix"], {
      silent: true,
    });
    const prefix = result.stdout.trim();
    if (!prefix) {
      return;
    }
    // On Unix-like systems, global binaries are in {prefix}/bin
    // On Windows, they're directly in {prefix}
    const globalBin = process.platform === "win32" ? prefix : `${prefix}/bin`;
    if (!process.env.PATH?.includes(globalBin)) {
      addPath(globalBin);
      debug(`Added ${globalBin} to PATH`);
    }
  } catch (error) {
    warning(`Could not determine global npm bin path: ${error}`);
  }
}
