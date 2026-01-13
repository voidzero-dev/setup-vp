import { saveState, getState, setFailed } from '@actions/core'
import { getInputs } from './inputs.js'
import { installVitePlus } from './install-viteplus.js'
import { runViteInstall } from './run-install.js'
import { restoreCache } from './cache-restore.js'
import { saveCache } from './cache-save.js'
import { State } from './types.js'
import type { Inputs } from './types.js'

async function runMain(inputs: Inputs): Promise<void> {
  // Mark that post action should run
  saveState(State.IsPost, 'true')

  // Step 1: Install @voidzero-dev/global
  await installVitePlus(inputs)

  // Step 2: Restore cache if enabled
  if (inputs.cache) {
    await restoreCache(inputs)
  }

  // Step 3: Run vite install if requested
  if (inputs.runInstall.length > 0) {
    await runViteInstall(inputs)
  }
}

async function runPost(inputs: Inputs): Promise<void> {
  // Save cache if enabled
  if (inputs.cache) {
    await saveCache()
  }
}

async function main(): Promise<void> {
  const inputs = getInputs()

  if (getState(State.IsPost) === 'true') {
    await runPost(inputs)
  } else {
    await runMain(inputs)
  }
}

main().catch(error => {
  console.error(error)
  setFailed(error instanceof Error ? error.message : String(error))
})
