import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";

// Mock external shells before importing the SUT so the module's in-file
// references resolve to the mocked versions.
vi.mock("@actions/cache", () => ({
  saveCache: vi.fn(),
}));
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
  getExecOutput: vi.fn(),
}));
vi.mock("@actions/core", () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

import { saveCache as saveCacheAction } from "@actions/cache";
import { getState, info, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { saveCache } from "./cache-save.js";
import { State } from "./types.js";

const mockedSaveCacheAction = vi.mocked(saveCacheAction);
const mockedGetState = vi.mocked(getState);
const mockedInfo = vi.mocked(info);
const mockedWarning = vi.mocked(warning);
const mockedExec = vi.mocked(exec);
const mockedGetExecOutput = vi.mocked(getExecOutput);

// Drive getState to return values for the save path:
// a primary key, distinct matched key (so we don't short-circuit on a hit),
// and non-empty cache paths.
function stubSaveState({
  matchedKey = "",
  lockFileType = "pnpm",
  cwd = "/home/runner/work/app",
} = {}): void {
  mockedGetState.mockImplementation((name: string) => {
    switch (name) {
      case State.CachePrimaryKey:
        return "vite-plus-Linux-x64-pnpm-abc123";
      case State.CacheMatchedKey:
        return matchedKey;
      case State.CacheLockFileType:
        return lockFileType;
      case State.CacheCwd:
        return cwd;
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
    const storePath = "/home/runner/.cache/pnpm";
    const storeArgs = ["--", "--store-dir", storePath];
    let cwd: string;

    // Record the store the install used, as pnpm does in node_modules/.modules.yaml.
    function writeInstalledStore(storeDir: string | undefined): void {
      mkdirSync(join(cwd, "node_modules"), { recursive: true });
      writeFileSync(
        join(cwd, "node_modules", ".modules.yaml"),
        JSON.stringify({ storeDir, virtualStoreDir: ".pnpm" }),
      );
    }

    // Stub `vp env current --json` and `vp pm cache dir`, the probes run before pruning.
    function stubProbes({
      packageManager = { name: "pnpm", version: "12.18.0" } as unknown,
      storeDir = storePath,
    } = {}): void {
      mockedGetExecOutput.mockImplementation(async (_command, args) => {
        const stdout =
          args?.[0] === "env"
            ? JSON.stringify({ package_manager: packageManager })
            : `${storeDir}\n`;
        return { exitCode: 0, stdout, stderr: "" };
      });
    }

    beforeEach(() => {
      cwd = mkdtempSync(join(tmpdir(), "setup-vp-cache-save-"));
      writeInstalledStore(storePath);
      stubSaveState({ matchedKey: previousKey, cwd });
      mockedSaveCacheAction.mockResolvedValue(42);
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it("prunes the restored pnpm store before saving", async () => {
      stubProbes();
      mockedExec.mockResolvedValue(0);

      await saveCache({ prune: true });

      expect(mockedGetExecOutput).toHaveBeenCalledWith(
        "vp",
        ["pm", "cache", "dir", ...storeArgs],
        expect.objectContaining({ cwd }),
      );
      expect(mockedExec).toHaveBeenCalledWith(
        "vp",
        ["pm", "cache", "clean", ...storeArgs, "--cache-dir", expect.any(String)],
        { cwd, ignoreReturnCode: true },
      );
      expect(mockedExec.mock.invocationCallOrder[0]).toBeLessThan(
        mockedSaveCacheAction.mock.invocationCallOrder[0]!,
      );
      expect(mockedWarning).not.toHaveBeenCalled();
    });

    it("does not prune unless cache-prune is enabled", async () => {
      stubProbes();

      await saveCache();

      expect(mockedGetExecOutput).not.toHaveBeenCalled();
      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("does not prune when packageManager selects another package manager", async () => {
      stubProbes({ packageManager: { name: "yarn", version: "4.18.1" } });

      await saveCache({ prune: true });

      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it.each(["10.34.7", "12.15.2", "unknown"])(
      "does not prune with pnpm %s, which can remove packages still in use",
      async (version) => {
        stubProbes({ packageManager: { name: "pnpm", version } });

        await saveCache({ prune: true });

        expect(mockedExec).not.toHaveBeenCalled();
        expect(mockedSaveCacheAction).toHaveBeenCalled();
      },
    );

    it("does not prune when the store resolves to another directory", async () => {
      stubProbes({ storeDir: "/Users/runner/Library/pnpm/store/v11" });

      await saveCache({ prune: true });

      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("isolates the pnpm metadata cache and removes it afterwards", async () => {
      stubProbes();
      let metadataCacheDir = "";
      mockedExec.mockImplementation(async (_command, args) => {
        metadataCacheDir = args!.at(-1)!;
        expect(existsSync(metadataCacheDir)).toBe(true);
        return 0;
      });

      await saveCache({ prune: true });

      expect(metadataCacheDir).toContain("setup-vp-prune-");
      expect(existsSync(metadataCacheDir)).toBe(false);
    });

    it("does not prune when the install used another store", async () => {
      stubProbes();
      writeInstalledStore("/home/runner/custom-store/v11");

      await saveCache({ prune: true });

      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedInfo).toHaveBeenCalledWith(
        expect.stringContaining('the install used the store "/home/runner/custom-store/v11"'),
      );
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("does not prune when no install recorded its store", async () => {
      stubProbes();
      rmSync(join(cwd, "node_modules"), { recursive: true, force: true });

      await saveCache({ prune: true });

      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("still saves when pruning fails", async () => {
      stubProbes();
      mockedExec.mockResolvedValue(1);

      await saveCache({ prune: true });

      expect(mockedWarning).toHaveBeenCalledWith(expect.stringContaining("exit code 1"));
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("still saves when a probe fails", async () => {
      mockedGetExecOutput.mockRejectedValue(new Error("vp not found"));

      await saveCache({ prune: true });

      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedWarning).toHaveBeenCalledWith(expect.stringContaining("vp not found"));
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });

    it("does not prune caches of other lock file types", async () => {
      stubSaveState({ matchedKey: previousKey, lockFileType: "npm", cwd });

      await saveCache({ prune: true });

      expect(mockedGetExecOutput).not.toHaveBeenCalled();
      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedSaveCacheAction).toHaveBeenCalled();
    });
  });

  it("does not prune when no cache was restored", async () => {
    stubSaveState();
    mockedSaveCacheAction.mockResolvedValue(42);

    await saveCache({ prune: true });

    expect(mockedGetExecOutput).not.toHaveBeenCalled();
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
