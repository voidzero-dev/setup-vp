import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { resolveNodeVersionFile } from "./node-version-file.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("resolveNodeVersionFile", () => {
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
      vi.mocked(readFileSync).mockReturnValue("20.0.0\n");

      resolveNodeVersionFile(".nvmrc");

      expect(readFileSync).toHaveBeenCalledWith("/workspace/.nvmrc", "utf-8");
    });

    it("should use absolute path as-is", () => {
      vi.mocked(readFileSync).mockReturnValue("20.0.0\n");

      resolveNodeVersionFile("/custom/path/.nvmrc");

      expect(readFileSync).toHaveBeenCalledWith("/custom/path/.nvmrc", "utf-8");
    });

    it("should throw if file does not exist", () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      expect(() => resolveNodeVersionFile(".nvmrc")).toThrow(
        "node-version-file not found: /workspace/.nvmrc",
      );
    });
  });

  describe(".nvmrc / .node-version", () => {
    it("should parse plain version", () => {
      vi.mocked(readFileSync).mockReturnValue("20.11.0\n");

      expect(resolveNodeVersionFile(".nvmrc")).toBe("20.11.0");
    });

    it("should strip v prefix", () => {
      vi.mocked(readFileSync).mockReturnValue("v22.1.0\n");

      expect(resolveNodeVersionFile(".node-version")).toBe("22.1.0");
    });

    it("should skip comments and empty lines", () => {
      vi.mocked(readFileSync).mockReturnValue("# use latest LTS\n\n18.19.0\n");

      expect(resolveNodeVersionFile(".nvmrc")).toBe("18.19.0");
    });

    it("should preserve lts/* alias", () => {
      vi.mocked(readFileSync).mockReturnValue("lts/*\n");

      expect(resolveNodeVersionFile(".nvmrc")).toBe("lts/*");
    });

    it("should normalize 'node' alias to latest", () => {
      vi.mocked(readFileSync).mockReturnValue("node\n");

      expect(resolveNodeVersionFile(".nvmrc")).toBe("latest");
    });

    it("should normalize 'stable' alias to latest", () => {
      vi.mocked(readFileSync).mockReturnValue("stable\n");

      expect(resolveNodeVersionFile(".nvmrc")).toBe("latest");
    });

    it("should strip inline comments", () => {
      vi.mocked(readFileSync).mockReturnValue("20.11.0 # LTS version\n");

      expect(resolveNodeVersionFile(".nvmrc")).toBe("20.11.0");
    });

    it("should throw on empty file", () => {
      vi.mocked(readFileSync).mockReturnValue("\n\n");

      expect(() => resolveNodeVersionFile(".nvmrc")).toThrow("No Node.js version found in .nvmrc");
    });
  });

  describe(".tool-versions", () => {
    it("should parse nodejs entry", () => {
      vi.mocked(readFileSync).mockReturnValue("python 3.11.0\nnodejs 20.11.0\nruby 3.2.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("20.11.0");
    });

    it("should parse node entry", () => {
      vi.mocked(readFileSync).mockReturnValue("node 22.0.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("22.0.0");
    });

    it("should strip v prefix from tool-versions", () => {
      vi.mocked(readFileSync).mockReturnValue("nodejs v20.11.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("20.11.0");
    });

    it("should skip 'system' and use fallback version", () => {
      vi.mocked(readFileSync).mockReturnValue("nodejs system 20.11.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("20.11.0");
    });

    it("should skip ref: and path: specs", () => {
      vi.mocked(readFileSync).mockReturnValue("nodejs ref:v1.0.2 path:/opt/node 22.0.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("22.0.0");
    });

    it("should use first installable version from multiple fallbacks", () => {
      vi.mocked(readFileSync).mockReturnValue("nodejs 20.11.0 18.19.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("20.11.0");
    });

    it("should throw when only non-installable specs present", () => {
      vi.mocked(readFileSync).mockReturnValue("nodejs system\n");

      expect(() => resolveNodeVersionFile(".tool-versions")).toThrow(
        "No Node.js version found in .tool-versions",
      );
    });

    it("should throw if no node entry found", () => {
      vi.mocked(readFileSync).mockReturnValue("python 3.11.0\nruby 3.2.0\n");

      expect(() => resolveNodeVersionFile(".tool-versions")).toThrow(
        "No Node.js version found in .tool-versions",
      );
    });

    it("should skip comments in .tool-versions", () => {
      vi.mocked(readFileSync).mockReturnValue("# tools\n\nnodejs 20.0.0\n");

      expect(resolveNodeVersionFile(".tool-versions")).toBe("20.0.0");
    });
  });

  describe("package.json", () => {
    it("should read devEngines.runtime with name node", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          devEngines: { runtime: { name: "node", version: "^20.0.0" } },
        }),
      );

      expect(resolveNodeVersionFile("package.json")).toBe("^20.0.0");
    });

    it("should read devEngines.runtime from array", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          devEngines: {
            runtime: [
              { name: "bun", version: "^1.0.0" },
              { name: "node", version: "^22.0.0" },
            ],
          },
        }),
      );

      expect(resolveNodeVersionFile("package.json")).toBe("^22.0.0");
    });

    it("should read engines.node", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ engines: { node: ">=18" } }));

      expect(resolveNodeVersionFile("package.json")).toBe(">=18");
    });

    it("should prefer devEngines.runtime over engines.node", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          devEngines: { runtime: { name: "node", version: "22.0.0" } },
          engines: { node: ">=18" },
        }),
      );

      expect(resolveNodeVersionFile("package.json")).toBe("22.0.0");
    });

    it("should fall back to engines.node when devEngines has no node runtime", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          devEngines: { runtime: { name: "bun", version: "^1.0.0" } },
          engines: { node: ">=20" },
        }),
      );

      expect(resolveNodeVersionFile("package.json")).toBe(">=20");
    });

    it("should throw if no node version found", () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: "test" }));

      expect(() => resolveNodeVersionFile("package.json")).toThrow(
        "No Node.js version found in package.json",
      );
    });

    it("should strip v prefix from devEngines.runtime version", () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          devEngines: { runtime: { name: "node", version: "v20.11.0" } },
        }),
      );

      expect(resolveNodeVersionFile("package.json")).toBe("20.11.0");
    });

    it("should throw on invalid JSON", () => {
      vi.mocked(readFileSync).mockReturnValue("not json{");

      expect(() => resolveNodeVersionFile("package.json")).toThrow(
        "Failed to parse package.json: invalid JSON",
      );
    });
  });
});
