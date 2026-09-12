import { parseInstalledVpVersion } from "./version.js";

// Tri-state node-manager setting shared by the GitHub, GitLab, and Azure
// runtimes. Unset lets the Vite+ install script auto-detect (it enables the
// Node.js manager on CI); "false" opts out: VP_NODE_MANAGER=no at install
// time skips node/npm/npx shim creation, and `vp env off node` (Vite+ 0.3.1+) afterwards makes vp
// commands prefer the system Node.js; "true" force-enables.
// Accept the YAML 1.2 boolean forms (same set as @actions/core
// getBooleanInput); Azure serializes booleans passed to string parameters as
// "True"/"False".
const TRUE_VALUES = new Set(["true", "True", "TRUE"]);
const FALSE_VALUES = new Set(["false", "False", "FALSE"]);

export function parseNodeManager(input: string | undefined): boolean | undefined {
  if (!input) return undefined;
  if (TRUE_VALUES.has(input)) return true;
  if (FALSE_VALUES.has(input)) return false;
  throw new Error(`Invalid node-manager input: "${input}". Expected "true", "false", or unset.`);
}

// Scoped env modes were introduced in 0.3.1. Probe the installed version so
// dist-tags and project auto-detection use the same compatibility rule.
export function supportsScopedEnv(versionOutput: string): boolean {
  const version = parseInstalledVpVersion(versionOutput);
  if (version.startsWith("0.0.0-commit.")) return true;
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match)
    throw new Error("Could not determine the installed Vite+ version for env configuration.");
  const [, major, minor, patch] = match.map(Number);
  return major > 0 || minor > 3 || (minor === 3 && patch >= 1);
}

export function nodeManagerOffArgs(versionOutput: string): string[] {
  return supportsScopedEnv(versionOutput) ? ["env", "off", "node"] : ["env", "off"];
}
