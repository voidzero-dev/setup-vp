import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Mock external dependencies before importing the module
vi.mock("@actions/cache", () => ({
  saveCache: vi.fn(),
}));
vi.mock("@actions/core", () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { saveTaskCache } from "./task-cache-save.js";
import { State } from "./types.js";

const mockedSaveCacheAction = vi.mocked(saveCacheAction);
const mockedGetState = vi.mocked(getState);
const mockedInfo = vi.mocked(info);
const mockedWarning = vi.mocked(warning);

// Helper to stub state for save operations
function stubSaveState(
  options: {
    primaryKey?: string;
    matchedKey?: string;
    cachePaths?: string[];
  } = {},
): void {
  const {
    primaryKey = "vite-task-Linux-x64-12345-1",
    matchedKey = "",
    cachePaths = ["/workspace/node_modules/.vite/task-cache"],
  } = options;

  mockedGetState.mockImplementation((name: string) => {
    switch (name) {
      case State.TaskCachePrimaryKey:
        return primaryKey;
      case State.TaskCacheMatchedKey:
        return matchedKey;
      case State.TaskCachePaths:
        return cachePaths.length ? JSON.stringify(cachePaths) : "";
      default:
        return "";
    }
  });
}

describe("saveTaskCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves task cache successfully", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockResolvedValue(42);

    await saveTaskCache();

    expect(mockedSaveCacheAction).toHaveBeenCalledWith(
      ["/workspace/node_modules/.vite/task-cache"],
      "vite-task-Linux-x64-12345-1",
    );
    expect(mockedInfo).toHaveBeenCalledWith(
      expect.stringContaining("Task cache saved with key: vite-task-Linux-x64-12345-1"),
    );
    expect(mockedWarning).not.toHaveBeenCalled();
  });

  it("skips save when no primary key is found", async () => {
    stubSaveState({ primaryKey: "" });

    await saveTaskCache();

    expect(mockedSaveCacheAction).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith("No task cache key found. Skipping task cache save.");
  });

  it("skips save when no cache paths are found", async () => {
    stubSaveState({ cachePaths: [] });
    mockedGetState.mockImplementation((name: string) => {
      if (name === State.TaskCachePrimaryKey) return "vite-task-Linux-x64-12345-1";
      if (name === State.TaskCacheMatchedKey) return "";
      if (name === State.TaskCachePaths) return "";
      return "";
    });

    await saveTaskCache();

    expect(mockedSaveCacheAction).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith("No task cache paths found. Skipping task cache save.");
  });

  it("skips save when cache paths array is empty", async () => {
    stubSaveState({ cachePaths: [] });
    mockedGetState.mockImplementation((name: string) => {
      if (name === State.TaskCachePrimaryKey) return "vite-task-Linux-x64-12345-1";
      if (name === State.TaskCacheMatchedKey) return "";
      if (name === State.TaskCachePaths) return "[]";
      return "";
    });

    await saveTaskCache();

    expect(mockedSaveCacheAction).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith("Empty task cache paths. Skipping task cache save.");
  });

  it("skips save when primary key matches (cache hit)", async () => {
    stubSaveState({
      primaryKey: "vite-task-Linux-x64-12345-1",
      matchedKey: "vite-task-Linux-x64-12345-1",
    });

    await saveTaskCache();

    expect(mockedSaveCacheAction).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith(
      expect.stringContaining('Task cache hit on primary key "vite-task-Linux-x64-12345-1"'),
    );
  });

  it("does not warn when cache key is already reserved (cacheId === -1)", async () => {
    // This happens in build matrix when multiple jobs try to save the same cache key
    stubSaveState();
    mockedSaveCacheAction.mockResolvedValue(-1);

    await saveTaskCache();

    expect(mockedWarning).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith(
      "Task cache not saved (key already reserved by a concurrent job, or save was skipped).",
    );
  });

  it("warns when saveCache throws an error but does not fail", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockRejectedValue(new Error("Network error"));

    // Should not throw
    await expect(saveTaskCache()).resolves.not.toThrow();

    expect(mockedWarning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to save task cache:"),
    );
    expect(mockedWarning).toHaveBeenCalledWith(expect.stringContaining("Network error"));
  });

  it("handles different error types gracefully", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockRejectedValue("string error");

    await saveTaskCache();

    expect(mockedWarning).toHaveBeenCalledWith(
      expect.stringContaining("Failed to save task cache: string error"),
    );
  });

  it("saves cache with correct paths when matched key is different", async () => {
    stubSaveState({
      primaryKey: "vite-task-Linux-x64-12345-2",
      matchedKey: "vite-task-Linux-x64-12345-1",
      cachePaths: ["/workspace/node_modules/.vite/task-cache"],
    });
    mockedSaveCacheAction.mockResolvedValue(100);

    await saveTaskCache();

    expect(mockedSaveCacheAction).toHaveBeenCalledWith(
      ["/workspace/node_modules/.vite/task-cache"],
      "vite-task-Linux-x64-12345-2",
    );
    expect(mockedInfo).toHaveBeenCalledWith(
      expect.stringContaining("Task cache saved with key: vite-task-Linux-x64-12345-2"),
    );
  });
});
