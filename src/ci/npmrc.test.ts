import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readNpmrc } from "./npmrc.js";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));

afterEach(() => vi.resetAllMocks());

describe("readNpmrc", () => {
  it.each(["", "registry=https://registry.example/\r\n# Keep comments\n"])(
    "reads UTF-8 content without changing it: %j",
    (content) => {
      vi.mocked(readFileSync).mockReturnValue(content);

      expect(readNpmrc("project/.npmrc")).toBe(content);
      expect(readFileSync).toHaveBeenCalledWith("project/.npmrc", "utf8");
    },
  );

  it("returns an empty string when the file is missing", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("File not found"), { code: "ENOENT" });
    });

    expect(readNpmrc("project/.npmrc")).toBe("");
  });

  it.each(["EACCES", "EISDIR"])("propagates %s errors", (code) => {
    const error = Object.assign(new Error("Cannot read .npmrc"), { code });
    vi.mocked(readFileSync).mockImplementation(() => {
      throw error;
    });

    expect(() => readNpmrc("project/.npmrc")).toThrow(error);
  });
});
