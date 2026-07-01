import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { resolveVitePlusVersionFile } from "./version-file.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

/**
 * Back the mocked fs with a simple path -> content map so both package.json and
 * pnpm-workspace.yaml reads (and the upward existsSync walk) resolve correctly.
 */
function mockFiles(files: Record<string, string>): void {
  vi.mocked(readFileSync).mockImplementation((path) => {
    const content = files[path as string];
    if (content === undefined) {
      throw new Error(`ENOENT: ${String(path)}`);
    }
    return content;
  });
  vi.mocked(existsSync).mockImplementation((path) => files[path as string] !== undefined);
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
        "Unsupported version-file: .nvmrc (expected package.json, pnpm-workspace.yaml, pnpm-workspace.yml, .yarnrc.yml)",
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

    it("should strip a leading v prefix", () => {
      mockFiles({
        "/workspace/package.json": JSON.stringify({ devDependencies: { "vite-plus": "v0.2.0" } }),
      });

      expect(resolveVitePlusVersionFile("package.json")).toBe("0.2.0");
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
});
