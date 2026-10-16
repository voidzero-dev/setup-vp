import { supportsScopedEnv } from "./node-manager.js";
import type { LogFn } from "./types.js";

const PLAIN_VALUE_RE = /^[\w.+-]+$/;

export const ENV_CURRENT_ARGS = ["env", "current", "--json"];

export interface CurrentEnv {
  nodeVersion: string;
  packageManager: string;
  packageManagerVersion: string;
}

interface CurrentEnvJson {
  node?: { version?: unknown };
  package_manager?: { name?: unknown; version?: unknown };
}

/**
 * Read the Node.js and package-manager versions Vite+ resolved from
 * `vp env current --json`. Values that cannot be read are "unknown".
 */
export async function readEnvCurrent(
  versionOutput: string,
  runEnvCurrent: () => string | undefined | Promise<string | undefined>,
  logWarning: LogFn,
): Promise<CurrentEnv> {
  let current: CurrentEnvJson | null = null;
  if (supportsEnvCurrent(versionOutput)) {
    try {
      const output = await runEnvCurrent();
      if (output === undefined) throw new Error("vp env current --json failed");
      current = JSON.parse(output) as CurrentEnvJson | null;
    } catch (error) {
      logWarning(`Could not read the Node.js and package manager versions: ${String(error)}`);
    }
  }
  return {
    nodeVersion: plainValue(current?.node?.version),
    packageManager: plainValue(current?.package_manager?.name),
    packageManagerVersion: plainValue(current?.package_manager?.version),
  };
}

// Before 0.3.1, `vp env current --json` kept the Node.js version at the top level
// and ignored `vp env off`, so it could report a managed version that is not in use.
function supportsEnvCurrent(versionOutput: string): boolean {
  try {
    return supportsScopedEnv(versionOutput);
  } catch {
    return false;
  }
}

// Values are written to a GitLab dotenv report, so accept only plain names and versions.
function plainValue(value: unknown): string {
  return typeof value === "string" && PLAIN_VALUE_RE.test(value) ? value : "unknown";
}
