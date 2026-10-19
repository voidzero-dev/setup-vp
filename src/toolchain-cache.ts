import { restoreCache, saveCache } from "@actions/cache";
import { getState, info, saveState, setOutput, warning } from "@actions/core";
import { isWindows } from "./ci/platform.js";
import {
  canRestoreToolchain,
  createToolchainCachePlan,
  discardRestoredToolchain,
  validateToolchain,
} from "./ci/toolchain-cache.js";
import type { ToolchainCachePlan } from "./ci/toolchain-cache.js";
import { recordToolchainLinks, restoreToolchainLinks } from "./ci/toolchain-links.js";
import { Outputs, State } from "./types.js";

export interface ToolchainCacheResult {
  plan: ToolchainCachePlan;
  hit: boolean;
}

export async function restoreToolchainCache(
  options: Parameters<typeof createToolchainCachePlan>[0],
): Promise<ToolchainCacheResult | undefined> {
  setOutput(Outputs.ToolchainCacheHit, false);
  saveState(State.ToolchainCachePlan, "");
  saveState(State.ToolchainCacheHit, "");
  let restorePlan: ToolchainCachePlan | undefined;
  let plan: ToolchainCachePlan | undefined;
  try {
    plan = createToolchainCachePlan(options);
    if (!plan) {
      info(
        "Toolchain cache skipped: use an exact Vite+ version and an exact managed Node.js version without local installer overrides.",
      );
      return;
    }
    saveState(State.ToolchainCachePlan, JSON.stringify(plan));
    if (!canRestoreToolchain(plan)) {
      info("Toolchain files already exist; skipping cache restore.");
      return { plan, hit: false };
    }
    restorePlan = plan;
    const matchedKey = await restoreCache(plan.paths, plan.key, [], {
      timeoutInMs: 30_000,
      segmentTimeoutInMs: 30_000,
    });
    if (matchedKey === plan.key && isWindows()) restoreToolchainLinks(plan.payload);
    if (matchedKey === plan.key && validateToolchain(plan)) {
      saveState(State.ToolchainCacheHit, "true");
      setOutput(Outputs.ToolchainCacheHit, true);
      info(`Toolchain cache restored: ${plan.key}`);
      return { plan, hit: true };
    }
    discardRestoredToolchain(plan);
    info(
      matchedKey
        ? "Toolchain cache did not pass validation; using the installer."
        : `Toolchain cache not found: ${plan.key}`,
    );
  } catch (error) {
    if (restorePlan) discardRestoredToolchain(restorePlan);
    warning(`Toolchain cache restore failed; using the installer: ${String(error)}`);
  }
  return plan ? { plan, hit: false } : undefined;
}

export async function saveToolchainCache(): Promise<void> {
  if (getState(State.ToolchainCacheHit) === "true") return;
  const state = getState(State.ToolchainCachePlan);
  if (!state) return;
  try {
    const plan = JSON.parse(state) as ToolchainCachePlan;
    if (!validateToolchain(plan)) {
      info("Toolchain cache save skipped: the installation did not pass validation.");
      return;
    }
    const cleanup = isWindows() ? recordToolchainLinks(plan.payload) : undefined;
    let id: number;
    try {
      id = await saveCache(plan.paths, plan.key);
    } finally {
      cleanup?.();
    }
    info(
      id === -1
        ? "Toolchain cache save skipped (another job can own this key)."
        : `Toolchain cache saved: ${plan.key}`,
    );
  } catch (error) {
    warning(`Toolchain cache save failed: ${String(error)}`);
  }
}
