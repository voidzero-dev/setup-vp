import { saveState, getState, setFailed, info, setOutput, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { getInputs } from "./inputs.js";
import { installVitePlus } from "./install-viteplus.js";
import { installSfw, isMuslLinux, isSfwSupported } from "./install-sfw.js";
import { runViteInstall } from "./run-install.js";
import { restoreCache } from "./cache-restore.js";
import { saveCache } from "./cache-save.js";
import { State, Outputs } from "./types.js";
import type { Inputs } from "./types.js";
import { resolveNodeVersionFile } from "./node-version-file.js";
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

  // Step 2: Install Vite+
  await installVitePlus(inputs);

  // Step 3: Set up Node.js version if specified
  if (nodeVersion) {
    info(`Setting up Node.js ${nodeVersion} via vp env use...`);
    await exec("vp", ["env", "use", nodeVersion]);
  }

  // Step 4: Configure registry authentication
  if (inputs.registryUrl) {
    configAuthentication(inputs.registryUrl, inputs.scope);
  } else {
    propagateProjectNpmrcAuth(projectDir);
  }

  // Step 5: Restore cache if enabled
  if (inputs.cache) {
    await restoreCache(inputs);
  }

  // Step 6: Install Socket Firewall Free if requested (must run before vp install).
  // sfw is currently only supported on Linux on architectures with a published
  // sfw asset (see isSfwSupported); other combinations fall back to plain
  // `vp install`. Whenever `sfw: true` is set but sfw won't actually be
  // invoked, emit a clear log message so the no-op is visible.
  let effectiveSfw = inputs.sfw;
  if (inputs.sfw) {
    const env = `process.platform=${process.platform}, process.arch=${process.arch}, musl=${isMuslLinux()}`;
    const supported = isSfwSupported();
    const needsInstall = inputs.runInstall.length > 0;
    if (!supported && needsInstall) {
      warning(
        `sfw is temporarily not supported on this runner (${env}); falling back to plain \`vp install\`. Track upstream: https://github.com/voidzero-dev/setup-vp/issues/73`,
      );
      effectiveSfw = false;
    } else if (!supported && !needsInstall) {
      info(
        `sfw was requested but is not supported on this runner (${env}); no sfw binary will be downloaded. Track upstream: https://github.com/voidzero-dev/setup-vp/issues/73`,
      );
      effectiveSfw = false;
    } else if (supported && !needsInstall) {
      info("sfw was requested but `run-install` is disabled; no sfw binary will be downloaded.");
    }
  }
  if (effectiveSfw && inputs.runInstall.length > 0) {
    await installSfw();
  }

  // Step 7: Run vp install if requested
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
