import { restoreCache as restoreCacheAction } from '@actions/cache'
import { hashFiles } from '@actions/glob'
import { warning, info, debug, saveState, setOutput } from '@actions/core'
import { arch, platform } from 'node:os'
import type { Inputs } from './types.js'
import { State, Outputs } from './types.js'
import { detectLockFile, getCacheDirectories } from './utils.js'

export async function restoreCache(inputs: Inputs): Promise<void> {
  // Detect lock file
  const lockFile = detectLockFile(inputs.cacheDependencyPath)
  if (!lockFile) {
    warning('No lock file found. Skipping cache restore.')
    setOutput(Outputs.CacheHit, false)
    return
  }

  info(`Using lock file: ${lockFile.path}`)

  // Get cache directories based on lock file type
  const cachePaths = await getCacheDirectories(lockFile.type)
  if (!cachePaths.length) {
    warning('No cache directories found. Skipping cache restore.')
    setOutput(Outputs.CacheHit, false)
    return
  }

  debug(`Cache paths: ${cachePaths.join(', ')}`)
  saveState(State.CachePaths, JSON.stringify(cachePaths))

  // Generate cache key: vite-plus-{platform}-{arch}-{lockfile-type}-{hash}
  const runnerOS = process.env.RUNNER_OS || platform()
  const runnerArch = arch()
  const fileHash = await hashFiles(lockFile.path)

  if (!fileHash) {
    throw new Error(`Failed to generate hash for lock file: ${lockFile.path}`)
  }

  const primaryKey = `vite-plus-${runnerOS}-${runnerArch}-${lockFile.type}-${fileHash}`
  const restoreKeys = [
    `vite-plus-${runnerOS}-${runnerArch}-${lockFile.type}-`,
    `vite-plus-${runnerOS}-${runnerArch}-`,
  ]

  debug(`Primary key: ${primaryKey}`)
  debug(`Restore keys: ${restoreKeys.join(', ')}`)

  saveState(State.CachePrimaryKey, primaryKey)

  // Attempt to restore cache
  const matchedKey = await restoreCacheAction(
    cachePaths,
    primaryKey,
    restoreKeys
  )

  if (matchedKey) {
    info(`Cache restored from key: ${matchedKey}`)
    saveState(State.CacheMatchedKey, matchedKey)
    setOutput(Outputs.CacheHit, true)
  } else {
    info('Cache not found')
    setOutput(Outputs.CacheHit, false)
  }
}
