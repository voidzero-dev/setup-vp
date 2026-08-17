import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";

// Mock external dependencies before importing the module
vi.mock("@actions/cache", () => ({
  restoreCache: vi.fn(),
}));
vi.mock("@actions/core", () => ({
  warning: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  saveState: vi.fn(),
  setOutput: vi.fn(),
}));
vi.mock("./utils.js", () => ({
  getConfiguredProjectDir: vi.fn(() => "/workspace"),
}));

import { restoreCache as restoreCacheAction } from "@actions/cache";
import { warning, info, saveState, setOutput } from "@actions/core";
import { restoreTaskCache } from "./task-cache-restore.js";
import { State, Outputs } from "./types.js";
import type { Inputs } from "./types.js";

const mockedRestoreCacheAction = vi.mocked(restoreCacheAction);
const mockedWarning = vi.mocked(warning);
const mockedInfo = vi.mocked(info);
const mockedSaveState = vi.mocked(saveState);
const mockedSetOutput = vi.mocked(setOutput);

const baseInputs: Inputs = {
  version: "latest",
  nodeVersion: undefined,
  nodeVersionFile: undefined,
  workingDirectory: undefined,
  runInstall: [],
  sfw: false,
  cache: false,
  cacheDependencyPath: undefined,
  taskCache: true,
  registryUrl: undefined,
  scope: undefined,
};

describe("restoreTaskCache", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("restores task cache with correct key pattern", async () => {
    process.env.RUNNER_OS = "Linux";
    process.env.GITHUB_RUN_ID = "12345";
    process.env.GITHUB_RUN_ATTEMPT = "1";

    mockedRestoreCacheAction.mockResolvedValue("vite-task-Linux-x64-12345-1");

    await restoreTaskCache(baseInputs);

    expect(mockedRestoreCacheAction).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("node_modules")]),
      "vite-task-Linux-x64-12345-1",
      ["vite-task-Linux-x64-"],
    );

    expect(mockedSaveState).toHaveBeenCalledWith(
      State.TaskCachePrimaryKey,
      "vite-task-Linux-x64-12345-1",
    );
    expect(mockedSaveState).toHaveBeenCalledWith(
      State.TaskCacheMatchedKey,
      "vite-task-Linux-x64-12345-1",
    );
    expect(mockedSetOutput).toHaveBeenCalledWith(Outputs.TaskCacheHit, true);
    expect(mockedInfo).toHaveBeenCalledWith(expect.stringContaining("Task cache restored"));
  });

  it("sets cache-hit to false when cache is not found", async () => {
    process.env.RUNNER_OS = "Linux";
    process.env.GITHUB_RUN_ID = "12345";
    process.env.GITHUB_RUN_ATTEMPT = "1";

    mockedRestoreCacheAction.mockResolvedValue(undefined);

    await restoreTaskCache(baseInputs);

    expect(mockedSetOutput).toHaveBeenCalledWith(Outputs.TaskCacheHit, false);
    expect(mockedInfo).toHaveBeenCalledWith("Task cache not found");
  });

  it("warns and skips when GITHUB_RUN_ID is missing", async () => {
    process.env.RUNNER_OS = "Linux";
    process.env.GITHUB_RUN_ATTEMPT = "1";
    delete process.env.GITHUB_RUN_ID;

    await restoreTaskCache(baseInputs);

    expect(mockedWarning).toHaveBeenCalledWith(
      expect.stringContaining("GitHub run ID or attempt not found"),
    );
    expect(mockedSetOutput).toHaveBeenCalledWith(Outputs.TaskCacheHit, false);
    expect(mockedRestoreCacheAction).not.toHaveBeenCalled();
  });

  it("warns and skips when GITHUB_RUN_ATTEMPT is missing", async () => {
    process.env.RUNNER_OS = "Linux";
    process.env.GITHUB_RUN_ID = "12345";
    delete process.env.GITHUB_RUN_ATTEMPT;

    await restoreTaskCache(baseInputs);

    expect(mockedWarning).toHaveBeenCalledWith(
      expect.stringContaining("GitHub run ID or attempt not found"),
    );
    expect(mockedSetOutput).toHaveBeenCalledWith(Outputs.TaskCacheHit, false);
    expect(mockedRestoreCacheAction).not.toHaveBeenCalled();
  });

  it("uses correct cache path relative to project directory", async () => {
    process.env.RUNNER_OS = "Windows";
    process.env.GITHUB_RUN_ID = "67890";
    process.env.GITHUB_RUN_ATTEMPT = "2";

    mockedRestoreCacheAction.mockResolvedValue(undefined);

    await restoreTaskCache(baseInputs);

    const cachePathsCall = mockedSaveState.mock.calls.find(([key]) => key === State.TaskCachePaths);
    expect(cachePathsCall).toBeDefined();
    if (cachePathsCall) {
      const paths = JSON.parse(cachePathsCall[1] as string);
      expect(paths[0]).toMatch(/node_modules/);
      expect(paths[0]).toMatch(/task-cache/);
    }
  });

  it("handles different OS and architecture combinations", async () => {
    process.env.RUNNER_OS = "macOS";
    process.env.GITHUB_RUN_ID = "11111";
    process.env.GITHUB_RUN_ATTEMPT = "3";

    // Mock process.arch
    const originalArch = process.arch;
    Object.defineProperty(process, "arch", {
      value: "arm64",
      configurable: true,
    });

    mockedRestoreCacheAction.mockResolvedValue(undefined);

    await restoreTaskCache(baseInputs);

    expect(mockedSaveState).toHaveBeenCalledWith(
      State.TaskCachePrimaryKey,
      "vite-task-macOS-arm64-11111-3",
    );

    // Restore original arch
    Object.defineProperty(process, "arch", {
      value: originalArch,
      configurable: true,
    });
  });

  it("saves cache paths as JSON string", async () => {
    process.env.RUNNER_OS = "Linux";
    process.env.GITHUB_RUN_ID = "12345";
    process.env.GITHUB_RUN_ATTEMPT = "1";

    mockedRestoreCacheAction.mockResolvedValue(undefined);

    await restoreTaskCache(baseInputs);

    expect(mockedSaveState).toHaveBeenCalledWith(
      State.TaskCachePaths,
      expect.stringMatching(/^\[.*\]$/),
    );

    const cachePathsCall = mockedSaveState.mock.calls.find(([key]) => key === State.TaskCachePaths);
    if (cachePathsCall) {
      const paths = JSON.parse(cachePathsCall[1] as string);
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    }
  });
});
