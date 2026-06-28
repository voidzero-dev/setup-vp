import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVitePlusVersionFile } from "./viteplus-version-file.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
}));

describe("resolveVitePlusVersionFile", () => {
  let workspace: string;
  const originalEnv = process.env;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "setup-vp-version-file-"));
    process.env = { ...originalEnv, GITHUB_WORKSPACE: workspace };
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    process.env = originalEnv;
  });

  it("resolves vite-plus from package.json devDependencies", () => {
    writePackageJson("package.json", {
      devDependencies: {
        "vite-plus": "0.2.0",
      },
    });

    expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
  });

  it("resolves vite-plus from package.json dependencies", () => {
    writePackageJson("package.json", {
      dependencies: {
        "vite-plus": "^0.2.0",
      },
    });

    expect(resolveVitePlusVersionFile("package.json")).toBe("^0.2.0");
  });

  it("resolves relative version-file paths from working-directory", () => {
    mkdirSync(join(workspace, "docs"), { recursive: true });
    writePackageJson("docs/package.json", {
      devDependencies: {
        "vite-plus": "0.3.0",
      },
    });

    expect(resolveVitePlusVersionFile("package.json", join(workspace, "docs"))).toBe("0.3.0");
  });

  it("resolves vite-plus from the default pnpm catalog", () => {
    writePackageJson("package.json", {
      devDependencies: {
        "vite-plus": "catalog:",
      },
    });
    writeFileSync(
      join(workspace, "pnpm-workspace.yaml"),
      "packages:\n  - .\ncatalog:\n  vite-plus: 0.4.0\n",
    );

    expect(resolveVitePlusVersionFile("package.json")).toBe("0.4.0");
  });

  it("resolves vite-plus from a named pnpm catalog", () => {
    writePackageJson("package.json", {
      devDependencies: {
        "vite-plus": "catalog:ci",
      },
    });
    writeFileSync(
      join(workspace, "pnpm-workspace.yaml"),
      "packages:\n  - .\ncatalogs:\n  ci:\n    vite-plus: 0.5.0\n",
    );

    expect(resolveVitePlusVersionFile("package.json")).toBe("0.5.0");
  });

  it("finds pnpm-workspace.yaml above a package directory", () => {
    mkdirSync(join(workspace, "packages/app"), { recursive: true });
    writePackageJson("packages/app/package.json", {
      devDependencies: {
        "vite-plus": "catalog:",
      },
    });
    writeFileSync(
      join(workspace, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\ncatalog:\n  vite-plus: 0.6.0\n",
    );

    expect(resolveVitePlusVersionFile("package.json", join(workspace, "packages/app"))).toBe(
      "0.6.0",
    );
  });

  it("throws when package.json has no vite-plus dependency", () => {
    writePackageJson("package.json", {
      devDependencies: {
        typescript: "6.0.0",
      },
    });

    expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
      "No vite-plus dependency found in package.json",
    );
  });

  it("throws when catalog version cannot be resolved", () => {
    writePackageJson("package.json", {
      devDependencies: {
        "vite-plus": "catalog:",
      },
    });

    expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
      /pnpm-workspace\.yaml was not found/,
    );
  });

  it("throws on unsupported version-file names", () => {
    writeFileSync(join(workspace, "vite-plus.version"), "0.2.0\n");

    expect(() => resolveVitePlusVersionFile("vite-plus.version")).toThrow(
      "Unsupported version-file: vite-plus.version. Only package.json is supported.",
    );
  });

  it("throws on invalid package.json", () => {
    writeFileSync(join(workspace, "package.json"), "not json{");

    expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
      "Failed to parse package.json: invalid JSON",
    );
  });

  function writePackageJson(path: string, value: unknown): void {
    writeFileSync(join(workspace, path), JSON.stringify(value));
  }
});
