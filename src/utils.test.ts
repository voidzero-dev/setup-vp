import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getExecOutput } from "@actions/exec";
import {
  detectLockFile,
  getConfiguredProjectDir,
  getCacheDirectories,
  getInstallCwd,
  resolvePath,
} from "./utils.js";
import { LockFileType } from "./types.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  getExecOutput: vi.fn(),
}));

// Mock fs module
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

describe("detectLockFile", () => {
  const mockWorkspace = "/test/workspace";

  beforeEach(() => {
    vi.stubEnv("GITHUB_WORKSPACE", mockWorkspace);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  describe("with explicit path", () => {
    it("should return lock file info for pnpm-lock.yaml", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = detectLockFile("pnpm-lock.yaml");

      expect(result).toEqual({
        type: LockFileType.Pnpm,
        path: join(mockWorkspace, "pnpm-lock.yaml"),
        filename: "pnpm-lock.yaml",
      });
    });

    it("should return lock file info for package-lock.json", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = detectLockFile("package-lock.json");

      expect(result).toEqual({
        type: LockFileType.Npm,
        path: join(mockWorkspace, "package-lock.json"),
        filename: "package-lock.json",
      });
    });

    it("should return lock file info for yarn.lock", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = detectLockFile("yarn.lock");

      expect(result).toEqual({
        type: LockFileType.Yarn,
        path: join(mockWorkspace, "yarn.lock"),
        filename: "yarn.lock",
      });
    });

    it("should return lock file info for bun.lockb", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = detectLockFile("bun.lockb");

      expect(result).toEqual({
        type: LockFileType.Bun,
        path: join(mockWorkspace, "bun.lockb"),
        filename: "bun.lockb",
      });
    });

    it("should return lock file info for bun.lock", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = detectLockFile("bun.lock");

      expect(result).toEqual({
        type: LockFileType.Bun,
        path: join(mockWorkspace, "bun.lock"),
        filename: "bun.lock",
      });
    });

    it("should return undefined if explicit file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = detectLockFile("pnpm-lock.yaml");

      expect(result).toBeUndefined();
    });

    it("should handle absolute paths", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const absolutePath = "/custom/path/pnpm-lock.yaml";
      const result = detectLockFile(absolutePath);

      expect(result).toEqual({
        type: LockFileType.Pnpm,
        path: absolutePath,
        filename: "pnpm-lock.yaml",
      });
    });

    it("should resolve relative explicit paths from the provided search directory", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const webWorkspace = join(mockWorkspace, "web");
      const result = detectLockFile("pnpm-lock.yaml", webWorkspace);

      expect(result).toEqual({
        type: LockFileType.Pnpm,
        path: join(webWorkspace, "pnpm-lock.yaml"),
        filename: "pnpm-lock.yaml",
      });
    });
  });

  describe("auto-detection", () => {
    it("should detect pnpm-lock.yaml first (highest priority)", () => {
      vi.mocked(readdirSync).mockReturnValue([
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
      ] as unknown as ReturnType<typeof readdirSync>);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Pnpm,
        path: join(mockWorkspace, "pnpm-lock.yaml"),
        filename: "pnpm-lock.yaml",
      });
    });

    it("should detect package-lock.json when pnpm-lock.yaml is absent", () => {
      vi.mocked(readdirSync).mockReturnValue([
        "package-lock.json",
        "yarn.lock",
      ] as unknown as ReturnType<typeof readdirSync>);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Npm,
        path: join(mockWorkspace, "package-lock.json"),
        filename: "package-lock.json",
      });
    });

    it("should detect npm-shrinkwrap.json", () => {
      vi.mocked(readdirSync).mockReturnValue(["npm-shrinkwrap.json"] as unknown as ReturnType<
        typeof readdirSync
      >);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Npm,
        path: join(mockWorkspace, "npm-shrinkwrap.json"),
        filename: "npm-shrinkwrap.json",
      });
    });

    it("should detect yarn.lock when higher priority files are absent", () => {
      vi.mocked(readdirSync).mockReturnValue(["yarn.lock"] as unknown as ReturnType<
        typeof readdirSync
      >);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Yarn,
        path: join(mockWorkspace, "yarn.lock"),
        filename: "yarn.lock",
      });
    });

    it("should detect bun.lockb", () => {
      vi.mocked(readdirSync).mockReturnValue(["bun.lockb"] as unknown as ReturnType<
        typeof readdirSync
      >);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Bun,
        path: join(mockWorkspace, "bun.lockb"),
        filename: "bun.lockb",
      });
    });

    it("should detect bun.lock when bun.lockb is absent", () => {
      vi.mocked(readdirSync).mockReturnValue(["bun.lock"] as unknown as ReturnType<
        typeof readdirSync
      >);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Bun,
        path: join(mockWorkspace, "bun.lock"),
        filename: "bun.lock",
      });
    });

    it("should prioritize bun.lockb over bun.lock", () => {
      vi.mocked(readdirSync).mockReturnValue(["bun.lock", "bun.lockb"] as unknown as ReturnType<
        typeof readdirSync
      >);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Bun,
        path: join(mockWorkspace, "bun.lockb"),
        filename: "bun.lockb",
      });
    });

    it("should prioritize pnpm-lock.yaml over bun lock files", () => {
      vi.mocked(readdirSync).mockReturnValue([
        "bun.lockb",
        "pnpm-lock.yaml",
      ] as unknown as ReturnType<typeof readdirSync>);

      const result = detectLockFile();

      expect(result).toEqual({
        type: LockFileType.Pnpm,
        path: join(mockWorkspace, "pnpm-lock.yaml"),
        filename: "pnpm-lock.yaml",
      });
    });

    it("should return undefined when no lock files found", () => {
      vi.mocked(readdirSync).mockReturnValue([
        "package.json",
        "src",
        "README.md",
      ] as unknown as ReturnType<typeof readdirSync>);

      const result = detectLockFile();

      expect(result).toBeUndefined();
    });
  });
});

