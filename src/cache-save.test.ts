import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Mock external shells before importing the SUT so the module's in-file
// references resolve to the mocked versions.
vi.mock("@actions/cache", () => ({
  saveCache: vi.fn(),
}));
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));
vi.mock("@actions/core", () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { exec } from "@actions/exec";
import { saveCache } from "./cache-save.js";
import { State } from "./types.js";

const mockedSaveCacheAction = vi.mocked(saveCacheAction);
const mockedGetState = vi.mocked(getState);
const mockedInfo = vi.mocked(info);
const mockedWarning = vi.mocked(warning);
const mockedExec = vi.mocked(exec);

// Drive getState to return values for the save path:
// a primary key, distinct matched key (so we don't short-circuit on a hit),
// and non-empty cache paths.
function stubSaveState({ matchedKey = "", lockFileType = "pnpm" } = {}): void {
  mockedGetState.mockImplementation((name: string) => {
    switch (name) {
      case State.CachePrimaryKey:
        return "vite-plus-Linux-x64-pnpm-abc123";
      case State.CacheMatchedKey:
        return matchedKey;
      case State.CacheLockFileType:
        return lockFileType;
      case State.CacheCwd:
        return "/home/runner/work/app";
      case State.CachePaths:
        return JSON.stringify(["/home/runner/.cache/pnpm"]);
      default:
        return "";
    }
  });
}

describe("saveCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not warn when the cache key was already reserved by a concurrent matrix job", async () => {
    // In a build matrix, jobs that share a cache key (e.g. same OS/arch/lockfile
    // across Node versions) race to save it. The losers get cacheId === -1 from
    // @actions/cache. That is expected and benign, not warning-worthy.
    stubSaveState();
    mockedSaveCacheAction.mockResolvedValue(-1);

    await saveCache();

    expect(mockedWarning).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalled();
  });

  it("logs a success message when the cache is saved", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockResolvedValue(42);

    await saveCache();

    expect(mockedWarning).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith(
      expect.stringContaining("vite-plus-Linux-x64-pnpm-abc123"),
    );
  });

  it("warns when saveCache throws an unexpected error", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockRejectedValue(new Error("boom"));

    await saveCache();

    expect(mockedWarning).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  describe("after a restore-key match", () => {
    const previousKey = "vite-plus-Linux-x64-pnpm-old999";

    it("prunes the pnpm store before saving", async () => {
      stubSaveState({ matchedKey: previousKey });
      mockedExec.mockResolvedValue(0);
      mockedSaveCacheAction.mockResolvedValue(42);

      await saveCache();

      expect(mockedExec).toHaveBeenCalledWith("vp", ["pm", "cache", "clean"], {
        cwd: "/home/runner/work/app",
        ignoreReturnCode: true,
      });
      expect(mockedExec.mock.invocationCallOrder[0]).toBeLessThan(
        mockedSaveCacheAction.mock.invocationCallOrder[0]!,
      );
      expect(mockedWarning).not.toHaveBeenCalled();
    });

    it("still saves when pruning fails", async () => {
      stubSaveState({ matchedKey: previousKey });
      mockedExec.mockResolvedValue(1);
      mockedSaveCacheAction.mockResolvedValue(42);

      await saveCache();

      expect(mockedWarning).toHaveBeenCalledWith(expect.stringContaining("exit code 1"));
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("does not prune caches of other package managers", async () => {
      stubSaveState({ matchedKey: previousKey, lockFileType: "npm" });
      mockedSaveCacheAction.mockResolvedValue(42);

      await saveCache();

      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });
  });

  it("does not prune when no cache was restored", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockResolvedValue(42);

    await saveCache();

    expect(mockedExec).not.toHaveBeenCalled();
  });
});
