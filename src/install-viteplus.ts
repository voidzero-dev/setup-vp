import * as core from '@actions/core'
import * as exec from '@actions/exec'
import type { Inputs } from './types.js'
import {
  PACKAGE_NAME,
  NPM_REGISTRY,
  GITHUB_REGISTRY,
  State,
  Outputs,
} from './types.js'

export async function installVitePlus(inputs: Inputs): Promise<void> {
  const { version, registry, githubToken } = inputs

  core.info(`Installing ${PACKAGE_NAME}@${version} from ${registry} registry...`)

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

  const registryUrl = registry === 'github' ? GITHUB_REGISTRY : NPM_REGISTRY

  // Run npm install -g
  const args = ['install', '-g', packageSpec, `--registry=${registryUrl}`]

  core.debug(`Running: npm ${args.join(' ')}`)

  // Set up environment for installation
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }

  // Configure registry auth for GitHub
  if (registry === 'github' && githubToken) {
    env.NODE_AUTH_TOKEN = githubToken
  }

  const exitCode = await exec.exec('npm', args, {
    env,
    silent: false,
  })

  if (exitCode !== 0) {
    throw new Error(
      `Failed to install ${PACKAGE_NAME}. Exit code: ${exitCode}`
    )
  }

  // Verify installation and get version
  const installedVersion = await getInstalledVersion()
  core.info(`Successfully installed ${PACKAGE_NAME}@${installedVersion}`)

  // Save state for outputs
  core.saveState(State.InstalledVersion, installedVersion)
  core.setOutput(Outputs.Version, installedVersion)

  // Ensure global bin is in PATH
  await ensureGlobalBinInPath()
}

async function getInstalledVersion(): Promise<string> {
  try {
    const result = await exec.getExecOutput('vp', ['--version'], {
      silent: true,
    })
    return result.stdout.trim()
  } catch {
    // Fallback: check npm list
    try {
      const result = await exec.getExecOutput(
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
    const result = await exec.getExecOutput('npm', ['bin', '-g'], {
      silent: true,
    })
    const globalBin = result.stdout.trim()
    if (globalBin && !process.env.PATH?.includes(globalBin)) {
      core.addPath(globalBin)
      core.debug(`Added ${globalBin} to PATH`)
    }
  } catch (error) {
    core.warning(`Could not determine global npm bin path: ${error}`)
  }
}
