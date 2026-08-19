import { info, warning, addPath } from "@actions/core";
import { exec } from "@actions/exec";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { getInstallScriptUrls, pkgPrNewCommitSha } from "./ci/install-script-urls.js";
import {
  createVitePlusDirsFile,
  getInstallScriptCommand,
  removeVitePlusDirsFile,
  resolveVitePlusBinDir,
  supportsVitePlusDirs,
  VP_DIRS_FILE_ENV,
} from "./ci/vp-dirs.js";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";

// Try each group's URLs in order, for up to N rounds per group (max attempts
// per group = rounds * URLs). Two rounds × two URLs = 4 attempts, ~1 minute
// worst case per group.
const INSTALL_MAX_ROUNDS = 2;
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

  const detectDirs = supportsVitePlusDirs(version);
  const dirsFile = detectDirs ? createVitePlusDirsFile() : undefined;
  if (dirsFile) {
    env.VP_VPDIRS_AWARE = "1";
    env[VP_DIRS_FILE_ENV] = dirsFile;
  } else {
    delete env.VP_VPDIRS_AWARE;
    delete env[VP_DIRS_FILE_ENV];
  }

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

  // Prefer the install script pinned to the requested version's git ref. Fall
  // back to the latest script only after all pinned sources fail (see
  // ci/install-script-urls.ts for the rationale).
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

  try {
    if (pinned.length > 0) {
      if (await tryUrls(pinned)) {
        ensureVitePlusBinInPath(dirsFile);
        return;
      }
      warning(
        `Could not fetch the install script pinned to ${DISPLAY_NAME}@${version}. Falling back to the latest install script. The latest script may not be compatible with ${version}.`,
      );
    }

    if (await tryUrls(latest)) {
      ensureVitePlusBinInPath(dirsFile);
      return;
    }

    throw new Error(
      `Failed to install ${DISPLAY_NAME} after ${maxAttempts} attempts across ${totalUrls} URL(s): ${failureReason}`,
    );
  } finally {
    if (dirsFile) removeVitePlusDirsFile(dirsFile);
  }
}

async function runInstallCommand(url: string, env: { [key: string]: string }): Promise<number> {
  const options = { env, ignoreReturnCode: true };
  const { command, args } = getInstallScriptCommand(
    url,
    process.platform,
    env.VP_VPDIRS_AWARE === "1",
  );
  return exec(command, args, options);
}

function ensureVitePlusBinInPath(dirsFile: string | undefined): void {
  const binDir = resolveVitePlusBinDir(dirsFile, join(getVitePlusHome(), "bin"));
  if (!process.env.PATH?.split(delimiter).includes(binDir)) {
    addPath(binDir);
  }
}
