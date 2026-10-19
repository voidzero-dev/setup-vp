import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { restoreCache, saveCache } from "@actions/cache";
import { getState, saveState, setOutput, warning } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPackageManagerCachePlan,
  validatePackageManager,
} from "./ci/package-manager-cache.js";
import { restorePackageManagerCache, savePackageManagerCache } from "./package-manager-cache.js";
import { State } from "./types.js";
import type { PackageManagerCachePlan } from "./ci/package-manager-cache.js";

vi.mock("@actions/cache", () => ({ restoreCache: vi.fn(), saveCache: vi.fn() }));
vi.mock("@actions/core", () => ({
  getState: vi.fn(),
  saveState: vi.fn(),
  setOutput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@actions/exec", () => ({ getExecOutput: vi.fn() }));
vi.mock("./ci/package-manager-cache.js", () => ({
  createPackageManagerCachePlan: vi.fn(),
  validatePackageManager: vi.fn(),
}));

let root: string;
let state: Map<string, string>;
let plan: PackageManagerCachePlan;
beforeEach(() => {
  vi.resetAllMocks();
  root = mkdtempSync(join(tmpdir(), "pm-cache-adapter-"));
  plan = {
    key: "exact-pnpm",
    name: "pnpm",
    version: "12.14.0",
    path: join(root, "package_manager/pnpm/12.14.0"),
    node: join(root, "node"),
  };
  state = new Map([[State.ToolchainCachePlan, JSON.stringify({ data: root })]]);
  vi.mocked(getState).mockImplementation((key) => state.get(key) || "");
  vi.mocked(saveState).mockImplementation((key, value) => {
    state.set(key, String(value));
  });
  vi.mocked(getExecOutput).mockImplementation(async (_cmd, args) => ({
    stdout: args?.length
      ? "{}"
      : `data\t${root}\nbin\t${root}/bin\ncache\t${root}/cache\nconfig\t${root}\nstate\t${root}\n`,
    stderr: "",
    exitCode: 0,
  }));
  vi.mocked(createPackageManagerCachePlan).mockReturnValue(plan);
  vi.mocked(validatePackageManager).mockReturnValue(true);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("package manager cache adapter", () => {
  it("reports validated exact hits and does not upload them again", async () => {
    vi.mocked(restoreCache).mockResolvedValue(plan.key);
    await restorePackageManagerCache(root);
    expect(setOutput).toHaveBeenLastCalledWith("package-manager-cache-hit", true);
    expect(state.get(State.PackageManagerCacheHit)).toBe("true");
    await savePackageManagerCache();
    expect(saveCache).not.toHaveBeenCalled();
  });
  it.each([undefined, "fallback", "invalid", "error"])(
    "recovers from %s without deleting other versions",
    async (result) => {
      const other = join(root, "package_manager/pnpm/12.13.0");
      mkdirSync(other, { recursive: true });
      vi.mocked(restoreCache).mockImplementation(async () => {
        mkdirSync(plan.path, { recursive: true });
        writeFileSync(join(plan.path, "partial"), "partial");
        if (result === "error") throw new Error("interrupted");
        return result === "invalid" ? plan.key : result;
      });
      if (result === "invalid") vi.mocked(validatePackageManager).mockReturnValue(false);
      await restorePackageManagerCache(root);
      expect(existsSync(plan.path)).toBe(false);
      expect(existsSync(other)).toBe(true);
      expect(state.get(State.PackageManagerCacheHit)).not.toBe("true");
      vi.mocked(validatePackageManager).mockReturnValue(true);
      await savePackageManagerCache();
      expect(saveCache).toHaveBeenCalledWith([plan.path], plan.key);
    },
  );
  it("preserves installations that already exist", async () => {
    mkdirSync(plan.path, { recursive: true });
    await restorePackageManagerCache(root);
    expect(restoreCache).not.toHaveBeenCalled();
    expect(existsSync(plan.path)).toBe(true);
  });
  it("skips package managers when toolchain caching is unavailable", async () => {
    state.clear();
    await restorePackageManagerCache(root);
    expect(getExecOutput).not.toHaveBeenCalled();
  });
  it("does not restore into an unconfirmed data directory", async () => {
    state.set(State.ToolchainCachePlan, JSON.stringify({ data: tmpdir() }));
    await restorePackageManagerCache(root);
    expect(restoreCache).not.toHaveBeenCalled();
  });
  it("skips unsupported manager selections", async () => {
    vi.mocked(createPackageManagerCachePlan).mockReturnValue(undefined);
    await restorePackageManagerCache(root);
    await savePackageManagerCache();
    expect(restoreCache).not.toHaveBeenCalled();
    expect(saveCache).not.toHaveBeenCalled();
  });
  it("keeps failures nonfatal and does not save an incomplete installation", async () => {
    await restorePackageManagerCache(root);
    vi.mocked(validatePackageManager).mockReturnValue(false);
    await savePackageManagerCache();
    expect(saveCache).not.toHaveBeenCalled();
    vi.mocked(validatePackageManager).mockReturnValue(true);
    vi.mocked(saveCache).mockRejectedValue(new Error("unavailable"));
    await expect(savePackageManagerCache()).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalled();
  });
});
