import * as cache from '@actions/cache'
import * as core from '@actions/core'
import { State } from './types.js'

export async function saveCache(): Promise<void> {
  const primaryKey = core.getState(State.CachePrimaryKey)
  const matchedKey = core.getState(State.CacheMatchedKey)
  const cachePathsJson = core.getState(State.CachePaths)

  if (!primaryKey) {
    core.info('No cache key found. Skipping cache save.')
    return
  }

  if (!cachePathsJson) {
    core.info('No cache paths found. Skipping cache save.')
    return
  }

  // Skip if cache hit on primary key (no changes)
  if (primaryKey === matchedKey) {
    core.info(`Cache hit on primary key "${primaryKey}". Skipping save.`)
    return
  }

  const cachePaths: string[] = JSON.parse(cachePathsJson) as string[]

  if (!cachePaths.length) {
    core.info('Empty cache paths. Skipping cache save.')
    return
  }

  try {
    const cacheId = await cache.saveCache(cachePaths, primaryKey)
    if (cacheId === -1) {
      core.warning('Cache save failed or was skipped.')
      return
    }
    core.info(`Cache saved with key: ${primaryKey}`)
  } catch (error) {
    // Don't fail the action if cache save fails
    core.warning(`Failed to save cache: ${error}`)
  }
}