describe("getConfiguredProjectDir", () => {
  const mockWorkspace = "/test/workspace";

  beforeEach(() => {
    vi.stubEnv("GITHUB_WORKSPACE", mockWorkspace);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
    } as ReturnType<typeof statSync>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should use working-directory when provided", () => {
    expect(
      getConfiguredProjectDir({
        version: "latest",
        nodeVersion: undefined,
        nodeVersionFile: undefined,
        workingDirectory: "web",
        runInstall: [],
        sfw: false,
        cache: false,
        cacheDependencyPath: undefined,
        registryUrl: undefined,
        scope: undefined,
      }),
    ).toBe(join(mockWorkspace, "web"));
  });

  it("should fall back to workspace root", () => {
    expect(
      getConfiguredProjectDir({
        version: "latest",
        nodeVersion: undefined,
        nodeVersionFile: undefined,
        workingDirectory: undefined,
        runInstall: [],
        sfw: false,
        cache: false,
        cacheDependencyPath: undefined,
        registryUrl: undefined,
        scope: undefined,
      }),
    ).toBe(mockWorkspace);
  });

  it("should throw a clear error when working-directory does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() =>
      getConfiguredProjectDir({
        version: "latest",
        nodeVersion: undefined,
        nodeVersionFile: undefined,
        workingDirectory: "web",
        runInstall: [],
        sfw: false,
        cache: false,
        cacheDependencyPath: undefined,
        registryUrl: undefined,
        scope: undefined,
      }),
    ).toThrow(`working-directory not found: web (resolved to ${join(mockWorkspace, "web")})`);
  });

  it("should throw a clear error when working-directory is not a directory", () => {
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => false,
    } as ReturnType<typeof statSync>);

    expect(() =>
      getConfiguredProjectDir({
        version: "latest",
        nodeVersion: undefined,
        nodeVersionFile: undefined,
        workingDirectory: "web",
        runInstall: [],
        sfw: false,
        cache: false,
        cacheDependencyPath: undefined,
        registryUrl: undefined,
        scope: undefined,
      }),
    ).toThrow(
      `working-directory is not a directory: web (resolved to ${join(mockWorkspace, "web")})`,
    );
  });
});

describe("resolvePath", () => {
  const mockWorkspace = "/test/workspace";

  beforeEach(() => {
    vi.stubEnv("GITHUB_WORKSPACE", mockWorkspace);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
    } as ReturnType<typeof statSync>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should resolve relative paths from working-directory", () => {
    const projectDir = getConfiguredProjectDir({
      version: "latest",
      nodeVersion: undefined,
      nodeVersionFile: undefined,
      workingDirectory: "web",
      runInstall: [],
      sfw: false,
      cache: false,
      cacheDependencyPath: undefined,
      registryUrl: undefined,
      scope: undefined,
    });

    expect(resolvePath(".nvmrc", projectDir)).toBe(join(mockWorkspace, "web", ".nvmrc"));
  });
});

describe("getCacheDirectories", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should run vp pm cache dir in the provided cwd", async () => {
    vi.mocked(getExecOutput).mockResolvedValue({
      exitCode: 0,
      stdout: "/tmp/pnpm-store\n",
      stderr: "",
    });

    const cacheCwd = join("/test", "workspace", "web");
    const result = await getCacheDirectories(LockFileType.Pnpm, cacheCwd);

    expect(result).toEqual(["/tmp/pnpm-store"]);
    expect(getExecOutput).toHaveBeenCalledWith(
      "vp",
      ["pm", "cache", "dir"],
      expect.objectContaining({
        cwd: cacheCwd,
        silent: true,
        ignoreReturnCode: true,
      }),
    );
  });

  it("should run vp pm cache dir for bun", async () => {
    vi.mocked(getExecOutput).mockResolvedValue({
      exitCode: 0,
      stdout: "/tmp/bun-cache\n",
      stderr: "",
    });

    const cacheCwd = join("/test", "workspace", "web");
    const result = await getCacheDirectories(LockFileType.Bun, cacheCwd);

    expect(result).toEqual(["/tmp/bun-cache"]);
  });
});

describe("getInstallCwd", () => {
  const mockWorkspace = "/test/workspace";

  beforeEach(() => {
    vi.stubEnv("GITHUB_WORKSPACE", mockWorkspace);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({
      isDirectory: () => true,
    } as ReturnType<typeof statSync>);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should default to the configured project directory", () => {
    expect(getInstallCwd(join(mockWorkspace, "web"))).toBe(join(mockWorkspace, "web"));
  });

  it("should resolve override cwd relative to working-directory", () => {
    expect(getInstallCwd(join(mockWorkspace, "web"), "packages/app")).toBe(
      join(mockWorkspace, "web", "packages", "app"),
    );
  });

  it("should fall back to workspace root when no project directory is configured", () => {
    expect(getInstallCwd(mockWorkspace)).toBe(mockWorkspace);
  });

  it("should keep absolute override cwd as-is", () => {
    expect(getInstallCwd(join(mockWorkspace, "web"), "/custom/path/app")).toBe("/custom/path/app");
  });
});
