import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { State } from "./types.js";

export async function saveTaskCache(): Promise<void> {
  const primaryKey = getState(State.TaskCachePrimaryKey);
  const matchedKey = getState(State.TaskCacheMatchedKey);
  const cachePathsJson = getState(State.TaskCachePaths);

  if (!primaryKey) {
    info("No task cache key found. Skipping task cache save.");
    return;
  }

  if (!cachePathsJson) {
    info("No task cache paths found. Skipping task cache save.");
    return;
  }

  // Skip if cache hit on primary key (no changes)
  if (primaryKey === matchedKey) {
    info(`Task cache hit on primary key "${primaryKey}". Skipping save.`);
    return;
  }

  const cachePaths: string[] = JSON.parse(cachePathsJson) as string[];

  if (!cachePaths.length) {
    info("Empty task cache paths. Skipping task cache save.");
    return;
  }

  try {
    const cacheId = await saveCacheAction(cachePaths, primaryKey);
    if (cacheId === -1) {
      info("Task cache not saved (key already reserved by a concurrent job, or save was skipped).");
      return;
    }
    info(`Task cache saved with key: ${primaryKey}`);
  } catch (error) {
    // Don't fail the action if cache save fails
    warning(`Failed to save task cache: ${String(error)}`);
  }
}
