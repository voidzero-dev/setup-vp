import { parseNodeManager } from "../ci/node-manager.js";
import { resolveProjectDirectory } from "../ci/project.js";
import type { RuntimeEnv } from "../ci/types.js";

export interface AzureInputs {
  version: string;
  workingDirectory: string;
  runInstall: string;
  sfw: boolean;
  nodeManager: boolean | undefined;
  registryUrl: string;
  scope: string;
  cache: boolean;
  cacheDependencyPath: string;
  workspaceRoot: string;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

export function parseAzureInputs(env: RuntimeEnv): AzureInputs {
  return {
    version: env.SETUP_VP_VERSION || "latest",
    workingDirectory: env.SETUP_VP_WORKING_DIRECTORY || ".",
    runInstall: env.SETUP_VP_RUN_INSTALL ?? "true",
    sfw: parseBoolean(env.SETUP_VP_SFW),
    nodeManager: parseNodeManager(env.SETUP_VP_NODE_MANAGER),
    registryUrl: env.SETUP_VP_REGISTRY_URL || "",
    scope: env.SETUP_VP_SCOPE || "",
    cache: parseBoolean(env.SETUP_VP_CACHE),
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
