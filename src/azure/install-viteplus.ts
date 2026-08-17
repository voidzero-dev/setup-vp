import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { getInstallScriptUrls, pkgPrNewCommitSha } from "../ci/install-script-urls.js";
import { logWarning } from "./commands.js";

const INSTALL_MAX_ROUNDS = 2;
const INSTALL_RETRY_DELAY_MS = 2000;
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 15";
const PWSH_TIMEOUT_SEC = 15;

export function getVitePlusHome(platform: NodeJS.Platform = process.platform): string {
  const home =
    platform === "win32" ? process.env.USERPROFILE || homedir() : process.env.HOME || homedir();
  return join(home, ".vite-plus");
}

function runInstallCommand(
  url: string,
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): number {
  if (platform === "win32") {
    const result = spawnSync(
      "pwsh",
      ["-Command", `& ([scriptblock]::Create((irm -TimeoutSec ${PWSH_TIMEOUT_SEC} ${url})))`],
      { env: { ...process.env, ...env }, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  }

  const result = spawnSync(
    "bash",
    ["-c", `set -o pipefail; curl -fsSL ${CURL_TIMEOUT_FLAGS} ${url} | bash`],
    { env: { ...process.env, ...env }, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export async function installVitePlus(
  version: string,
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    nodeManager?: boolean;
    prependPath?: (binDir: string) => void;
    sleep?: (ms: number) => Promise<void>;
    runInstall?: typeof runInstallCommand;
    logWarningFn?: (message: string) => void;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const targetEnv = options.env ?? process.env;
  const prependPath = options.prependPath;
  const delay = options.sleep ?? sleep;
  const runInstall = options.runInstall ?? runInstallCommand;
  const warn = options.logWarningFn ?? logWarning;

  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(targetEnv).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    VP_VERSION: version,
    VITE_PLUS_VERSION: version,
  };

  const prVersion = pkgPrNewCommitSha(version);
  if (prVersion) {
    env.VP_PR_VERSION = prVersion;
  }

  // The install script auto-enables the Node.js manager on CI; VP_NODE_MANAGER
  // overrides that (yes/no; "no" skips node/npm/npx shim creation). The runtime
  // half of the opt-out (`vp env off`) runs after install in runPrepare.
  if (options.nodeManager !== undefined) {
    env.VP_NODE_MANAGER = options.nodeManager ? "yes" : "no";
  }

  // Prefer the install script pinned to the requested version's git ref. Fall
  // back to the latest script only after all pinned sources fail (see
  // ../ci/install-script-urls.ts for the rationale).
  const { pinned, latest } = getInstallScriptUrls(version, platform);
  const totalUrls = pinned.length + latest.length;
  const maxAttempts = INSTALL_MAX_ROUNDS * totalUrls;
  let failureReason = "";
  let attempt = 0;

  const tryUrls = async (urls: string[]): Promise<boolean> => {
    for (let round = 0; round < INSTALL_MAX_ROUNDS; round += 1) {
      for (const url of urls) {
        attempt += 1;
        try {
          const exitCode = runInstall(url, env, platform);
          if (exitCode === 0) return true;
          failureReason = `exit code ${exitCode}`;
        } catch (error) {
          failureReason = error instanceof Error ? error.message : String(error);
        }

        if (attempt < maxAttempts) {
          warn(
            `setup-vp: failed to install Vite+ from ${url} (${failureReason}). Retrying in ${INSTALL_RETRY_DELAY_MS}ms... (attempt ${attempt + 1}/${maxAttempts})`,
          );
          await delay(INSTALL_RETRY_DELAY_MS);
        }
      }
    }
    return false;
  };

  const ensureBinInPath = (): void => {
    const binDir = join(getVitePlusHome(platform), "bin");
    if (!targetEnv.PATH?.includes(binDir)) {
      const separator = platform === "win32" ? ";" : ":";
      targetEnv.PATH = `${binDir}${separator}${targetEnv.PATH || ""}`;
      prependPath?.(binDir);
    }
  };

  if (pinned.length > 0) {
    if (await tryUrls(pinned)) {
      ensureBinInPath();
      return;
    }
    warn(
      `setup-vp: could not fetch the install script pinned to Vite+ ${version}. Falling back to the latest install script. The latest script may not be compatible with ${version}.`,
    );
  }

  if (await tryUrls(latest)) {
    ensureBinInPath();
    return;
  }

  throw new Error(
    `Failed to install Vite+ after ${maxAttempts} attempts across ${totalUrls} URL(s): ${failureReason}`,
  );
}
