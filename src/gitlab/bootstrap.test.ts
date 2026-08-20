import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it.each([
    ["current", "vp v0.2.9\n", "0.2.9"],
    ["legacy", "- Global: v0.1.20\n- Local: v0.1.20\n", "0.1.20"],
  ])("parses the %s installed version format with portable awk", (_format, input, expected) => {
    const script = `
${readShellFunction("setup_vp_read_installed_version")}
setup_vp_read_installed_version /dev/stdin
`;
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8", input });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
    expect(result.stderr).toBe("");
  });

  it("isolates the sourced installer's shell options and preserves its status", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "setup-vp-install-and-dump-dirs-"));
    const shimDir = join(fixtureDir, "bin");
    const vp = join(shimDir, "vp");
    const dirsFile = join(fixtureDir, "dirs");
    const continuedFile = join(fixtureDir, "continued");
    const successInstaller = join(fixtureDir, "success.sh");
    const failureInstaller = join(fixtureDir, "failure.sh");
    const errexitInstaller = join(fixtureDir, "errexit.sh");
    mkdirSync(shimDir);
    writeFileSync(
      vp,
      `#!/usr/bin/env bash
if [ "\${VP_DUMP_DIRS:-}" = "1" ]; then
  printf 'data\\t/data\\nbin\\t/bin\\ncache\\t/cache\\nconfig\\t/config\\nstate\\t/state\\n'
else
  printf 'vp v0.3.0\\n'
fi
`,
    );
    chmodSync(vp, 0o755);
    writeFileSync(
      successInstaller,
      `set -e
setup_vp_test_optional() { local optional="$4"; }
setup_vp_test_optional one two three
SHIM_DIR="$SETUP_VP_TEST_SHIM_DIR"
`,
    );
    writeFileSync(failureInstaller, "return 23\n");
    writeFileSync(errexitInstaller, `set -e\nfalse\nprintf continued > "$continuedFile"\n`);

    try {
      const script = `
set -u
export SHELLOPTS
${readShellFunction("setup_vp_install_and_dump_dirs")}
export SETUP_VP_TEST_SHIM_DIR="$1"
setup_vp_install_and_dump_dirs "$2" "$3"
case "$-" in *u*) ;; *) exit 91 ;; esac
setup_vp_test_status=0
setup_vp_install_and_dump_dirs "$4" "$3" || setup_vp_test_status=$?
[ "$setup_vp_test_status" -eq 23 ]
case "$-" in *u*) ;; *) exit 92 ;; esac
setup_vp_test_status=0
if setup_vp_install_and_dump_dirs "$5" "$3"; then
  setup_vp_test_status=0
else
  setup_vp_test_status=$?
fi
[ "$setup_vp_test_status" -ne 0 ]
`;
      const result = spawnSync(
        "bash",
        [
          "-c",
          script,
          "bash",
          shimDir,
          successInstaller,
          dirsFile,
          failureInstaller,
          errexitInstaller,
        ],
        { encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(readFileSync(dirsFile, "utf8")).toBe(
        "vp v0.3.0\ndata\t/data\nbin\t/bin\ncache\t/cache\nconfig\t/config\nstate\t/state\n",
      );
      expect(() => readFileSync(continuedFile)).toThrow();
    } finally {
      rmSync(fixtureDir, { force: true, recursive: true });
    }
  });
});
