import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { debug } from "@actions/core";
import {
  parseVitePlusVersionFromLockfile,
  tryResolveVitePlusVersionFromLockfile,
} from "./lockfile-version.js";
import { LockFileType } from "./types.js";
import type { LockFileInfo } from "./types.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warning: vi.fn(),
}));

// Cover every node:fs binding used across the imported module graph (utils.ts
// also imports statSync), not just the ones these tests exercise.
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

function lock(filename: string, type: LockFileType, content: string): LockFileInfo {
  vi.mocked(readFileSync).mockImplementation((path) => {
    if (path === `/repo/${filename}`) return content;
    throw new Error(`ENOENT: ${String(path)}`);
  });
  return { filename, type, path: `/repo/${filename}` };
}

describe("parseVitePlusVersionFromLockfile", () => {
  afterEach(() => vi.resetAllMocks());

  describe("package-lock.json / npm-shrinkwrap.json", () => {
    it("reads the top-level install from lockfileVersion 3", () => {
      const content = JSON.stringify({
        name: "app",
        lockfileVersion: 3,
        packages: {
          "": { devDependencies: { "vite-plus": "^0.2.0" } },
          "node_modules/vite-plus": { version: "0.2.0" },
        },
      });
      expect(
        parseVitePlusVersionFromLockfile(lock("package-lock.json", LockFileType.Npm, content)),
      ).toBe("0.2.0");
    });

    it("reads the legacy lockfileVersion 1 dependencies map", () => {
      const content = JSON.stringify({
        lockfileVersion: 1,
        dependencies: { "vite-plus": { version: "0.1.24" } },
      });
      expect(
        parseVitePlusVersionFromLockfile(lock("npm-shrinkwrap.json", LockFileType.Npm, content)),
      ).toBe("0.1.24");
    });

    it("prefers the selected workspace package's own (non-hoisted) install", () => {
      const content = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/vite-plus": { version: "9.9.9" },
          "packages/app/node_modules/vite-plus": { version: "0.2.0" },
        },
      });
      expect(
        parseVitePlusVersionFromLockfile(
          lock("package-lock.json", LockFileType.Npm, content),
          "packages/app",
        ),
      ).toBe("0.2.0");
    });

    it("returns undefined when vite-plus is absent", () => {
      const content = JSON.stringify({ lockfileVersion: 3, packages: { "": {} } });
      expect(
        parseVitePlusVersionFromLockfile(lock("package-lock.json", LockFileType.Npm, content)),
      ).toBeUndefined();
    });

    it("returns undefined on invalid JSON", () => {
      expect(
        parseVitePlusVersionFromLockfile(lock("package-lock.json", LockFileType.Npm, "not json{")),
      ).toBeUndefined();
    });
  });

  describe("pnpm-lock.yaml", () => {
    it("reads the resolved version from an importer devDependency", () => {
      const content = [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    devDependencies:",
        "      vite-plus:",
        "        specifier: ^0.2.0",
        "        version: 0.2.0",
        "packages:",
        "  vite-plus@0.2.0:",
        "    resolution: {integrity: sha512-fake}",
        "",
      ].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(lock("pnpm-lock.yaml", LockFileType.Pnpm, content)),
      ).toBe("0.2.0");
    });

    it("strips a pnpm peer-dependency suffix", () => {
      const content = [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      vite-plus:",
        "        specifier: ^0.2.0",
        "        version: 0.2.0(react@18.3.1)",
        "",
      ].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(lock("pnpm-lock.yaml", LockFileType.Pnpm, content)),
      ).toBe("0.2.0");
    });

    it("prefers the importer matching the project's subpath", () => {
      const content = [
        "importers:",
        "  packages/other:",
        "    dependencies:",
        "      vite-plus:",
        "        specifier: ^9.0.0",
        "        version: 9.9.9",
        "  packages/app:",
        "    devDependencies:",
        "      vite-plus:",
        "        specifier: ^0.2.0",
        "        version: 0.2.0",
        "",
      ].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(
          lock("pnpm-lock.yaml", LockFileType.Pnpm, content),
          "packages/app",
        ),
      ).toBe("0.2.0");
    });

    it("returns undefined when the matching importer has no vite-plus (no global leak)", () => {
      const content = [
        "importers:",
        "  packages/app:",
        "    dependencies:",
        "      other-dep:",
        "        specifier: ^1.0.0",
        "        version: 1.0.0",
        "  packages/tooling:",
        "    devDependencies:",
        "      vite-plus:",
        "        specifier: ^9.0.0",
        "        version: 9.9.9",
        "packages:",
        "  vite-plus@9.9.9:",
        "    resolution: {integrity: x}",
        "",
      ].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(
          lock("pnpm-lock.yaml", LockFileType.Pnpm, content),
          "packages/app",
        ),
      ).toBeUndefined();
    });

    it("falls back to scanning packages keys when there is no importer entry", () => {
      const content = [
        "packages:",
        "  /vite-plus@0.1.24:",
        "    resolution: {integrity: x}",
        "",
      ].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(lock("pnpm-lock.yaml", LockFileType.Pnpm, content)),
      ).toBe("0.1.24");
    });
  });

  describe("yarn.lock", () => {
    it("reads the resolved version from a classic (v1) entry", () => {
      const content = [
        "# yarn lockfile v1",
        "",
        "vite-plus@^0.2.0, vite-plus@~0.2.0:",
        '  version "0.2.0"',
        '  resolved "https://registry.yarnpkg.com/vite-plus/-/vite-plus-0.2.0.tgz"',
        "",
      ].join("\n");
      expect(parseVitePlusVersionFromLockfile(lock("yarn.lock", LockFileType.Yarn, content))).toBe(
        "0.2.0",
      );
    });

    it("reads the resolved version from a berry entry", () => {
      const content = [
        '"vite-plus@npm:^0.2.0":',
        "  version: 0.2.0",
        '  resolution: "vite-plus@npm:0.2.0"',
        "",
      ].join("\n");
      expect(parseVitePlusVersionFromLockfile(lock("yarn.lock", LockFileType.Yarn, content))).toBe(
        "0.2.0",
      );
    });

    it("does not match a scoped look-alike package", () => {
      const content = ['"@acme/vite-plus@npm:^1.0.0":', "  version: 9.9.9", ""].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(lock("yarn.lock", LockFileType.Yarn, content)),
      ).toBeUndefined();
    });

    it("returns undefined when multiple distinct versions are present (ambiguous)", () => {
      const content = [
        "vite-plus@^0.2.0:",
        '  version "0.2.0"',
        "",
        "vite-plus@^9.0.0:",
        '  version "9.9.9"',
        "",
      ].join("\n");
      expect(
        parseVitePlusVersionFromLockfile(lock("yarn.lock", LockFileType.Yarn, content)),
      ).toBeUndefined();
    });
  });

  describe("bun.lock", () => {
    it("reads the resolved id from the packages map", () => {
      const content = JSON.stringify(
        {
          lockfileVersion: 1,
          workspaces: { "": { devDependencies: { "vite-plus": "^0.2.0" } } },
          packages: { "vite-plus": ["vite-plus@0.2.0", "", {}, "sha512-fake"] },
        },
        null,
        2,
      );
      expect(parseVitePlusVersionFromLockfile(lock("bun.lock", LockFileType.Bun, content))).toBe(
        "0.2.0",
      );
    });

    it("returns undefined when multiple distinct versions are present (ambiguous)", () => {
      const content = JSON.stringify({
        packages: {
          "vite-plus": ["vite-plus@0.2.0", "", {}, "sha512-a"],
          "other/vite-plus": ["vite-plus@9.9.9", "", {}, "sha512-b"],
        },
      });
      expect(
        parseVitePlusVersionFromLockfile(lock("bun.lock", LockFileType.Bun, content)),
      ).toBeUndefined();
    });
  });

  it("returns undefined for the binary bun.lockb", () => {
    expect(
      parseVitePlusVersionFromLockfile(lock("bun.lockb", LockFileType.Bun, "binary")),
    ).toBeUndefined();
  });

  it("returns undefined when the lockfile cannot be read", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(
      parseVitePlusVersionFromLockfile({
        filename: "pnpm-lock.yaml",
        type: LockFileType.Pnpm,
        path: "/repo/pnpm-lock.yaml",
      }),
    ).toBeUndefined();
  });
});

