import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findIncompletePnpmInstall } from "./pnpm-install-check.js";

// Mirrors pnpm 12: the lock file starts with a document that locks pnpm itself.
const WANTED_LOCKFILE = `---
lockfileVersion: '9.0'

importers:
  .:
    packageManagerDependencies:
      pnpm:
        specifier: 12.21.0
        version: 12.21.0

packages:
  pnpm@12.21.0:
    resolution: {integrity: sha512-pnpm}

snapshots:
  pnpm@12.21.0: {}
---
lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      is-number:
        specifier: 7.0.0
        version: 7.0.0
    devDependencies:
      esbuild:
        specifier: 0.25.12
        version: 0.25.12

packages:
  '@esbuild/darwin-arm64@0.25.12':
    resolution: {integrity: sha512-darwin}
  '@esbuild/linux-x64@0.25.12':
    resolution: {integrity: sha512-linux}
  esbuild@0.25.12:
    resolution: {integrity: sha512-esbuild}
  is-number@7.0.0:
    resolution: {integrity: sha512-is-number}

snapshots:
  '@esbuild/darwin-arm64@0.25.12':
    optional: true
  '@esbuild/linux-x64@0.25.12':
    optional: true
  esbuild@0.25.12:
    optionalDependencies:
      '@esbuild/darwin-arm64': 0.25.12
      '@esbuild/linux-x64': 0.25.12
  is-number@7.0.0: {}
`;

function currentLockfile(snapshots: string[]): string {
  return `lockfileVersion: '9.0'

importers:
  .: {}

snapshots:
${snapshots.map((key) => `  '${key}': {}`).join("\n")}
`;
}

const ALL_INSTALLED = ["@esbuild/linux-x64@0.25.12", "esbuild@0.25.12", "is-number@7.0.0"];

describe("findIncompletePnpmInstall", () => {
  let projectDir: string;
  let lockFilePath: string;
  const storePath = "/home/runner/.local/share/pnpm/store/v11";

  function install({
    included = { dependencies: true, devDependencies: true, optionalDependencies: true },
    storeDir = storePath,
    installed = ALL_INSTALLED,
  } = {}): void {
    mkdirSync(join(projectDir, "node_modules", ".pnpm"), { recursive: true });
    writeFileSync(
      join(projectDir, "node_modules", ".modules.yaml"),
      JSON.stringify({
        included,
        skipped: ["@esbuild/darwin-arm64@0.25.12"],
        storeDir,
        virtualStoreDir: ".pnpm",
      }),
    );
    writeFileSync(
      join(projectDir, "node_modules", ".pnpm", "lock.yaml"),
      currentLockfile(installed),
    );
  }

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "setup-vp-install-check-"));
    lockFilePath = join(projectDir, "pnpm-lock.yaml");
    writeFileSync(lockFilePath, WANTED_LOCKFILE);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("accepts a complete install, counting packages skipped for other platforms", () => {
    install();

    expect(findIncompletePnpmInstall(lockFilePath, storePath)).toBeUndefined();
  });

  it("rejects a project without node_modules", () => {
    expect(findIncompletePnpmInstall(lockFilePath, storePath)).toBe(
      "node_modules has no pnpm install",
    );
  });

  it("rejects an install from another store", () => {
    install({ storeDir: "/Users/runner/Library/pnpm/store/v11" });

    expect(findIncompletePnpmInstall(lockFilePath, storePath)).toBe(
      "node_modules was installed from another store",
    );
  });

  it("rejects a production-only install", () => {
    install({
      included: { dependencies: true, devDependencies: false, optionalDependencies: true },
    });

    expect(findIncompletePnpmInstall(lockFilePath, storePath)).toBe(
      "the install skipped devDependencies",
    );
  });

  it("rejects a filtered install that left locked packages out", () => {
    install({ installed: ["is-number@7.0.0"] });

    expect(findIncompletePnpmInstall(lockFilePath, storePath)).toBe(
      "2 locked package(s) are not installed, such as @esbuild/linux-x64@0.25.12",
    );
  });

  it("rejects an install without the installed lock file", () => {
    install();
    rmSync(join(projectDir, "node_modules", ".pnpm", "lock.yaml"));

    expect(findIncompletePnpmInstall(lockFilePath, storePath)).toBe(
      "the lock file or the installed lock file could not be read",
    );
  });
});
