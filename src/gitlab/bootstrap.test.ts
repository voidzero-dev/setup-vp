import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const bootstrapPath = fileURLToPath(new URL("../../gitlab/bootstrap.sh", import.meta.url));
const bootstrap = readFileSync(bootstrapPath, "utf8");

describe("GitLab bootstrap", () => {
  it("has valid Bash syntax", () => {
    const result = spawnSync("bash", ["-n", bootstrapPath], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("uses the bin directory reported by the installed payload", () => {
    expect(bootstrap).toContain('export VP_VPDIRS_AWARE="1"');
    expect(bootstrap).toContain('VP_DUMP_DIRS=1 "$SHIM_DIR/vp"');
    expect(bootstrap).toContain('setup_vp_bin_dir="$(setup_vp_read_bin_dir "$setup_vp_dirs_tmp")"');
    expect(bootstrap).toContain('export PATH="$setup_vp_bin_dir:$PATH"');
  });

  it("fails when a VpDirs-aware install does not report valid directories", () => {
    for (const name of ["data", "bin", "cache", "config", "state"]) {
      expect(bootstrap).toContain(`if (key == "${name}") ${name} = value`);
    }
    expect(bootstrap).toContain(
      "Vite+ was installed successfully, but setup-vp could not resolve its VpDirs.",
    );
    expect(bootstrap).toContain("return 1 2>/dev/null || exit 1");
  });

  it("limits VpDirs detection to supported versions", () => {
    expect(bootstrap).toContain('setup_vp_detect_dirs="true"');
    expect(bootstrap).toContain('[ "$setup_vp_minor" -lt 3 ]');
    expect(bootstrap).toContain('if [ "$setup_vp_detect_dirs" = "true" ]; then');
    expect(bootstrap).toContain('bash "$setup_vp_install_tmp"');
  });

  it("preserves a sourced installer's failure status", () => {
    expect(bootstrap).toContain('. "$setup_vp_install_tmp" || return $?');
  });
});
