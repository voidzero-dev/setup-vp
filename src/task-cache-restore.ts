import { restoreCache as restoreCacheAction } from "@actions/cache";
import { warning, info, debug, saveState, setOutput } from "@actions/core";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import type { Inputs } from "./types.js";
import { State, Outputs } from "./types.js";
import { getConfiguredProjectDir } from "./utils.js";

export async function restoreTaskCache(inputs: Inputs): Promise<void> {
  const projectDir = getConfiguredProjectDir(inputs);

  // Task cache path is fixed: node_modules/.vite/task-cache
  const taskCachePath = resolve(projectDir, "node_modules", ".vite", "task-cache");
  const cachePaths = [taskCachePath];

  debug(`Task cache path: ${taskCachePath}`);
  saveState(State.TaskCachePaths, JSON.stringify(cachePaths));

  // Generate cache key: vite-task-{runner.os}-{runner.arch}-{run_id}-{run_attempt}
  const runnerOS = process.env.RUNNER_OS || platform();
  const runnerArch = arch();
  const runId = process.env.GITHUB_RUN_ID;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT;

  if (!runId || !runAttempt) {
    warning(
      `GitHub run ID or attempt not found. Task cache requires GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT. Skipping task cache restore.`,
    );
    setOutput(Outputs.TaskCacheHit, false);
    return;
  }

  const primaryKey = `vite-task-${runnerOS}-${runnerArch}-${runId}-${runAttempt}`;
  const restoreKeys = [`vite-task-${runnerOS}-${runnerArch}-`];

  debug(`Task cache primary key: ${primaryKey}`);
  debug(`Task cache restore keys: ${restoreKeys.join(", ")}`);

  saveState(State.TaskCachePrimaryKey, primaryKey);

  // Attempt to restore cache
  const matchedKey = await restoreCacheAction(cachePaths, primaryKey, restoreKeys);

  if (matchedKey) {
    info(`Task cache restored from key: ${matchedKey}`);
    saveState(State.TaskCacheMatchedKey, matchedKey);
    setOutput(Outputs.TaskCacheHit, true);
  } else {
    info("Task cache not found");
    setOutput(Outputs.TaskCacheHit, false);
  }
}
