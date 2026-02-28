import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { State } from "./types.js";

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

  try {
    const cacheId = await saveCacheAction(cachePaths, primaryKey);
    if (cacheId === -1) {
      warning("Cache save failed or was skipped.");
      return;
    }
    info(`Cache saved with key: ${primaryKey}`);
  } catch (error) {
    // Don't fail the action if cache save fails
    warning(`Failed to save cache: ${String(error)}`);
  }
}
