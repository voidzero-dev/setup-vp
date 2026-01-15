import { saveState, getState, setFailed, info, setOutput, warning } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { getInputs } from "./inputs.js";
import { installVitePlus } from "./install-viteplus.js";
import { runViteInstall } from "./run-install.js";
import { restoreCache } from "./cache-restore.js";
import { saveCache } from "./cache-save.js";
import { State, Outputs } from "./types.js";
import type { Inputs } from "./types.js";

async function runMain(inputs: Inputs): Promise<void> {
  // Mark that post action should run
  saveState(State.IsPost, "true");

  // Step 1: Install vite-plus-cli
  await installVitePlus(inputs);

  // Step 2: Restore cache if enabled
  if (inputs.cache) {
    await restoreCache(inputs);
  }

  // Step 3: Run vite install if requested
  if (inputs.runInstall.length > 0) {
    await runViteInstall(inputs);
  }

  // Print version info at the end
  await printViteVersion();
}

async function printViteVersion(): Promise<void> {
  try {
    const result = await getExecOutput("vite", ["--version"], { silent: true });
    const versionOutput = result.stdout.trim();
    info(versionOutput);

    // Extract global version for output (e.g., "- Global: v0.0.0" -> "0.0.0")
    const globalMatch = versionOutput.match(/Global:\s*v?([\d.]+[^\s]*)/i);
    const version = globalMatch?.[1] || "unknown";
    saveState(State.InstalledVersion, version);
    setOutput(Outputs.Version, version);
  } catch (error) {
    warning(`Could not get vite version: ${error}`);
    setOutput(Outputs.Version, "unknown");
  }
}

async function runPost(inputs: Inputs): Promise<void> {
  // Save cache if enabled
  if (inputs.cache) {
    await saveCache();
  }
}

async function main(): Promise<void> {
  const inputs = getInputs();

  if (getState(State.IsPost) === "true") {
    await runPost(inputs);
  } else {
    await runMain(inputs);
  }
}

main().catch((error) => {
  console.error(error);
  setFailed(error instanceof Error ? error.message : String(error));
});
