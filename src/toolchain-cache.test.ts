import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { restoreCache, saveCache } from "@actions/cache";
import { getState, saveState, setOutput, warning } from "@actions/core";
import {
  canRestoreToolchain,
  createToolchainCachePlan,
  discardRestoredToolchain,
  validateToolchain,
} from "./ci/toolchain-cache.js";
import { restoreToolchainCache, saveToolchainCache } from "./toolchain-cache.js";
import { State } from "./types.js";
import { isWindows } from "./ci/platform.js";
import { recordToolchainLinks, restoreToolchainLinks } from "./ci/toolchain-links.js";

vi.mock("./ci/platform.js", () => ({ isWindows: vi.fn() }));
vi.mock("./ci/toolchain-links.js", () => ({
  recordToolchainLinks: vi.fn(),
  restoreToolchainLinks: vi.fn(),
}));

vi.mock("@actions/cache", () => ({ restoreCache: vi.fn(), saveCache: vi.fn() }));
vi.mock("@actions/core", () => ({
  getState: vi.fn(),
  saveState: vi.fn(),
  setOutput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("./ci/toolchain-cache.js", () => ({
  createToolchainCachePlan: vi.fn(),
  canRestoreToolchain: vi.fn(),
  validateToolchain: vi.fn(),
  discardRestoredToolchain: vi.fn(),
}));

const plan = {
  key: "toolchain-exact",
  version: "1.3.0",
  nodeVersion: "22.23.1",
  data: "/vp",
  payload: "/vp/1.3.0",
  runtime: "/vp/node/22.23.1",
  paths: ["/vp/1.3.0", "/vp/node/22.23.1"],
};
const options = { version: plan.version, nodeVersion: plan.nodeVersion, projectDir: "/project" };
let state: Map<string, string>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isWindows).mockReturnValue(false);
  state = new Map();
  vi.mocked(getState).mockImplementation((key) => state.get(key) || "");
  vi.mocked(saveState).mockImplementation((key, value) => {
    state.set(key, String(value));
  });
  vi.mocked(createToolchainCachePlan).mockReturnValue(plan);
  vi.mocked(canRestoreToolchain).mockReturnValue(true);
  vi.mocked(validateToolchain).mockReturnValue(true);
});

describe("toolchain cache adapter", () => {
  it("repairs Windows junctions before validation", async () => {
    vi.mocked(isWindows).mockReturnValue(true);
    vi.mocked(restoreCache).mockResolvedValue(plan.key);
    await expect(restoreToolchainCache(options)).resolves.toEqual({ plan, hit: true });
    expect(restoreToolchainLinks).toHaveBeenCalledWith(plan.payload);
    expect(vi.mocked(restoreToolchainLinks).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(validateToolchain).mock.invocationCallOrder[0]!,
    );
  });

  it.each([undefined, new Error("upload failed")])(
    "cleans up Windows save metadata after an upload (%s)",
    async (error) => {
      vi.mocked(isWindows).mockReturnValue(true);
      state.set(State.ToolchainCachePlan, JSON.stringify(plan));
      const cleanup = vi.fn();
      vi.mocked(recordToolchainLinks).mockReturnValue(cleanup);
      if (error) {
        vi.mocked(saveCache).mockRejectedValue(error);
      } else {
        vi.mocked(saveCache).mockResolvedValue(42);
      }

      await saveToolchainCache();

      expect(recordToolchainLinks).toHaveBeenCalledWith(plan.payload);
      expect(saveCache).toHaveBeenCalledWith(plan.paths, plan.key);
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );

  it("reports a hit only after an exact match passes validation", async () => {
    vi.mocked(restoreCache).mockResolvedValue(plan.key);
    await restoreToolchainCache(options);
    expect(restoreCache).toHaveBeenCalledWith(plan.paths, plan.key, [], expect.any(Object));
    expect(setOutput).toHaveBeenLastCalledWith("toolchain-cache-hit", true);
    expect(state.get(State.ToolchainCacheHit)).toBe("true");
    await saveToolchainCache();
    expect(saveCache).not.toHaveBeenCalled();
  });
  it.each([undefined, "toolchain-prefix-match"])(
    "keeps a miss recoverable (%s)",
    async (matched) => {
      vi.mocked(restoreCache).mockResolvedValue(matched);
      await expect(restoreToolchainCache(options)).resolves.toEqual({ plan, hit: false });
      expect(discardRestoredToolchain).toHaveBeenCalledWith(plan);
      expect(setOutput).toHaveBeenLastCalledWith("toolchain-cache-hit", false);
      vi.mocked(saveCache).mockResolvedValue(42);
      await saveToolchainCache();
      expect(saveCache).toHaveBeenCalledWith(plan.paths, plan.key);
    },
  );
  it("removes incomplete downloads and keeps the installer available", async () => {
    vi.mocked(restoreCache).mockRejectedValue(new Error("download interrupted"));
    await expect(restoreToolchainCache(options)).resolves.toEqual({ plan, hit: false });
    expect(discardRestoredToolchain).toHaveBeenCalledWith(plan);
    expect(warning).toHaveBeenCalled();
  });
  it.each([false, new Error("broken dependency")])(
    "rejects invalid restored artifacts (%s)",
    async (result) => {
      vi.mocked(restoreCache).mockResolvedValue(plan.key);
      vi.mocked(validateToolchain).mockImplementation(() => {
        if (result instanceof Error) throw result;
        return result;
      });
      await restoreToolchainCache(options);
      expect(discardRestoredToolchain).toHaveBeenCalledWith(plan);
      expect(state.get(State.ToolchainCacheHit)).not.toBe("true");
    },
  );
  it("does not extract over an existing installation", async () => {
    vi.mocked(canRestoreToolchain).mockReturnValue(false);
    await restoreToolchainCache(options);
    expect(restoreCache).not.toHaveBeenCalled();
    expect(discardRestoredToolchain).not.toHaveBeenCalled();
  });
  it.each([
    ["selecting the cache", createToolchainCachePlan],
    ["checking existing files", canRestoreToolchain],
  ] as const)("preserves files when %s throws before restoration", async (_name, prepare) => {
    vi.mocked(prepare).mockImplementationOnce(() => {
      throw new Error("preparation failed");
    });

    await expect(restoreToolchainCache(options)).resolves.toEqual(
      prepare === createToolchainCachePlan ? undefined : { plan, hit: false },
    );

    expect(restoreCache).not.toHaveBeenCalled();
    expect(discardRestoredToolchain).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
  });
  it("skips unsupported selections without a service request", async () => {
    vi.mocked(createToolchainCachePlan).mockReturnValue(undefined);
    await restoreToolchainCache(options);
    await saveToolchainCache();
    expect(restoreCache).not.toHaveBeenCalled();
    expect(saveCache).not.toHaveBeenCalled();
  });
  it.each([new Error("cache reservation collision"), new Error("service unavailable")])(
    "does not fail setup after a save error",
    async (error) => {
      state.set(State.ToolchainCachePlan, JSON.stringify(plan));
      vi.mocked(saveCache).mockRejectedValue(error);
      await expect(saveToolchainCache()).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalled();
    },
  );
  it("does not save an installation changed or damaged after setup", async () => {
    state.set(State.ToolchainCachePlan, JSON.stringify(plan));
    vi.mocked(validateToolchain).mockReturnValue(false);
    await saveToolchainCache();
    expect(saveCache).not.toHaveBeenCalled();
  });
});
