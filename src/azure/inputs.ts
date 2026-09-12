import { parsePackageManager } from "../ci/package-manager.js";
import type { PackageManagerConfig } from "../ci/package-manager.js";
import { parseNodeManager } from "../ci/node-manager.js";
import { resolveProjectDirectory } from "../ci/project.js";
import type { RuntimeEnv } from "../ci/types.js";

export interface AzureInputs {
  version: string;
  versionFile?: string;
  nodeVersion?: string;
  nodeVersionFile?: string;
  workingDirectory: string;
  runInstall: string;
  sfw: boolean;
  nodeManager: boolean | undefined;
  packageManager: PackageManagerConfig | undefined;
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
    version: env.SETUP_VP_VERSION || "",
    versionFile: env.SETUP_VP_VERSION_FILE || undefined,
    nodeVersion: env.SETUP_VP_NODE_VERSION || undefined,
    nodeVersionFile: env.SETUP_VP_NODE_VERSION_FILE || undefined,
    workingDirectory: env.SETUP_VP_WORKING_DIRECTORY || ".",
    runInstall: env.SETUP_VP_RUN_INSTALL ?? "true",
    sfw: parseBoolean(env.SETUP_VP_SFW),
    nodeManager: parseNodeManager(env.SETUP_VP_NODE_MANAGER),
    packageManager: parsePackageManager(env.SETUP_VP_PACKAGE_MANAGER),
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
