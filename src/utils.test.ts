import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { detectLockFile } from "./utils.js";
import { LockFileType } from "./types.js";

// Mock fs module
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
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
