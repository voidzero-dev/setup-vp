import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import {
  resolveVitePlusVersionFile,
  tryResolveVitePlusVersionFromProject,
} from "./version-file.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

/**
 * Back the mocked fs with a simple path -> content map. Resolution reads files
 * directly and treats a read failure as "missing", so the walk resolves against
 * this map with no separate existence check.
 */
function mockFiles(files: Record<string, string>): void {
  vi.mocked(readFileSync).mockImplementation((path) => {
    const content = files[path as string];
    if (content === undefined) {
      throw new Error(`ENOENT: ${String(path)}`);
    }
    return content;
  });
}

describe("resolveVitePlusVersionFile", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, GITHUB_WORKSPACE: "/workspace" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("path resolution", () => {
    it("should resolve relative path against GITHUB_WORKSPACE", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "0.2.0" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
      expect(readFileSync).toHaveBeenCalledWith("/workspace/package.json", "utf-8");
    });

    it("should use absolute path as-is", () => {
      mockFiles({
        "/custom/package.json": JSON.stringify({ devDependencies: { "vite-plus": "0.2.0" } }),
      });

      expect(resolveVitePlusVersionFile("/custom/package.json")).toBe("0.2.0");
    });

    it("should resolve relative path against an explicit base directory", () => {
      mockFiles({
        "/workspace/web/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "0.3.0" },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json", "/workspace/web")).toBe("0.3.0");
    });

    it("should throw if the file does not exist", () => {
      mockFiles({});

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        "version-file not found: /workspace/package.json",
      );
    });

    it("should throw on an unsupported file", () => {
      mockFiles({ "/workspace/.nvmrc": "20\n" });

      expect(() => resolveVitePlusVersionFile(".nvmrc")).toThrow(
        "Unsupported version-file: .nvmrc (expected package.json, pnpm-workspace.yaml, .yarnrc.yml)",
      );
    });
  });

  describe("package.json direct spec", () => {
    it("should read a plain version from devDependencies", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "0.2.0" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
    });

    it("should read from dependencies", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ dependencies: { "vite-plus": "0.2.1" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.1");
    });

    it("should prefer dependencies over devDependencies", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          dependencies: { "vite-plus": "0.3.0" },
          devDependencies: { "vite-plus": "0.2.0" },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.3.0");
    });

    it("should read from optionalDependencies", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          optionalDependencies: { "vite-plus": "0.4.0" },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.4.0");
    });

    it("should strip a leading v prefix from a version", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "v0.2.0" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
    });

    it("should preserve a v-prefixed dist-tag (only strip v before a digit)", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "vnext" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("vnext");
    });

    it("should preserve a capitalized V-prefixed dist-tag (v-strip is case-sensitive)", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "V2beta" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("V2beta");
    });

    it.each([
      "^0.2.0",
      "~0.2.0",
      ">=0.2.0",
      "0.2.0 || 0.3.0",
      "*",
      // Marker-less ranges: partial versions and x-ranges npm treats as ranges
      // but the registry can't resolve to a single version.
      "0.2",
      "1",
      "0.2.x",
      "1.x",
    ])("should reject the non-exact range spec %s", (range) => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": range } }),
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        /requires an exact version or dist-tag/,
      );
    });

    it("should accept a plain dist-tag", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "next" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("next");
    });

    it("should reject a non-registry alias spec (npm:)", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "npm:vite-plus@0.2.0" },
        }),
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        /requires an exact version or dist-tag/,
      );
    });

    it("should throw when no vite-plus entry is present", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { vite: "6.0.0" } }),
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        "No vite-plus version found in package.json",
      );
    });

    it("should throw on invalid JSON", () => {
      mockFiles({ "/workspace/package.json": "not json{" });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        "Failed to parse package.json: invalid JSON",
      );
    });

    it("should throw for a workspace: protocol spec", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "workspace:*" },
        }),
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        'Cannot resolve "workspace:*" for vite-plus: the workspace protocol has no published version',
      );
    });
  });

  describe("package.json catalog resolution", () => {
    it("should resolve catalog: through the default catalog", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n",
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
    });

    it("should resolve catalog:default through the default catalog", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "catalog:default" },
        }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n",
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
    });

    it("should resolve catalog: through catalogs.default", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
        "/workspace/pnpm-workspace.yaml": "catalogs:\n  default:\n    vite-plus: 0.2.5\n",
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.5");
    });

    it("should resolve a named catalog", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "catalog:edge" },
        }),
        "/workspace/pnpm-workspace.yaml": "catalogs:\n  edge:\n    vite-plus: 0.3.0-beta.1\n",
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.3.0-beta.1");
    });

    it("should find pnpm-workspace.yaml in a parent directory", () => {
      mockFiles({
        "/workspace/packages/app/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "catalog:" },
        }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n",
      });

      expect(resolveVitePlusVersionFile("package.json", "/workspace/packages/app")).toBe("0.2.0");
    });

    it("should throw when no catalog source is found", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        /Could not resolve "catalog:" for vite-plus: no matching catalog entry found/,
      );
    });

    it("should preserve trailing precision of an unquoted numeric catalog version", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
        // Unquoted `1.10` would coerce to the number 1.1 under YAML's core schema.
        // It is a partial version (rejected), but the error must show the exact
        // "1.10" the user wrote, proving the failsafe parse kept its precision.
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 1.10\n",
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(/Cannot use "1\.10"/);
    });

    it("should skip a malformed catalog entry and keep walking to a valid ancestor", () => {
      mockFiles({
        // Nearer catalog nests the entry as an object (malformed).
        "/workspace/packages/app/pnpm-workspace.yaml":
          "catalog:\n  vite-plus:\n    version: 0.2.0\n",
        "/workspace/packages/app/package.json": JSON.stringify({
          dependencies: { "vite-plus": "catalog:" },
        }),
        // Valid entry lives further up.
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.9.0\n",
      });

      expect(resolveVitePlusVersionFile("package.json", "/workspace/packages/app")).toBe("0.9.0");
    });

    it("should not resolve a catalog located outside the workspace root", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ dependencies: { "vite-plus": "catalog:" } }),
        // Catalog outside GITHUB_WORKSPACE must not leak in.
        "/pnpm-workspace.yaml": "catalog:\n  vite-plus: 9.9.9\n",
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        /Could not resolve "catalog:" for vite-plus: no matching catalog entry found/,
      );
    });

    it("should not walk above the manifest dir when it is outside the workspace", () => {
      mockFiles({
        "/outside/project/package.json": JSON.stringify({
          dependencies: { "vite-plus": "catalog:" },
        }),
        // An unrelated catalog above an out-of-workspace manifest (e.g. a
        // self-hosted runner's home dir) must not be walked into.
        "/outside/pnpm-workspace.yaml": "catalog:\n  vite-plus: 9.9.9\n",
      });

      expect(() => resolveVitePlusVersionFile("package.json", "/outside/project")).toThrow(
        /Could not resolve "catalog:" for vite-plus: no matching catalog entry found/,
      );
    });

    it("should resolve a catalog in the manifest's own dir even outside the workspace", () => {
      mockFiles({
        "/outside/project/package.json": JSON.stringify({
          dependencies: { "vite-plus": "catalog:" },
        }),
        "/outside/project/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.4.2\n",
      });

      expect(resolveVitePlusVersionFile("package.json", "/outside/project")).toBe("0.4.2");
    });

    it("should throw when the catalog has no vite-plus entry", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  react: 18.0.0\n",
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        /Could not resolve "catalog:" for vite-plus: no matching catalog entry found/,
      );
    });

    it("should throw when a named catalog is missing", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "catalog:edge" },
        }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n",
      });

      expect(() => resolveVitePlusVersionFile("package.json")).toThrow(
        /Could not resolve "catalog:edge" for vite-plus: no matching catalog entry found/,
      );
    });
  });

  describe("yarn catalog resolution (.yarnrc.yml)", () => {
    it("should resolve catalog: through the yarn default catalog", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
        "/workspace/.yarnrc.yml": "catalog:\n  vite-plus: 0.6.0\n",
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.6.0");
    });

    it("should resolve a named yarn catalog", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "catalog:edge" },
        }),
        "/workspace/.yarnrc.yml":
          "catalog:\n  react: ^18\ncatalogs:\n  edge:\n    vite-plus: 0.7.0\n",
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.7.0");
    });

    it("should read the default catalog directly from .yarnrc.yml", () => {
      mockFiles({
        "/workspace/.yarnrc.yml": "catalog:\n  vite-plus: 0.6.0\n",
      });

      expect(resolveVitePlusVersionFile(".yarnrc.yml")).toBe("0.6.0");
    });
  });

  describe("bun catalog resolution (root package.json)", () => {
    it("should resolve catalog: from a top-level catalog", () => {
      mockFiles({
        "/workspace/packages/app/package.json": JSON.stringify({
          dependencies: { "vite-plus": "catalog:" },
        }),
        "/workspace/package.json": JSON.stringify({
          workspaces: ["packages/*"],
          catalog: { "vite-plus": "0.5.1" },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json", "/workspace/packages/app")).toBe("0.5.1");
    });

    it("should resolve catalog: from catalog nested under workspaces", () => {
      mockFiles({
        "/workspace/packages/app/package.json": JSON.stringify({
          dependencies: { "vite-plus": "catalog:" },
        }),
        "/workspace/package.json": JSON.stringify({
          workspaces: { packages: ["packages/*"], catalog: { "vite-plus": "0.5.0" } },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json", "/workspace/packages/app")).toBe("0.5.0");
    });

    it("should resolve a named bun catalog under workspaces", () => {
      mockFiles({
        "/workspace/packages/app/package.json": JSON.stringify({
          devDependencies: { "vite-plus": "catalog:tools" },
        }),
        "/workspace/package.json": JSON.stringify({
          workspaces: {
            packages: ["packages/*"],
            catalogs: { tools: { "vite-plus": "0.5.2" } },
          },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json", "/workspace/packages/app")).toBe("0.5.2");
    });

    it("should resolve from a directly-targeted root package.json's own top-level catalog", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          workspaces: ["packages/*"],
          catalog: { "vite-plus": "0.5.3" },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.5.3");
    });

    it("should resolve from a directly-targeted root package.json catalog under workspaces", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({
          workspaces: { packages: ["packages/*"], catalog: { "vite-plus": "0.5.4" } },
        }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.5.4");
    });

    it("should prefer a pnpm-workspace.yaml catalog over an ancestor package.json catalog", () => {
      mockFiles({
        "/workspace/packages/app/package.json": JSON.stringify({
          dependencies: { "vite-plus": "catalog:" },
        }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n",
        "/workspace/package.json": JSON.stringify({
          workspaces: ["packages/*"],
          catalog: { "vite-plus": "9.9.9" },
        }),
      });

      // Same directory: the YAML source is checked before package.json.
      expect(resolveVitePlusVersionFile("package.json", "/workspace/packages/app")).toBe("0.2.0");
    });
  });

  describe("pnpm-workspace.yaml as version-file", () => {
    it("should read the default catalog entry directly", () => {
      mockFiles({
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n",
      });

      expect(resolveVitePlusVersionFile("pnpm-workspace.yaml")).toBe("0.2.0");
    });

    it("should throw on invalid YAML", () => {
      mockFiles({
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.0\n : : :\n",
      });

      expect(() => resolveVitePlusVersionFile("pnpm-workspace.yaml")).toThrow(
        /Failed to parse pnpm-workspace\.yaml: invalid YAML/,
      );
    });
  });

  describe("tryResolveVitePlusVersionFromProject (auto-detect default)", () => {
    it("returns the version from the project's package.json", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "0.2.0" } }),
      });

      expect(tryResolveVitePlusVersionFromProject("/workspace")).toBe("0.2.0");
    });

    it("resolves a catalog entry from the project", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
        "/workspace/pnpm-workspace.yaml": "catalog:\n  vite-plus: 0.2.5\n",
      });

      expect(tryResolveVitePlusVersionFromProject("/workspace")).toBe("0.2.5");
    });

    it("returns undefined when package.json is missing", () => {
      mockFiles({});

      expect(tryResolveVitePlusVersionFromProject("/workspace")).toBeUndefined();
    });

    it("returns undefined when vite-plus is not a dependency", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { vite: "6.0.0" } }),
      });

      expect(tryResolveVitePlusVersionFromProject("/workspace")).toBeUndefined();
    });

    it("returns undefined for a non-exact range so the caller falls back to latest", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "^0.2.0" } }),
      });

      expect(tryResolveVitePlusVersionFromProject("/workspace")).toBeUndefined();
    });
  });
});
