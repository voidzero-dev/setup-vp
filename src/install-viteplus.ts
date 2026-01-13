import { info, debug, warning, saveState, setOutput, addPath } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Inputs } from './types.js'
import {
  PACKAGE_NAME,
  GITHUB_REGISTRY,
  State,
  Outputs,
} from './types.js'

// .npmrc configuration for GitHub Package Registry
// The actual token is passed via VP_TOKEN environment variable
const GITHUB_REGISTRY_NPMRC = `//npm.pkg.github.com/:_authToken=\${VP_TOKEN}
@voidzero-dev:registry=${GITHUB_REGISTRY}
`

export async function installVitePlus(inputs: Inputs): Promise<void> {
  const { version, registry, githubToken } = inputs

  info(`Installing ${PACKAGE_NAME}@${version} from ${registry} registry...`)

  // Validate GitHub token if using GitHub registry
  if (registry === 'github' && !githubToken) {
    throw new Error(
      'GitHub token is required when using GitHub Package Registry. ' +
        'Please set the github-token input.'
    )
  }

  // Build npm install command arguments
  const packageSpec =
    version === 'latest' ? PACKAGE_NAME : `${PACKAGE_NAME}@${version}`

  const args = ['install', '-g', packageSpec]

  // Set up environment for installation
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  // Configure scoped registry for GitHub Package Registry
  // Write config to .npmrc, pass token via VP_TOKEN environment variable
  if (registry === 'github' && githubToken) {
    debug('Configuring @voidzero-dev scoped registry for GitHub Package Registry')

    // Write .npmrc with ${VP_TOKEN} placeholder
    const npmrcPath = join(homedir(), '.npmrc')
    let existingContent = ''
    if (existsSync(npmrcPath)) {
      existingContent = readFileSync(npmrcPath, 'utf-8')
    }

    // Only add if not already configured
    if (!existingContent.includes('@voidzero-dev:registry')) {
      const newContent = existingContent + (existingContent.endsWith('\n') ? '' : '\n') + GITHUB_REGISTRY_NPMRC
      writeFileSync(npmrcPath, newContent, 'utf-8')
      debug(`Updated ${npmrcPath} with GitHub Package Registry configuration`)
    }

    // Pass the actual token via VP_TOKEN environment variable
    env.VP_TOKEN = githubToken
  }

  debug(`Running: npm ${args.join(' ')}`)

  const exitCode = await exec('npm', args, { env })

  if (exitCode !== 0) {
    throw new Error(
      `Failed to install ${PACKAGE_NAME}. Exit code: ${exitCode}`
    )
  }

  // Verify installation and get version
  const installedVersion = await getInstalledVersion()
  info(`Successfully installed ${PACKAGE_NAME}@${installedVersion}`)

  // Save state for outputs
  saveState(State.InstalledVersion, installedVersion)
  setOutput(Outputs.Version, installedVersion)

  // Ensure global bin is in PATH
  await ensureGlobalBinInPath()
}

async function getInstalledVersion(): Promise<string> {
  try {
    const result = await getExecOutput('vp', ['--version'], {
      silent: true,
    })
    return result.stdout.trim()
  } catch {
    // Fallback: check npm list
    try {
      const result = await getExecOutput(
        'npm',
        ['list', '-g', PACKAGE_NAME, '--depth=0', '--json'],
        { silent: true }
      )
      const data = JSON.parse(result.stdout) as {
        dependencies?: Record<string, { version?: string }>
      }
      return data.dependencies?.[PACKAGE_NAME]?.version || 'unknown'
    } catch {
      return 'unknown'
    }
  }
}

async function ensureGlobalBinInPath(): Promise<void> {
  try {
    const result = await getExecOutput('npm', ['bin', '-g'], {
      silent: true,
    })
    const globalBin = result.stdout.trim()
    if (globalBin && !process.env.PATH?.includes(globalBin)) {
      addPath(globalBin)
      debug(`Added ${globalBin} to PATH`)
    }
  } catch (error) {
    warning(`Could not determine global npm bin path: ${error}`)
  }
}
