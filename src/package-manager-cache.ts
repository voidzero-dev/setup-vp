import { restoreCache, saveCache } from "@actions/cache";
import { getState, info, saveState, setOutput, warning } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { lstatSync, realpathSync, rmSync } from "node:fs";
import {
  createPackageManagerCachePlan,
  validatePackageManager,
} from "./ci/package-manager-cache.js";
import type { PackageManagerCachePlan } from "./ci/package-manager-cache.js";
import type { ToolchainCachePlan } from "./ci/toolchain-cache.js";
import { ENV_CURRENT_ARGS } from "./ci/env-current.js";
import { parseVitePlusDirs } from "./ci/vp-dirs.js";
import { Outputs, State } from "./types.js";

export async function restorePackageManagerCache(
  projectDir: string,
  toolchain: ToolchainCachePlan | undefined,
): Promise<void> {
  setOutput(Outputs.PackageManagerCacheHit, false);
  saveState(State.PackageManagerCachePlan, "");
  saveState(State.PackageManagerCacheHit, "");
  if (!toolchain) return;
  let restored: PackageManagerCachePlan | undefined;
  try {
    const [directoryOutput, current] = await Promise.all([
      getExecOutput("vp", [], {
        cwd: projectDir,
        silent: true,
        env: { ...process.env, VP_DUMP_DIRS: "1" },
      }),
      getExecOutput("vp", ENV_CURRENT_ARGS, { cwd: projectDir, silent: true }),
    ]);
    const dirs = parseVitePlusDirs(directoryOutput.stdout);
    if (!dirs || realpathSync(dirs.data) !== realpathSync(toolchain.data)) return;
    const plan = createPackageManagerCachePlan(toolchain, current.stdout, projectDir);
    if (!plan) {
      info(
        "Package manager cache skipped: no exact managed package manager in a supported layout.",
      );
      return;
    }
    saveState(State.PackageManagerCachePlan, JSON.stringify(plan));
    if (lstatSync(plan.path, { throwIfNoEntry: false })) {
      info("Package manager files already exist; skipping cache restore.");
      return;
    }
    restored = plan;
    const key = await restoreCache([plan.path], plan.key, [], {
      timeoutInMs: 30_000,
      segmentTimeoutInMs: 30_000,
    });
    if (key === plan.key && validatePackageManager(plan)) {
      saveState(State.PackageManagerCacheHit, "true");
      setOutput(Outputs.PackageManagerCacheHit, true);
      info(`Package manager cache restored: ${plan.name}@${plan.version}`);
      return;
    }
    rmSync(plan.path, { recursive: true, force: true });
    info(
      `Package manager cache ${key ? "did not pass validation" : "not found"}: ${plan.name}@${plan.version}`,
    );
  } catch (error) {
    if (restored) rmSync(restored.path, { recursive: true, force: true });
    warning(`Package manager cache restore failed; using normal installation: ${String(error)}`);
  }
}

export async function savePackageManagerCache(): Promise<void> {
  if (getState(State.PackageManagerCacheHit) === "true") return;
  const state = getState(State.PackageManagerCachePlan);
  if (!state) return;
  try {
    const plan = JSON.parse(state) as PackageManagerCachePlan;
    if (!validatePackageManager(plan)) {
      info("Package manager cache save skipped: the installation did not pass validation.");
      return;
    }
    const id = await saveCache([plan.path], plan.key);
    info(
      id === -1
        ? "Package manager cache save skipped (another job can own this key)."
        : `Package manager cache saved: ${plan.name}@${plan.version}`,
    );
  } catch (error) {
    warning(`Package manager cache save failed; continuing: ${String(error)}`);
  }
}
