import { saveState, getState, setFailed, info, setOutput, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
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

  // Step 1: Install Vite+
  await installVitePlus(inputs);

  // Step 2: Set up Node.js version if specified
  if (inputs.nodeVersion) {
    info(`Setting up Node.js ${inputs.nodeVersion} via vp env use...`);
    await exec("vp", ["env", "use", inputs.nodeVersion]);
  }

  // Step 3: Restore cache if enabled
  if (inputs.cache) {
    await restoreCache(inputs);
  }

  // Step 4: Run vp install if requested
  if (inputs.runInstall.length > 0) {
    await runViteInstall(inputs);
  }

  // Print version info at the end
  await printViteVersion();
}

async function printViteVersion(): Promise<void> {
  try {
    const result = await getExecOutput("vp", ["--version"], { silent: true });
    const versionOutput = result.stdout.trim();
    info(versionOutput);

    // Extract global version for output (e.g., "- Global: v0.0.0" -> "0.0.0")
    const globalMatch = versionOutput.match(/Global:\s*v?([\d.]+[^\s]*)/i);
    const version = globalMatch?.[1] || "unknown";
    saveState(State.InstalledVersion, version);
    setOutput(Outputs.Version, version);
  } catch (error) {
    warning(`Could not get vp version: ${String(error)}`);
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
