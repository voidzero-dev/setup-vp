import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";

// Mock external dependencies before importing the SUT so the module's
// in-file references resolve to the mocked versions. setupSfw / installSfw
// call findSfwOnPath / isSfwSupported / installSfw directly within the
// module, so we drive them by stubbing process.platform and the external
// shells (@actions/core, @actions/cache, @actions/exec, node:child_process,
// node:fs).
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  addPath: vi.fn(),
}));
vi.mock("@actions/cache", () => ({
  restoreCache: vi.fn(),
  saveCache: vi.fn(),
}));
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));
vi.mock("node:fs", () => ({
  chmodSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

import { restoreCache, saveCache } from "@actions/cache";
import { addPath, info, warning } from "@actions/core";
import { exec } from "@actions/exec";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getSfwAssetName, installSfw, isSfwSupported, setupSfw } from "./install-sfw.js";
import type { Inputs } from "./types.js";

describe("getSfwAssetName", () => {
  it("returns macOS arm64 asset", () => {
    expect(getSfwAssetName("darwin", "arm64", false)).toBe("sfw-free-macos-arm64");
  });

  it("returns macOS x64 asset", () => {
    expect(getSfwAssetName("darwin", "x64", false)).toBe("sfw-free-macos-x86_64");
  });

  it("ignores isMusl on darwin", () => {
    expect(getSfwAssetName("darwin", "arm64", true)).toBe("sfw-free-macos-arm64");
    expect(getSfwAssetName("darwin", "x64", true)).toBe("sfw-free-macos-x86_64");
  });

  it("returns Linux glibc arm64 asset", () => {
    expect(getSfwAssetName("linux", "arm64", false)).toBe("sfw-free-linux-arm64");
  });

  it("returns Linux glibc x64 asset", () => {
    expect(getSfwAssetName("linux", "x64", false)).toBe("sfw-free-linux-x86_64");
  });

  it("returns Linux musl arm64 asset", () => {
    expect(getSfwAssetName("linux", "arm64", true)).toBe("sfw-free-musl-linux-arm64");
  });

  it("returns Linux musl x64 asset", () => {
    expect(getSfwAssetName("linux", "x64", true)).toBe("sfw-free-musl-linux-x86_64");
  });

  it("returns Windows arm64 asset", () => {
    expect(getSfwAssetName("win32", "arm64", false)).toBe("sfw-free-windows-arm64.exe");
  });

  it("returns Windows x64 asset", () => {
    expect(getSfwAssetName("win32", "x64", false)).toBe("sfw-free-windows-x86_64.exe");
  });

  it("ignores isMusl on win32", () => {
    expect(getSfwAssetName("win32", "x64", true)).toBe("sfw-free-windows-x86_64.exe");
  });

  it("throws on unsupported platform", () => {
    expect(() => getSfwAssetName("freebsd" as NodeJS.Platform, "x64", false)).toThrow(
      /freebsd\/x64/,
    );
  });

  it("throws on unsupported arch", () => {
    expect(() => getSfwAssetName("linux", "ia32", false)).toThrow(/linux\/ia32/);
  });

  it("includes libc in error message for unsupported Linux arch", () => {
    expect(() => getSfwAssetName("linux", "ia32", true)).toThrow(/musl/);
    expect(() => getSfwAssetName("linux", "ia32", false)).toThrow(/glibc/);
  });
});

describe("isSfwSupported", () => {
  // Passes platform/arch/isMusl as explicit args so the test doesn't depend on
  // the runtime host (matters for self-hosted runners on unsupported archs).
  it("returns true for every supported platform + arch combo", () => {
    // macOS / Windows are supported as of vite-plus v0.1.23
    expect(isSfwSupported("darwin", "arm64", false)).toBe(true);
    expect(isSfwSupported("darwin", "x64", false)).toBe(true);
    expect(isSfwSupported("win32", "arm64", false)).toBe(true);
    expect(isSfwSupported("win32", "x64", false)).toBe(true);
    // Linux, both libc flavours
    expect(isSfwSupported("linux", "x64", false)).toBe(true);
    expect(isSfwSupported("linux", "arm64", false)).toBe(true);
    expect(isSfwSupported("linux", "x64", true)).toBe(true);
    expect(isSfwSupported("linux", "arm64", true)).toBe(true);
  });

  it("returns false when the platform/arch has no published sfw asset", () => {
    expect(isSfwSupported("linux", "ia32", false)).toBe(false);
    expect(isSfwSupported("linux", "ppc64", false)).toBe(false);
    expect(isSfwSupported("linux", "ia32", true)).toBe(false);
    expect(isSfwSupported("darwin", "ia32", false)).toBe(false);
    expect(isSfwSupported("freebsd" as NodeJS.Platform, "x64", false)).toBe(false);
  });
});

// --- setupSfw / installSfw branch tests ------------------------------------
//
// Stubbing process.platform / process.arch requires Object.defineProperty
// because the descriptors are non-writable by default. We save and restore
// in afterEach to avoid leaking state between tests.
const originalPlatform = process.platform;
const originalArch = process.arch;

function stubPlatform(platform: NodeJS.Platform, arch: string): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });
}

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    version: "latest",
    nodeVersion: undefined,
    nodeVersionFile: undefined,
    workingDirectory: undefined,
    runInstall: [{}],
    sfw: true,
    cache: false,
    cacheDependencyPath: undefined,
    registryUrl: undefined,
    scope: undefined,
    ...overrides,
  };
}

