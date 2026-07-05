import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { resolveProjectDir } from "./utils.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-vp-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveProjectDir", () => {
  it("resolves relative working directories from CI_PROJECT_DIR", () => {
    const root = tempDir();
    mkdirSync(path.join(root, "web"));

    expect(
      resolveProjectDir({
        CI_PROJECT_DIR: root,
        SETUP_VP_WORKING_DIRECTORY: "web",
      }),
    ).toBe(path.join(root, "web"));
  });

  it("resolves absolute working directories", () => {
    const root = tempDir();
    expect(resolveProjectDir({ SETUP_VP_WORKING_DIRECTORY: root })).toBe(root);
  });

  it("rejects missing and file working directories", () => {
    const root = tempDir();
    const file = path.join(root, "package.json");
    writeFileSync(file, "{}", "utf8");

    expect(() =>
      resolveProjectDir({
        CI_PROJECT_DIR: root,
        SETUP_VP_WORKING_DIRECTORY: "missing",
      }),
    ).toThrow("working-directory not found");
    expect(() =>
      resolveProjectDir({
        CI_PROJECT_DIR: root,
        SETUP_VP_WORKING_DIRECTORY: "package.json",
      }),
    ).toThrow("working-directory is not a directory");
  });
});
