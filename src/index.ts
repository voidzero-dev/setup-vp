import { saveState, getState, setFailed, info, setOutput, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { getInputs } from "./inputs.js";
import { installVitePlus } from "./install-viteplus.js";
import { setupSfw } from "./install-sfw.js";
import { runViteInstall } from "./run-install.js";
import { restoreCache } from "./cache-restore.js";
import { saveCache } from "./cache-save.js";
import { State, Outputs } from "./types.js";
import type { Inputs } from "./types.js";
import { resolveNodeVersionFile } from "./node-version-file.js";
import {
  resolveVitePlusVersionFile,
  tryResolveVitePlusVersionFromProject,
} from "./version-file.js";
import { configAuthentication, propagateProjectNpmrcAuth } from "./auth.js";
import { getConfiguredProjectDir } from "./utils.js";

async function runMain(inputs: Inputs): Promise<void> {
  // Mark that post action should run
  saveState(State.IsPost, "true");
  const projectDir = getConfiguredProjectDir(inputs);

  // Step 1: Resolve Node.js version (needed for cache key)
  let nodeVersion = inputs.nodeVersion;
  if (!nodeVersion && inputs.nodeVersionFile) {
    nodeVersion = resolveNodeVersionFile(inputs.nodeVersionFile, projectDir);
  }

  // Step 2: Resolve the Vite+ version. Precedence:
  //   1. explicit `version`
  //   2. explicit `version-file` (package.json / catalog), hard error if unresolvable
  //   3. auto-detect from the project's package.json (best effort)
  //   4. "latest"
  let version: string | undefined = inputs.version;
  if (!version && inputs.versionFile) {
    version = resolveVitePlusVersionFile(inputs.versionFile, projectDir);
  }
  if (!version && !inputs.versionFile) {
    version = tryResolveVitePlusVersionFromProject(projectDir);
  }
  if (!version) {
    version = "latest";
  }

  // Step 3: Install Vite+
  await installVitePlus({ ...inputs, version });

  // Step 4: Set up Node.js version if specified
  if (nodeVersion) {
    info(`Setting up Node.js ${nodeVersion} via vp env use...`);
    await exec("vp", ["env", "use", nodeVersion]);
  }

  // Step 5: Configure registry authentication
  if (inputs.registryUrl) {
    configAuthentication(inputs.registryUrl, inputs.scope);
  } else {
    propagateProjectNpmrcAuth(projectDir);
  }

  // Step 6: Restore cache if enabled
  if (inputs.cache) {
    await restoreCache(inputs);
  }

  // Step 7: Install Socket Firewall Free if requested (must run before vp install).
  // setupSfw centralizes all the decision branches: run-install disabled, sfw
  // already on PATH (e.g. via socketdev/action@<sha>), supported platform
  // (downloads our pinned binary), unsupported platform (falls back).
  const effectiveSfw = await setupSfw(inputs);

  // Step 8: Run vp install if requested
  if (inputs.runInstall.length > 0) {
    await runViteInstall({ ...inputs, sfw: effectiveSfw });
  }

  // Print version info at the end
  await printViteVersion(projectDir);
}

async function printViteVersion(cwd: string): Promise<void> {
  try {
    const result = await getExecOutput("vp", ["--version"], { cwd, silent: true });
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
