import { configureAuth as configureAuthCore } from "../ci/auth.js";
import { exportShellEnv } from "./shell.js";
import type { RuntimeEnv } from "./types.js";

export function configureAuth(
  registryUrlInput: string,
  scopeInput: string,
  targetEnv: RuntimeEnv = process.env,
): string | undefined {
  const exportVariable =
    targetEnv === process.env
      ? (name: string, value: string | undefined) => exportShellEnv(name, value, targetEnv)
      : undefined;

  return configureAuthCore(registryUrlInput, scopeInput, targetEnv, exportVariable);
}
