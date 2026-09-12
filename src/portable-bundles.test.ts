import { describe, it, expect } from "vite-plus/test";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
const azureDist = `${distRoot}/azure/index.mjs`;
const gitlabDist = `${distRoot}/gitlab/index.mjs`;
const actionDist = `${distRoot}/index.mjs`;

describe("portable CI bundles", () => {
  it("fails invalid GitLab phases without attempting installation", () => {
    const result = spawnSync(process.execPath, [gitlabDist, "invalid-phase"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid GitLab phase: invalid-phase");
  });

  it("runs the GitLab post-job cache phase from the standalone bundle", () => {
    const root = mkdtempSync(path.join(tmpdir(), "setup-vp-bundle-cache-"));
    const store = path.join(root, "store");
    const lockFile = path.join(root, "package-lock.json");
    mkdirSync(store);
    writeFileSync(path.join(store, "package"), "post-job package");
    writeFileSync(lockFile, "{}");
    writeFileSync(
      path.join(root, ".setup-vp-cache-state.json"),
      JSON.stringify({
        ready: true,
        cachePath: store,
        lockFile,
        lockType: "npm",
      }),
    );
    try {
      const result = spawnSync(process.execPath, [gitlabDist, "save-cache"], {
        env: { ...process.env, CI_PROJECT_DIR: root },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(
        readFileSync(
          path.join(
            root,
            ".setup-vp-cache",
            process.platform,
            process.arch,
            "npm",
            "packages",
            "package",
          ),
          "utf8",
        ),
      ).toBe("post-job package");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("builds azure and gitlab bundles without @actions imports", () => {
    expect(existsSync(azureDist)).toBe(true);
    expect(existsSync(gitlabDist)).toBe(true);
    const azure = readFileSync(azureDist, "utf8");
    const gitlab = readFileSync(gitlabDist, "utf8");
    expect(azure).not.toContain("@actions/");
    expect(gitlab).not.toContain("@actions/");
    expect(azure).not.toMatch(/\bfrom["']\.\.\//);
    expect(gitlab).not.toMatch(/\bfrom["']\.\.\//);
    expect(readFileSync(actionDist, "utf8")).toContain("@actions/");
  });

  it("fails invalid azure phase with a controlled message", () => {
    const result = spawnSync(process.execPath, [azureDist, "invalid-phase"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid phase "invalid-phase"');
  }, 15_000);
});
