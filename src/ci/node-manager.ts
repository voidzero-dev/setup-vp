// Tri-state node-manager setting shared by the GitHub, GitLab, and Azure
// runtimes. Unset lets the Vite+ install script auto-detect (it enables the
// Node.js manager on CI); "false" opts out: VP_NODE_MANAGER=no at install
// time skips node/npm/npx shim creation, and `vp env off` afterwards makes vp
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
