import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { getInstallScriptCommand } from "./vp-dirs.js";

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");
const windows = process.platform === "win32";
const shells = windows ? ["pwsh", "powershell.exe"] : ["bash"];

describe("installer integrity", () => {
  it.each(["", "a".repeat(63), "g".repeat(64)])("rejects invalid checksum %j", (checksum) => {
    expect(() =>
      getInstallScriptCommand({ url: "https://example.invalid/install.sh", sha256: checksum }),
    ).toThrow("trusted SHA-256");
  });

  it.each(shells.flatMap((shell) => [false, true].map((detectDirs) => ({ shell, detectDirs }))))(
    "never runs tampered downloads ($shell, detectDirs: $detectDirs)",
    ({ shell, detectDirs }) => {
      const root = mkdtempSync(join(tmpdir(), "setup-vp-integrity-"));
      const marker = join(root, "executed");
      const primary = join(root, "primary");
      const legacy = join(root, "legacy");
      const extension = windows ? "ps1" : "sh";
      const content = windows
        ? "Set-Content -LiteralPath $env:TEST_MARKER -Value executed\n"
        : 'printf executed > "$TEST_MARKER"\n';
      const source = {
        url: `https://example.invalid/install.${extension}`,
        sha256: sha256(content),
        legacy: {
          url: `https://example.invalid/install-legacy.${extension}`,
          sha256: sha256(content),
        },
      };
      const env = {
        ...process.env,
        PATH: `${root}${windows ? ";" : ":"}${process.env.PATH}`,
        HOME: root,
        USERPROFILE: root,
        TMPDIR: root,
        TEMP: root,
        TMP: root,
        TEST_PRIMARY: primary,
        TEST_LEGACY: legacy,
        TEST_MARKER: marker,
        SETUP_VP_DIRS_FILE: join(root, "dirs"),
      };
      if (!windows) {
        writeFileSync(
          join(root, "curl"),
          `#!/bin/bash
if [[ "$6" == *install-legacy* ]]; then
  cp "$TEST_LEGACY" "$8"
else
  cp "$TEST_PRIMARY" "$8"
fi
`,
        );
        chmodSync(join(root, "curl"), 0o755);
      }
      const command = getInstallScriptCommand(source, process.platform, detectDirs);
      const prefix = windows
        ? `
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, $TimeoutSec, $Uri, $OutFile)
  $fixture = if ($Uri -like '*install-legacy*') { $env:TEST_LEGACY } else { $env:TEST_PRIMARY }
  Copy-Item -LiteralPath $fixture -Destination $OutFile
}
`
        : "";
      const execute = () =>
        spawnSync(shell, [...command.args.slice(0, -1), prefix + command.args.at(-1)!], {
          env,
          encoding: "utf8",
        });
      try {
        for (const target of [primary, legacy]) {
          for (const tampered of ["", `${content}# tampered\n`]) {
            writeFileSync(primary, content);
            writeFileSync(legacy, content);
            writeFileSync(target, tampered);
            const result = execute();
            expect(result.status, result.error?.message).not.toBe(0);
            expect(result.stderr).toContain("checksum mismatch");
            expect(existsSync(marker)).toBe(false);
            expect(
              readdirSync(root).filter(
                (name) =>
                  name.startsWith("setup-vp-install.") || name.startsWith("setup-vp-install-"),
              ),
            ).toEqual([]);
          }
        }
        // A matching file must still be executable, proving that failures above
        // came from verification rather than a broken shell/download fixture.
        if (!detectDirs || !windows) {
          writeFileSync(primary, content);
          writeFileSync(legacy, content);
          const result = execute();
          expect(result.status, result.stderr).toBe(0);
          expect(existsSync(marker)).toBe(true);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
