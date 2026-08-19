import { describe, expect, it } from "vite-plus/test";
import { getInstallScriptCommand, parseVitePlusDirs } from "./vp-dirs.js";

describe("Vite+ directory resolution", () => {
  it("parses the machine-readable VpDirs output", () => {
    expect(
      parseVitePlusDirs(
        [
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

  it("dumps directories from the installer-resolved Unix shim", () => {
    const command = getInstallScriptCommand("https://example.com/install.sh", "linux");

    expect(command.command).toBe("bash");
    expect(command.args[1]).toContain("source /dev/stdin");
    expect(command.args[1]).toContain('VP_DUMP_DIRS=1 "$SHIM_DIR/vp"');
    expect(command.args[1]).toContain('> "$SETUP_VP_DIRS_FILE"');
  });

  it("dumps directories from the installer-resolved Windows shim", () => {
    const command = getInstallScriptCommand("https://example.com/install.ps1", "win32");

    expect(command.command).toBe("pwsh");
    expect(command.args[1]).toContain(". ([scriptblock]::Create");
    expect(command.args[1]).toContain("Join-Path $script:ShimDir 'vp.exe'");
    expect(command.args[1]).toContain("$env:VP_DUMP_DIRS = '1'");
  });
});
