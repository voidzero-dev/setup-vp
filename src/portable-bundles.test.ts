import { describe, it, expect } from "vite-plus/test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
const azureDist = `${distRoot}/azure/index.mjs`;
const gitlabDist = `${distRoot}/gitlab/index.mjs`;
const actionDist = `${distRoot}/index.mjs`;

describe("portable CI bundles", () => {
  it("builds azure and gitlab bundles without @actions imports", () => {
    expect(existsSync(azureDist)).toBe(true);
    expect(existsSync(gitlabDist)).toBe(true);
    const azure = readFileSync(azureDist, "utf8");
    const gitlab = readFileSync(gitlabDist, "utf8");
    expect(azure).not.toContain("@actions/");
    expect(gitlab).not.toContain("@actions/");
    expect(readFileSync(actionDist, "utf8")).toContain("@actions/");
  });

  it("fails invalid azure phase with a controlled message", () => {
    const result = spawnSync(process.execPath, [azureDist, "invalid-phase"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid phase "invalid-phase"');
  });
});
