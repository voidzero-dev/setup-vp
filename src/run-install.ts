import * as core from '@actions/core'
import * as exec from '@actions/exec'
import type { Inputs } from './types.js'

export async function runViteInstall(inputs: Inputs): Promise<void> {
  for (const options of inputs.runInstall) {
    const args = ['install']
    if (options.args) {
      args.push(...options.args)
    }

    const cwd = options.cwd || process.env.GITHUB_WORKSPACE || process.cwd()
    const cmdStr = `vite ${args.join(' ')}`

    core.startGroup(`Running ${cmdStr} in ${cwd}...`)

    try {
      const exitCode = await exec.exec('vite', args, {
        cwd,
        ignoreReturnCode: true,
      })

      if (exitCode !== 0) {
        core.setFailed(
          `Command "${cmdStr}" (cwd: ${cwd}) exited with code ${exitCode}`
        )
      } else {
        core.info(`Successfully ran ${cmdStr}`)
      }
    } catch (error) {
      core.setFailed(`Failed to run ${cmdStr}: ${error}`)
    } finally {
      core.endGroup()
    }
  }
}
