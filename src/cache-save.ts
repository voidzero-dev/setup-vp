import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { resolve } from "node:path";
import { findIncompletePnpmInstall } from "./pnpm-install-check.js";
import { LockFileType, State } from "./types.js";

// Before 12.16.0, `pnpm store prune` also removed packages that pnpm copied or cloned
// into node_modules, so the next install downloaded them again.
// https://pnpm.io/blog/releases/12.16.0#store
const MIN_PRUNE_SAFE_PNPM = [12, 16, 0];
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)/;

function isPruneSafePnpm(version: string): boolean {
  const match = VERSION_RE.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let i = 0; i < MIN_PRUNE_SAFE_PNPM.length; i++) {
    if (parts[i] !== MIN_PRUNE_SAFE_PNPM[i]) return parts[i]! > MIN_PRUNE_SAFE_PNPM[i]!;
  }
  return true;
}

// `package.json#packageManager` wins over the lock file, so ask Vite+ which package
// manager its `vp pm` commands run instead of trusting the lock file name.
async function resolvePackageManager(
  cwd: string | undefined,
): Promise<{ name?: unknown; version?: unknown } | undefined> {
  const result = await getExecOutput("vp", ["env", "current", "--json"], {
    cwd,
    silent: true,
    ignoreReturnCode: true,
  });
  if (result.exitCode !== 0) return undefined;
  const current = JSON.parse(result.stdout) as {
    package_manager?: { name?: unknown; version?: unknown };
  } | null;
  return current?.package_manager;
}

// `vp pm cache clean` runs `pnpm store prune`, which removes packages that no project
// on this machine references. It runs only against the store recorded at restore, and
// only after a complete install, because the pruned store is saved under the exact
// lock file key that later jobs restore without saving again.
async function prunePnpmStore(
  cwd: string | undefined,
  lockFilePath: string,
  storePath: string,
): Promise<void> {
  try {
    const incomplete = findIncompletePnpmInstall(lockFilePath, storePath);
    if (incomplete) {
      info(`Skipping pnpm store prune: ${incomplete}.`);
      return;
    }

    const packageManager = await resolvePackageManager(cwd);
    if (packageManager?.name !== "pnpm" || typeof packageManager.version !== "string") {
      info("Skipping pnpm store prune: Vite+ did not resolve pnpm for this project.");
      return;
    }
    if (!isPruneSafePnpm(packageManager.version)) {
      info(
        `Skipping pnpm store prune: pnpm ${packageManager.version} can remove copied or cloned packages that are still in use (fixed in pnpm 12.16.0).`,
      );
      return;
    }

    const storeArgs = ["--", "--store-dir", storePath];
    const resolved = await getExecOutput("vp", ["pm", "cache", "dir", ...storeArgs], {
      cwd,
      silent: true,
      ignoreReturnCode: true,
    });
    const resolvedPath = resolved.stdout.trim();
    if (resolved.exitCode !== 0 || !resolvedPath || resolve(resolvedPath) !== resolve(storePath)) {
      info(
        `Skipping pnpm store prune: the store resolved to "${resolvedPath}", not the restored "${storePath}".`,
      );
      return;
    }

    info("Cache was restored from a previous lock file. Pruning the pnpm store before saving.");
    const exitCode = await exec("vp", ["pm", "cache", "clean", ...storeArgs], {
      cwd,
      ignoreReturnCode: true,
    });
    if (exitCode !== 0) {
      warning(`Failed to prune the pnpm store (exit code ${exitCode}). Saving it unpruned.`);
    }
  } catch (error) {
    warning(`Failed to prune the pnpm store: ${String(error)}. Saving it unpruned.`);
  }
}

export async function saveCache(): Promise<void> {
  const primaryKey = getState(State.CachePrimaryKey);
  const matchedKey = getState(State.CacheMatchedKey);
  const cachePathsJson = getState(State.CachePaths);

  if (!primaryKey) {
    info("No cache key found. Skipping cache save.");
    return;
  }

  if (!cachePathsJson) {
    info("No cache paths found. Skipping cache save.");
    return;
  }

  // Skip if cache hit on primary key (no changes)
  if (primaryKey === matchedKey) {
    info(`Cache hit on primary key "${primaryKey}". Skipping save.`);
    return;
  }

  const cachePaths: string[] = JSON.parse(cachePathsJson) as string[];

  if (!cachePaths.length) {
    info("Empty cache paths. Skipping cache save.");
    return;
  }

  // A restore-key match brings back the store of an older lock file. Without pruning,
  // each lock file change saves that store plus the new packages, so it grows forever.
  const lockFilePath = getState(State.CacheLockFilePath);
  if (
    matchedKey &&
    lockFilePath &&
    cachePaths.length === 1 &&
    getState(State.CacheLockFileType) === LockFileType.Pnpm
  ) {
    await prunePnpmStore(getState(State.CacheCwd) || undefined, lockFilePath, cachePaths[0]!);
  }

  try {
    const cacheId = await saveCacheAction(cachePaths, primaryKey);
    if (cacheId === -1) {
      info("Cache not saved (key already reserved by a concurrent job, or save was skipped).");
      return;
    }
    info(`Cache saved with key: ${primaryKey}`);
  } catch (error) {
    // Don't fail the action if cache save fails
    warning(`Failed to save cache: ${String(error)}`);
  }
}
