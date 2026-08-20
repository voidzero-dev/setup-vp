import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const bootstrapPath = fileURLToPath(new URL("../../gitlab/bootstrap.sh", import.meta.url));
const bootstrap = readFileSync(bootstrapPath, "utf8");

function readShellFunction(name: string): string {
  const start = bootstrap.indexOf(`${name}() {`);
  const end = bootstrap.indexOf("\n}\n", start);
  if (start < 0 || end < 0) throw new Error(`Could not find ${name} in the GitLab bootstrap`);
  return bootstrap.slice(start, end + 2);
}

describe("GitLab bootstrap", () => {
  it("has valid Bash syntax", () => {
    const result = spawnSync("bash", ["-n", bootstrapPath], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("uses the bin directory reported by the installed payload", () => {
    expect(bootstrap).toContain('export VP_VPDIRS_AWARE="1"');
    expect(bootstrap).toContain('"$setup_vp_shim_dir/vp" --version');
    expect(bootstrap).toContain('VP_DUMP_DIRS=1 "$setup_vp_shim_dir/vp"');
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

  it("checks the installed version for dist-tags", () => {
    expect(bootstrap).toContain('setup_vp_check_installed_version="true"');
    expect(bootstrap).toContain(
      'setup_vp_installed_version="$(setup_vp_read_installed_version "$setup_vp_dirs_tmp")"',
    );
    expect(bootstrap).toContain('[ "$setup_vp_minor" -lt 3 ]');
  });

  it("disables and restores nounset while it preserves the installer status", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "setup-vp-source-installer-"));
    const successInstaller = join(fixtureDir, "success.sh");
    const failureInstaller = join(fixtureDir, "failure.sh");
    writeFileSync(
      successInstaller,
      'setup_vp_test_optional() { local optional="$4"; }\nsetup_vp_test_optional one two three\nsetup_vp_test_marker="loaded"\n',
    );
    writeFileSync(failureInstaller, "return 23\n");

    try {
      const script = `
set -u
${readShellFunction("setup_vp_source_installer")}
setup_vp_source_installer "$1"
[ "$setup_vp_test_marker" = "loaded" ]
case "$-" in *u*) ;; *) exit 91 ;; esac
setup_vp_test_status=0
setup_vp_source_installer "$2" || setup_vp_test_status=$?
[ "$setup_vp_test_status" -eq 23 ]
case "$-" in *u*) ;; *) exit 92 ;; esac
`;
      const result = spawnSync("bash", ["-c", script, "bash", successInstaller, failureInstaller], {
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(fixtureDir, { force: true, recursive: true });
    }
  });
});
