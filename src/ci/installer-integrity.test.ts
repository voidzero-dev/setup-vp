import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { getInstallScriptCommand, parseVitePlusDirs } from "./vp-dirs.js";

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");
const windows = process.platform === "win32";
const shells = windows ? ["pwsh", "powershell.exe"] : ["bash"];

function installerTestEnv(shell: string, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Node inherits PowerShell 7's module paths from the CI shell. Let Desktop
  // construct its own paths so built-in cmdlets such as Get-FileHash load.
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      ([key]) => shell !== "powershell.exe" || key.toLowerCase() !== "psmodulepath",
    ),
  );
}

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
      const env = installerTestEnv(shell, {
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
      });
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

  it.skipIf(!windows).each(["pwsh", "powershell.exe"])(
    "preserves installer failures before probing an existing executable (%s)",
    (shell) => {
      const root = mkdtempSync(join(tmpdir(), "setup-vp-installer-exit-"));
      const bin = join(root, "existing bin");
      const primary = join(root, "installer.ps1");
      const marker = join(root, "probed");
      const dirsFile = join(root, "dirs");
      const probe = join(root, "probe.cjs");
      try {
        mkdirSync(bin);
        // A native executable with a successful --version response must not
        // hide the installer's failure. Its no-argument probe records usage.
        copyFileSync(process.execPath, join(bin, "vp.exe"));
        writeFileSync(
          probe,
          `const fs = require("node:fs");
fs.writeFileSync(process.env.TEST_MARKER, "probed");
for (const key of ["data", "bin", "cache", "config", "state"]) {
  console.log(key + "\\t" + process.env.TEST_EXISTING_BIN);
}
process.exit(0);
`,
        );
        const env = installerTestEnv(shell, {
          TEST_PRIMARY: primary,
          TEST_MARKER: marker,
          TEST_EXISTING_BIN: bin,
          SETUP_VP_DIRS_FILE: dirsFile,
          NODE_OPTIONS: `--require="${probe.replaceAll("\\", "/")}"`,
          // Also exercise case-insensitive removal in the Desktop harness.
          PSMODULEPATH: join(root, "wrong-edition-modules"),
        });
        function execute(exitCode: number) {
          const content = `$script:ShimDir = $env:TEST_EXISTING_BIN\nexit ${exitCode}\n`;
          writeFileSync(primary, content);
          const command = getInstallScriptCommand(
            { url: "https://example.invalid/install.ps1", sha256: sha256(content) },
            "win32",
          );
          const download = `
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, $TimeoutSec, $Uri, $OutFile)
  Copy-Item -LiteralPath $env:TEST_PRIMARY -Destination $OutFile
}
`;
          return spawnSync(shell, [...command.args.slice(0, -1), download + command.args.at(-1)!], {
            env,
            encoding: "utf8",
          });
        }

        const failure = execute(23);
        expect(failure.status, failure.stderr).toBe(23);
        expect(existsSync(marker)).toBe(false);
        expect(readFileSync(dirsFile, "utf8").trim()).toBe("");

        // Prove that the existing executable and its directory probe work.
        const success = execute(0);
        expect(success.status, success.stderr).toBe(0);
        expect(readFileSync(marker, "utf8")).toBe("probed");
        expect(parseVitePlusDirs(readFileSync(dirsFile, "utf8"))?.bin).toBe(bin);
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );
});
