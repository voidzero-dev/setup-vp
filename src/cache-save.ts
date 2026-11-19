import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { exec } from "@actions/exec";
import { LockFileType, State } from "./types.js";

// `vp pm cache clean` runs `pnpm store prune`, which removes packages that no project
// on this machine references.
async function prunePnpmStore(cwd: string | undefined): Promise<void> {
  info("Cache was restored from a previous lock file. Pruning the pnpm store before saving.");
  try {
    const exitCode = await exec("vp", ["pm", "cache", "clean"], { cwd, ignoreReturnCode: true });
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
  if (matchedKey && getState(State.CacheLockFileType) === LockFileType.Pnpm) {
    await prunePnpmStore(getState(State.CacheCwd) || undefined);
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
