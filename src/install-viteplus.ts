import { info, warning, addPath, exportVariable } from "@actions/core";
import { exec } from "@actions/exec";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  getInstallScriptSources,
  pkgPrNewCommitSha,
  type InstallScriptSource,
} from "./ci/install-script-urls.js";
import {
  appendFallbackBinToPath,
  createVitePlusDirsFile,
  getInstallScriptCommand,
  removeVitePlusDirsFile,
  resolveVitePlusBinDirs,
  supportsVitePlusDirs,
  VP_DIRS_FILE_ENV,
  type VitePlusBinDirs,
} from "./ci/vp-dirs.js";
import type { Inputs } from "./types.js";
import { DISPLAY_NAME } from "./types.js";
import { getVitePlusHome } from "./utils.js";
import { findReusableVitePlus } from "./reuse-viteplus.js";

// Try each group's URLs in order, for up to N rounds per group (max attempts
// per group = rounds * URLs). Two rounds × two URLs = 4 attempts, ~1 minute
// worst case per group.
const INSTALL_MAX_ROUNDS = 2;
const INSTALL_RETRY_DELAY_MS = 2000;

export async function installVitePlus(inputs: Inputs): Promise<void> {
  const { version } = inputs;

  const existingDirs = findReusableVitePlus(version);
  if (existingDirs) {
    // Prepend even when already present later on PATH: another installation
    // must not shadow the version that passed the reuse checks.
    ensureVitePlusBinsInPath(existingDirs, true);
    info(`Reusing ${DISPLAY_NAME}@${version} from ${existingDirs.bin}`);
    return;
  }

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

  // For pkg.pr.new preview builds, tell the install script to fetch from
  // pkg.pr.new (bypassing the npm registry) instead of resolving VP_VERSION.
  const prVersion = pkgPrNewCommitSha(version);
  if (prVersion) {
    env.VP_PR_VERSION = prVersion;
  }

  // Prefer the bundled pin for the requested version. Try the default pin
  // only after all version-specific sources fail (see
  // ci/install-script-urls.ts for the rationale).
  const { pinned, fallback } = getInstallScriptSources(version);
  const totalUrls = pinned.length + fallback.length;
  const maxAttempts = INSTALL_MAX_ROUNDS * totalUrls;
  let failureReason = "";
  let attempt = 0;

  const tryUrls = async (urls: InstallScriptSource[]): Promise<boolean> => {
    for (let round = 0; round < INSTALL_MAX_ROUNDS; round++) {
      for (const source of urls) {
        const { url } = source;
        attempt++;
        try {
          const exitCode = await runInstallCommand(source, env);
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
        ensureVitePlusBinInPath(version, dirsFile);
        return;
      }
      warning(
        `Could not fetch the install script pinned to ${DISPLAY_NAME}@${version}. Falling back to the checksum-pinned default install script. The default script may not be compatible with ${version}.`,
      );
    }

    if (await tryUrls(fallback)) {
      ensureVitePlusBinInPath(version, dirsFile);
      return;
    }

    throw new Error(
      `Failed to install ${DISPLAY_NAME} after ${maxAttempts} attempts across ${totalUrls} URL(s): ${failureReason}`,
    );
  } finally {
    if (dirsFile) removeVitePlusDirsFile(dirsFile);
  }
}

async function runInstallCommand(
  source: InstallScriptSource,
  env: { [key: string]: string },
): Promise<number> {
  const options = { env, ignoreReturnCode: true };
  const { command, args } = getInstallScriptCommand(
    source,
    process.platform,
    env.VP_VPDIRS_AWARE === "1",
  );
  return exec(command, args, options);
}

function ensureVitePlusBinInPath(version: string, dirsFile: string | undefined): void {
  ensureVitePlusBinsInPath(
    resolveVitePlusBinDirs(version, dirsFile, join(getVitePlusHome(), "bin")),
  );
}

function ensureVitePlusBinsInPath({ bin, fallbackBin }: VitePlusBinDirs, prepend = false): void {
  if (prepend || !process.env.PATH?.split(delimiter).includes(bin)) {
    addPath(bin);
  }
  if (fallbackBin) {
    // GITHUB_PATH only prepends. Export the full PATH so system executables
    // stay ahead of fallback shims in this action and subsequent steps.
    exportVariable("PATH", appendFallbackBinToPath(process.env.PATH, fallbackBin));
  }
}
