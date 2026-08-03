import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { logWarning } from "./commands.js";

const INSTALL_URLS_SH = [
  "https://viteplus.dev/install.sh",
  "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.sh",
];
const INSTALL_URLS_PS1 = [
  "https://viteplus.dev/install.ps1",
  "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.ps1",
];
const INSTALL_MAX_ROUNDS = 2;
const INSTALL_RETRY_DELAY_MS = 2000;
const CURL_TIMEOUT_FLAGS = "--connect-timeout 5 --max-time 15";
const PWSH_TIMEOUT_SEC = 15;
const PKG_PR_NEW_COMMIT_RE = /^0\.0\.0-commit\.([0-9a-f]{40})$/i;

export function getVitePlusHome(platform: NodeJS.Platform = process.platform): string {
  const home =
    platform === "win32" ? process.env.USERPROFILE || homedir() : process.env.HOME || homedir();
  return join(home, ".vite-plus");
}

function pkgPrNewCommitSha(version: string): string | undefined {
  return version.match(PKG_PR_NEW_COMMIT_RE)?.[1];
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

  const urls = platform === "win32" ? INSTALL_URLS_PS1 : INSTALL_URLS_SH;
  const maxAttempts = INSTALL_MAX_ROUNDS * urls.length;
  let failureReason = "";
  let attempt = 0;

  for (let round = 0; round < INSTALL_MAX_ROUNDS; round += 1) {
    for (const url of urls) {
      attempt += 1;
      try {
        const exitCode = runInstall(url, env, platform);
        if (exitCode === 0) {
          const binDir = join(getVitePlusHome(platform), "bin");
          if (!targetEnv.PATH?.includes(binDir)) {
            const separator = platform === "win32" ? ";" : ":";
            targetEnv.PATH = `${binDir}${separator}${targetEnv.PATH || ""}`;
            prependPath?.(binDir);
          }
          return;
        }
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

  throw new Error(
    `Failed to install Vite+ after ${maxAttempts} attempts across ${urls.length} URL(s): ${failureReason}`,
  );
}
