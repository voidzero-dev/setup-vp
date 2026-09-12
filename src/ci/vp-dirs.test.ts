import { describe, expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getInstallScriptCommand, parseVitePlusDirs, supportsVitePlusDirs } from "./vp-dirs.js";

describe("Vite+ directory resolution", () => {
  it("parses the machine-readable VpDirs output", () => {
    expect(
      parseVitePlusDirs(
        [
          "vp v0.3.0",
          "data\t/home/runner/.local/share/vite-plus",
          "bin\t/home/runner/.local/share/vite-plus/bin",
          "cache\t/home/runner/.cache/vite-plus",
          "config\t/home/runner/.config/vite-plus",
          "state\t/home/runner/.local/state/vite-plus",
        ].join("\n"),
      ),
    ).toEqual({
      data: "/home/runner/.local/share/vite-plus",
      bin: "/home/runner/.local/share/vite-plus/bin",
      cache: "/home/runner/.cache/vite-plus",
      config: "/home/runner/.config/vite-plus",
      state: "/home/runner/.local/state/vite-plus",
    });
  });

  it("rejects incomplete output from Vite+ releases without VpDirs", () => {
    expect(parseVitePlusDirs("vp v0.2.9\n")).toBeUndefined();
    expect(parseVitePlusDirs("data\t/data\nbin\t/bin\n")).toBeUndefined();
  });

  it.each([
    ["0.2.9", false],
    ["0.3.0-alpha.1", true],
    ["0.3.0", true],
    ["0.3.1-alpha.1", true],
    ["1.0.0", true],
    [`0.0.0-commit.${"a".repeat(40)}`, true],
    ["latest", true],
  ])("selects VpDirs detection for %s", (version, expected) => {
    expect(supportsVitePlusDirs(version)).toBe(expected);
  });

  it("dumps directories from the installer-resolved Unix shim", () => {
    const command = getInstallScriptCommand("https://example.com/install.sh", "linux");

    expect(command.command).toBe("bash");
    expect(command.args[1]).toContain('mktemp "${TMPDIR:-/tmp}/setup-vp-install.XXXXXX"');
    expect(command.args[1]).toContain('-o "$installer_file"');
    expect(command.args[1]).toContain('source "$installer_file"');
    expect(command.args[1]).not.toContain("source /dev/stdin");
    expect(command.args[1]).toContain('"$vp_dir/vp" --version');
    expect(command.args[1]).toContain('VP_DUMP_DIRS=1 "$vp_dir/vp"');
    expect(command.args[1]).toContain('>> "$SETUP_VP_DIRS_FILE"');
  });

  it.skipIf(process.platform === "win32").each([true, false])(
    "isolates inherited nounset and preserves installer failures (detectDirs: %s)",
    (detectDirs) => {
      const fixture = mkdtempSync(join(tmpdir(), "setup-vp-shell-options-"));
      const bin = join(fixture, "bin");
      const installer = join(fixture, "installer.sh");
      const dirsFile = join(fixture, "dirs");
      const continued = join(fixture, "continued");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "curl"),
        `#!/usr/bin/env bash
if [ "$#" -eq 8 ]; then
  cp "$SETUP_VP_TEST_INSTALLER" "$8"
else
  cat "$SETUP_VP_TEST_INSTALLER"
fi
`,
      );
      writeFileSync(
        join(bin, "vp"),
        `#!/usr/bin/env bash
if [ "\${VP_DUMP_DIRS:-}" = "1" ]; then
  printf 'data\\t/data\\nbin\\t/bin\\ncache\\t/cache\\nconfig\\t/config\\nstate\\t/state\\n'
else
  printf 'vp v0.3.0\\n'
fi
`,
      );
      chmodSync(join(bin, "curl"), 0o755);
      chmodSync(join(bin, "vp"), 0o755);
      const command = getInstallScriptCommand(
        "https://example.com/install.sh",
        "linux",
        detectDirs,
      );
      const runInstaller = () =>
        spawnSync(command.command, command.args, {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            SHELLOPTS: "nounset",
            SETUP_VP_DIRS_FILE: dirsFile,
            SETUP_VP_TEST_INSTALLER: installer,
            SETUP_VP_TEST_SHIM_DIR: bin,
            SETUP_VP_TEST_CONTINUED: continued,
          },
        });

      try {
        writeFileSync(
          installer,
          `set -e
setup_vp_test_optional() { local optional="$4"; }
setup_vp_test_optional one two three
SHIM_DIR="$SETUP_VP_TEST_SHIM_DIR"
printf 'installer completed\\n'
`,
        );
        const success = runInstaller();
        expect(success.status, success.stderr).toBe(0);
        expect(success.stderr).toBe("");
        expect(success.stdout).toContain("installer completed");
        if (detectDirs) {
          expect(parseVitePlusDirs(readFileSync(dirsFile, "utf8"))?.bin).toBe("/bin");
        }

        writeFileSync(installer, "exit 23\n");
        expect(runInstaller().status).toBe(23);
        if (detectDirs) {
          writeFileSync(installer, "return 23\n");
          expect(runInstaller().status).toBe(23);
        }

        writeFileSync(installer, 'set -e\nfalse\nprintf continued > "$SETUP_VP_TEST_CONTINUED"\n');
        expect(runInstaller().status).not.toBe(0);
        expect(existsSync(continued)).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it("dumps directories from the installer-resolved Windows shim", () => {
    const command = getInstallScriptCommand("https://example.com/install.ps1", "win32");

    expect(command.command).toBe("pwsh");
    expect(command.args[1]).toContain(". ([scriptblock]::Create");
    expect(command.args[1]).toContain("Join-Path $vpDir 'vp.exe'");
    expect(command.args[1]).toContain("& $vpPath --version");
    expect(command.args[1]).toContain("$env:VP_DUMP_DIRS = '1'");
    expect(command.args[1]).toContain("Set-Content -LiteralPath $dirsFile -Encoding UTF8");
    expect(command.args[1]).toContain("Add-Content -LiteralPath $dirsFile -Encoding UTF8");
  });

  it.each([
    ["linux" as const, "install.sh", "| bash"],
    ["win32" as const, "install.ps1", "& ([scriptblock]::Create"],
  ])(
    "uses the legacy %s installer command when detection is disabled",
    (platform, name, marker) => {
      const command = getInstallScriptCommand(`https://example.com/${name}`, platform, false);

      expect(command.args[1]).toContain(marker);
      expect(command.args[1]).not.toContain("VP_DUMP_DIRS");
      expect(command.args[1]).not.toContain("SETUP_VP_DIRS_FILE");
    },
  );
});
