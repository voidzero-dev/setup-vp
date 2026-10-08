import { isReservedAuthVariable } from "../ci/auth.js";
import type { RuntimeEnv } from "../ci/types.js";

const AUTH_ENV_PREFIX = "SETUP_VP_AUTH_ENV_";

function isCredentialName(name: string): boolean {
  // These credential names belong to otherwise reserved namespaces.
  if (
    [
      "NODE_AUTH_TOKEN",
      "SYSTEM_ACCESSTOKEN",
      "YARN_NPM_AUTH_TOKEN",
      "YARN_NPM_AUTH_IDENT",
    ].includes(name)
  )
    return true;
  // Accept credential names, rather than trying to enumerate every environment
  // variable that can control a shell, interpreter, or package manager.
  return (
    /(?:^|_)(?:TOKEN|PASSWORD|SECRET|KEY)$/.test(name) &&
    !isReservedAuthVariable(name) &&
    !/^(?:NODE_|BASH|LD_|DYLD_|OPENSSL_|SSL_|NPM_CONFIG_|PNPM_|YARN_|BUN_|COREPACK_|VP_|VITE_|SFW_|SOCKET_|XDG_|DOTNET_|COMPLUS_|COR_|POWERSHELL_|PSMODULE|INPUT_|ENDPOINT_|VSTS_|AZP_|TASK_|PIPELINE_|AZURE_)/.test(
      name,
    )
  );
}

/** Decode auth mappings only after the task's shell and Node.js have started. */
export function applyAuthEnv(env: RuntimeEnv): void {
  const entries = Object.entries(env)
    .filter(([key]) => key.toUpperCase().startsWith(AUTH_ENV_PREFIX))
    .map(([key, value]) => ({ key, name: key.slice(AUTH_ENV_PREFIX.length), value }));
  const names = new Set<string>();

  // Validate every name before exposing any values to subprocesses or later steps.
  for (const { name } of entries) {
    const normalized = name.toUpperCase();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !isCredentialName(normalized)) {
      throw new Error(
        `authEnv variable ${JSON.stringify(name)} is not a supported credential name`,
      );
    }
    if (names.has(normalized)) {
      throw new Error(`authEnv contains duplicate credential name ${JSON.stringify(name)}`);
    }
    names.add(normalized);
  }

  for (const { key, name, value } of entries) {
    delete env[key];
    // Azure leaves missing secret macros unchanged. Do not pass them as tokens.
    if (value === undefined || /^\$\([^)]+\)$/.test(value)) delete env[name];
    else env[name] = value;
  }
}
