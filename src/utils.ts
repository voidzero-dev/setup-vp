import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { LockFileType } from './types.js'
import type { LockFileInfo } from './types.js'

// Lock file patterns in priority order
const LOCK_FILES: Array<{ filename: string; type: LockFileType }> = [
  { filename: 'pnpm-lock.yaml', type: LockFileType.Pnpm },
  { filename: 'package-lock.json', type: LockFileType.Npm },
  { filename: 'npm-shrinkwrap.json', type: LockFileType.Npm },
  { filename: 'yarn.lock', type: LockFileType.Yarn },
  { filename: 'bun.lockb', type: LockFileType.Bun },
]

/**
 * Detect lock file in the workspace
 */
export function detectLockFile(explicitPath?: string): LockFileInfo | undefined {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd()

  // If explicit path provided, use it
  if (explicitPath) {
    const fullPath = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.join(workspace, explicitPath)

    if (fs.existsSync(fullPath)) {
      const filename = path.basename(fullPath)
      const lockInfo = LOCK_FILES.find(l => l.filename === filename)
      if (lockInfo) {
        return {
          type: lockInfo.type,
          path: fullPath,
          filename,
        }
      }
      // Unknown lock file type - try to infer from name
      return inferLockFileType(fullPath, filename)
    }
    return undefined
  }

  // Auto-detect: search for lock files in workspace root
  const workspaceContents = fs.readdirSync(workspace)

  for (const lockInfo of LOCK_FILES) {
    if (workspaceContents.includes(lockInfo.filename)) {
      const fullPath = path.join(workspace, lockInfo.filename)
      core.info(`Auto-detected lock file: ${lockInfo.filename}`)
      return {
        type: lockInfo.type,
        path: fullPath,
        filename: lockInfo.filename,
      }
    }
  }

  return undefined
}

function inferLockFileType(fullPath: string, filename: string): LockFileInfo {
  // Infer type from filename patterns
  if (filename.includes('pnpm')) {
    return { type: LockFileType.Pnpm, path: fullPath, filename }
  }
  if (filename.includes('yarn')) {
    return { type: LockFileType.Yarn, path: fullPath, filename }
  }
  if (filename.includes('bun')) {
    return { type: LockFileType.Bun, path: fullPath, filename }
  }
  // Default to npm
  return { type: LockFileType.Npm, path: fullPath, filename }
}

/**
 * Get cache directories based on package manager type
 */
export async function getCacheDirectories(
  lockType: LockFileType
): Promise<string[]> {
  switch (lockType) {
    case LockFileType.Npm:
      return getNpmCacheDir()
    case LockFileType.Pnpm:
      return getPnpmStoreDir()
    case LockFileType.Yarn:
      return getYarnCacheDir()
    case LockFileType.Bun:
      return getBunCacheDir()
    default:
      return []
  }
}

async function getCommandOutput(
  command: string,
  args: string[]
): Promise<string | undefined> {
  try {
    const result = await exec.getExecOutput(command, args, {
      silent: true,
      ignoreReturnCode: true,
    })
    if (result.exitCode === 0) {
      return result.stdout.trim()
    }
    return undefined
  } catch {
    return undefined
  }
}

async function getNpmCacheDir(): Promise<string[]> {
  const cacheDir = await getCommandOutput('npm', ['config', 'get', 'cache'])
  return cacheDir ? [cacheDir] : []
}

async function getPnpmStoreDir(): Promise<string[]> {
  const storeDir = await getCommandOutput('pnpm', ['store', 'path', '--silent'])
  return storeDir ? [storeDir] : []
}

async function getYarnCacheDir(): Promise<string[]> {
  // Check yarn version first
  const version = await getCommandOutput('yarn', ['--version'])
  if (!version) return []

  const isYarn1 = version.startsWith('1.')
  const cacheDir = isYarn1
    ? await getCommandOutput('yarn', ['cache', 'dir'])
    : await getCommandOutput('yarn', ['config', 'get', 'cacheFolder'])

  return cacheDir && cacheDir !== 'undefined' ? [cacheDir] : []
}

async function getBunCacheDir(): Promise<string[]> {
  const cacheDir = await getCommandOutput('bun', ['pm', 'cache'])
  if (cacheDir) return [cacheDir]

  // Fallback to default location
  const home = os.homedir()
  const defaultCache = path.join(home, '.bun', 'install', 'cache')
  return fs.existsSync(defaultCache) ? [defaultCache] : []
}
