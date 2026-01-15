import { z } from "zod";

// Run install configuration schema
export const RunInstallSchema = z.object({
  cwd: z.string().optional(),
  args: z.array(z.string()).optional(),
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
  readonly runInstall: RunInstall[];
  readonly cache: boolean;
  readonly cacheDependencyPath?: string;
}

// Lock file types
export enum LockFileType {
  Npm = "npm",
  Pnpm = "pnpm",
  Yarn = "yarn",
}

export interface LockFileInfo {
  type: LockFileType;
  path: string;
  filename: string;
}

// State keys for main/post communication
export enum State {
  IsPost = "IS_POST",
  CachePrimaryKey = "CACHE_PRIMARY_KEY",
  CacheMatchedKey = "CACHE_MATCHED_KEY",
  CachePaths = "CACHE_PATHS",
  InstalledVersion = "INSTALLED_VERSION",
}

// Output keys
export enum Outputs {
  Version = "version",
  CacheHit = "cache-hit",
}

// Package constants
export const PACKAGE_NAME = "vite-plus-cli";
