import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const bootstrapPath = fileURLToPath(new URL("../../gitlab/bootstrap.sh", import.meta.url));

describe("GitLab bootstrap", () => {
  it("has valid Bash syntax", () => {
    const result = spawnSync("bash", ["-n", bootstrapPath], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each([0, 23])("uses the image Node and preserves runtime exit code %i", (code) => {
    const fixture = mkdtempSync(join(tmpdir(), "setup-vp-bootstrap-"));
    const bin = join(fixture, "image bin");
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, "node"));
    writeFileSync(
      join(bin, "curl"),
      `#!/usr/bin/env bash
case "$6" in
  */test-ref/dist/gitlab/index.mjs) cp "$SETUP_VP_TEST_DIR/runtime.mjs" "$8" ;;
  *) exit 90 ;;
esac
`,
    );
    chmodSync(join(bin, "curl"), 0o755);
    writeFileSync(
      join(fixture, "runtime.mjs"),
      `console.log("runtime started:", process.execPath); process.exit(${code});`,
    );
    try {
      const result = spawnSync("bash", [bootstrapPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TMPDIR: fixture,
          SETUP_VP_TEST_DIR: fixture,
          SETUP_VP_SETUP_REF: "test-ref",
          SETUP_VP_NODE_MANAGER: "false",
        },
      });
      expect(result.status, result.stderr).toBe(code);
      expect(result.stdout).toContain(`runtime started: ${process.execPath}`);
      expect(
        readdirSync(fixture).filter((name) => name.startsWith("setup-vp-gitlab-runtime.")),
      ).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("uses the shared runtime on Windows and checks native command failures", () => {
    const bootstrap = readFileSync(new URL("../../gitlab/bootstrap.ps1", import.meta.url), "utf8");
    expect(bootstrap).toContain("Get-Command node");
    expect(bootstrap).toContain("/dist/gitlab/index.mjs");
    expect(bootstrap).toContain("& $runtimeNode $runtime");
    expect(bootstrap).toContain("$LASTEXITCODE -ne 0");
    expect(bootstrap).toContain("finally");
    expect(bootstrap).not.toContain("install.ps1");
  });
});
