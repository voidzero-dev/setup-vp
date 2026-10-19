import type { PackageManagerConfig } from "./ci/package-manager.js";
import { z } from "zod/mini";

// Run install configuration schema
export const RunInstallSchema = z.object({
  cwd: z.optional(z.string()),
  args: z.optional(z.array(z.string())),
});

export const RunInstallInputSchema = z.union([
  z.null(),
  z.boolean(),
  RunInstallSchema,
  z.array(RunInstallSchema),
]);

export type RunInstallInput = z.infer<typeof RunInstallInputSchema>;
export type RunInstall = z.infer<typeof RunInstallSchema>;

// Main inputs interface
export interface Inputs {
  readonly version: string;
  readonly versionFile?: string;
  readonly nodeVersion?: string;
  readonly nodeVersionFile?: string;
  readonly nodeManager?: boolean;
  readonly packageManager?: PackageManagerConfig;
  readonly workingDirectory?: string;
  readonly runInstall: RunInstall[];
  readonly sfw: boolean;
  readonly cache: boolean;
  readonly cacheToolchain?: boolean;
  readonly cacheSave: boolean;
  readonly cacheDependencyPath?: string;
  readonly registryUrl?: string;
  readonly scope?: string;
}

export { LockFileType } from "./ci/types.js";
export type { LockFileInfo } from "./ci/types.js";

// State keys for main/post communication
export enum State {
  IsPost = "IS_POST",
  CachePrimaryKey = "CACHE_PRIMARY_KEY",
  CacheMatchedKey = "CACHE_MATCHED_KEY",
  CachePaths = "CACHE_PATHS",
  InstalledVersion = "INSTALLED_VERSION",
  ToolchainCachePlan = "TOOLCHAIN_CACHE_PLAN",
  ToolchainCacheHit = "TOOLCHAIN_CACHE_HIT",
  PackageManagerCachePlan = "PACKAGE_MANAGER_CACHE_PLAN",
  PackageManagerCacheHit = "PACKAGE_MANAGER_CACHE_HIT",
}

// Output keys
export enum Outputs {
  Version = "version",
  CacheHit = "cache-hit",
  ToolchainCacheHit = "toolchain-cache-hit",
  PackageManagerCacheHit = "package-manager-cache-hit",
  NodeVersion = "node-version",
  PackageManager = "package-manager",
  PackageManagerVersion = "package-manager-version",
}

// Package constants
export const DISPLAY_NAME = "Vite+";
// The published package name on the npm registry.
export const PACKAGE_NAME = "vite-plus";
