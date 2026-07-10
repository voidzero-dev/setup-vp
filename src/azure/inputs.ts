import { resolveProjectDirectory } from "../ci/project.js";
import type { RuntimeEnv } from "../ci/types.js";

export interface AzureInputs {
  version: string;
  workingDirectory: string;
  runInstall: string;
  sfw: boolean;
  registryUrl: string;
  scope: string;
  cache: boolean;
  cacheDependencyPath: string;
  workspaceRoot: string;
}

export function parseAzureInputs(env: RuntimeEnv): AzureInputs {
  return {
    version: env.SETUP_VP_VERSION || "latest",
    workingDirectory: env.SETUP_VP_WORKING_DIRECTORY || ".",
    runInstall: env.SETUP_VP_RUN_INSTALL ?? "true",
    sfw: env.SETUP_VP_SFW === "true",
    registryUrl: env.SETUP_VP_REGISTRY_URL || "",
    scope: env.SETUP_VP_SCOPE || "",
    cache: env.SETUP_VP_CACHE === "true",
    cacheDependencyPath: env.SETUP_VP_CACHE_DEPENDENCY_PATH || "",
    workspaceRoot: env.SYSTEM_DEFAULTWORKINGDIRECTORY || process.cwd(),
  };
}

export function resolveProjectDirFromInputs(inputs: AzureInputs): string {
  return resolveProjectDirectory({
    workingDirectory: inputs.workingDirectory,
    workspaceRoot: inputs.workspaceRoot,
  });
}
