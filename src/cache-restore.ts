import * as cache from '@actions/cache'
import * as glob from '@actions/glob'
import * as core from '@actions/core'
import * as os from 'node:os'
import type { Inputs } from './types.js'
import { State, Outputs } from './types.js'
import { detectLockFile, getCacheDirectories } from './utils.js'

export async function restoreCache(inputs: Inputs): Promise<void> {
  // Detect lock file
  const lockFile = detectLockFile(inputs.cacheDependencyPath)
  if (!lockFile) {
    core.warning('No lock file found. Skipping cache restore.')
    core.setOutput(Outputs.CacheHit, false)
    return
  }

  core.info(`Using lock file: ${lockFile.path}`)

  // Get cache directories based on lock file type
  const cachePaths = await getCacheDirectories(lockFile.type)
  if (!cachePaths.length) {
    core.warning('No cache directories found. Skipping cache restore.')
    core.setOutput(Outputs.CacheHit, false)
    return
  }

  core.debug(`Cache paths: ${cachePaths.join(', ')}`)
  core.saveState(State.CachePaths, JSON.stringify(cachePaths))

  // Generate cache key: vite-plus-{platform}-{arch}-{lockfile-type}-{hash}
  const platform = process.env.RUNNER_OS || os.platform()
  const arch = os.arch()
  const fileHash = await glob.hashFiles(lockFile.path)

  if (!fileHash) {
    throw new Error(`Failed to generate hash for lock file: ${lockFile.path}`)
  }

  const primaryKey = `vite-plus-${platform}-${arch}-${lockFile.type}-${fileHash}`
  const restoreKeys = [
    `vite-plus-${platform}-${arch}-${lockFile.type}-`,
    `vite-plus-${platform}-${arch}-`,
  ]

  core.debug(`Primary key: ${primaryKey}`)
  core.debug(`Restore keys: ${restoreKeys.join(', ')}`)

  core.saveState(State.CachePrimaryKey, primaryKey)

  // Attempt to restore cache
  const matchedKey = await cache.restoreCache(
    cachePaths,
    primaryKey,
    restoreKeys
  )

  if (matchedKey) {
    core.info(`Cache restored from key: ${matchedKey}`)
    core.saveState(State.CacheMatchedKey, matchedKey)
    core.setOutput(Outputs.CacheHit, true)
  } else {
    core.info('Cache not found')
    core.setOutput(Outputs.CacheHit, false)
  }
}