describe("tryResolveVitePlusVersionFromLockfile", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
    process.env = { ...originalEnv, GITHUB_WORKSPACE: "/repo" };
  });

  afterEach(() => {
    vi.resetAllMocks();
    process.env = originalEnv;
  });

  it("auto-detects the lockfile in the project dir and resolves the version", () => {
    vi.mocked(readdirSync).mockReturnValue(["package.json", "pnpm-lock.yaml"] as never);
    vi.mocked(readFileSync).mockReturnValue(
      ["packages:", "  vite-plus@0.2.0:", "    resolution: {integrity: x}", ""].join("\n") as never,
    );

    expect(tryResolveVitePlusVersionFromLockfile("/repo")).toBe("0.2.0");
  });

  it("returns undefined when no lockfile is present", () => {
    vi.mocked(readdirSync).mockReturnValue(["package.json"] as never);

    expect(tryResolveVitePlusVersionFromLockfile("/repo")).toBeUndefined();
  });

  it("searches upward to the workspace root for a monorepo package's lockfile", () => {
    // Lockfile lives at the repo root; the working-directory is a subpackage.
    vi.mocked(readdirSync).mockImplementation(
      (dir) => (dir === "/repo" ? ["pnpm-lock.yaml"] : []) as never,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (p === "/repo/pnpm-lock.yaml") {
        return [
          "importers:",
          "  packages/app:",
          "    devDependencies:",
          "      vite-plus:",
          "        specifier: ^0.2.0",
          "        version: 0.2.0",
          "",
        ].join("\n") as never;
      }
      throw new Error(`ENOENT: ${String(p)}`);
    });

    expect(tryResolveVitePlusVersionFromLockfile("/repo/packages/app")).toBe("0.2.0");
  });

  it("logs at debug and returns undefined for a binary bun.lockb", () => {
    vi.mocked(readdirSync).mockReturnValue(["bun.lockb"] as never);

    expect(tryResolveVitePlusVersionFromLockfile("/repo")).toBeUndefined();
    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/bun\.lockb.*binary/s));
  });

  it("prefers a readable text bun.lock beside a binary bun.lockb", () => {
    vi.mocked(readdirSync).mockReturnValue(["bun.lockb", "bun.lock"] as never);
    vi.mocked(existsSync).mockImplementation((p) => p === "/repo/bun.lock");
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (p === "/repo/bun.lock") {
        return JSON.stringify({
          packages: { "vite-plus": ["vite-plus@0.2.0", "", {}, "sha512-x"] },
        }) as never;
      }
      throw new Error(`ENOENT: ${String(p)}`);
    });

    expect(tryResolveVitePlusVersionFromLockfile("/repo")).toBe("0.2.0");
  });
});