describe("setupSfw", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubPlatform("linux", "x64");
    // existsSync is shared between isMuslLinux's /etc/alpine-release probe
    // and installSfw's binary-exists check — default to "no alpine, no
    // binary yet" and let individual tests override.
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true });
  });

  it("returns false silently when inputs.sfw is false", async () => {
    expect(await setupSfw(makeInputs({ sfw: false }))).toBe(false);
    expect(info).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
  });

  it("returns false with an info log when run-install is empty", async () => {
    expect(await setupSfw(makeInputs({ runInstall: [] }))).toBe(false);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("`run-install` is disabled"));
    expect(warning).not.toHaveBeenCalled();
  });

  it("uses an existing sfw on PATH on macOS and skips the download", async () => {
    // macOS is supported as of vp v0.1.23 — the PATH-detection branch now
    // applies to all platforms, not just Linux.
    stubPlatform("darwin", "arm64");
    vi.mocked(execFileSync).mockReturnValue("/usr/local/bin/sfw\n");
    expect(await setupSfw(makeInputs())).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Using existing sfw on PATH"));
    expect(restoreCache).not.toHaveBeenCalled(); // installSfw never invoked
    expect(exec).not.toHaveBeenCalled();
  });

  it("uses an existing sfw on PATH on Linux and skips the download", async () => {
    vi.mocked(execFileSync).mockReturnValue("/usr/bin/sfw\n");
    expect(await setupSfw(makeInputs())).toBe(true);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Using existing sfw on PATH"));
    expect(restoreCache).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back with a warning on an unsupported arch + no sfw on PATH", async () => {
    stubPlatform("linux", "ia32");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    expect(await setupSfw(makeInputs())).toBe(false);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("no published binary for this runner"),
    );
    expect(restoreCache).not.toHaveBeenCalled();
  });
});

describe("installSfw", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubPlatform("linux", "x64");
    // existsSync needs nuance: /etc/alpine-release → false (glibc), and
    // the downloaded binary path → true (so we proceed to chmod + addPath).
    vi.mocked(existsSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("/etc/alpine-release")) return false;
      return true; // the sfw binary path under $RUNNER_TEMP
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true });
  });

  it("uses the cached binary and skips download on a cache hit", async () => {
    vi.mocked(restoreCache).mockResolvedValueOnce("sfw-v1.11.0-linux-x64-glibc");
    await installSfw();
    expect(exec).not.toHaveBeenCalled(); // no download attempted
    expect(saveCache).not.toHaveBeenCalled(); // no re-save on hit
    expect(addPath).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("restored from cache"));
  });

  it("downloads and writes to cache on a cache miss", async () => {
    vi.mocked(restoreCache).mockResolvedValueOnce(undefined);
    vi.mocked(exec).mockResolvedValueOnce(0); // download success
    vi.mocked(saveCache).mockResolvedValueOnce(123);
    await installSfw();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(saveCache).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("sfw cached under key"));
  });

  it("falls through to download when cache restore throws", async () => {
    vi.mocked(restoreCache).mockRejectedValueOnce(new Error("cache service down"));
    vi.mocked(exec).mockResolvedValueOnce(0);
    await installSfw();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("cache restore failed"));
    expect(exec).toHaveBeenCalledTimes(1); // still downloaded
  });

  it("continues without throwing when cache save fails", async () => {
    vi.mocked(restoreCache).mockResolvedValueOnce(undefined);
    vi.mocked(exec).mockResolvedValueOnce(0);
    vi.mocked(saveCache).mockRejectedValueOnce(new Error("ReserveCacheError"));
    await expect(installSfw()).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("cache save failed"));
  });
});
