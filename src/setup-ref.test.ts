import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseAllDocuments } from "yaml";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const safeRefs = [`v${version}`, "a".repeat(40), "main", "refs/tags/v1.21.1", "feature/test_ref-1"];
const unsafeRefs = [
  "v1/../../../attacker/repo/main",
  "../other-repo/main",
  "refs/../main",
  "refs/./main",
  "refs//main",
  "/main",
  "main/",
  ".main",
  "main.",
  "v1..2",
  "refs./main",
  "refs/.main",
  "v1/%2e%2e/%2e%2e/attacker/repo/main",
  "v1/%252e%252e/attacker/repo/main",
  "v1%2f..",
  "refs\\..\\main",
  "v1?query",
  "v1#fragment",
  "v1 with spaces",
  "v1\t",
  "v1\n",
  "v1\r\n",
  "v1\nmain",
  "v1\u0001",
  "rélease",
  "v1;exit 0",
  '$(printf injected > "$SETUP_VP_TEST_EXECUTED")',
  '`printf injected > "$SETUP_VP_TEST_EXECUTED"`',
  "$(Set-Content -LiteralPath $env:SETUP_VP_TEST_EXECUTED -Value injected)",
];

type Shell = "sh" | "bash" | "powershell";

function readSource(file: string) {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

function readTemplate(file: string) {
  return parseAllDocuments(readSource(file), {
    customTags: [{ tag: "!reference", collection: "seq", resolve: (value) => value }],
  });
}

function runScript(file: string, shell: Shell, setupRef: string | undefined) {
  const directory = mkdtempSync(join(tmpdir(), "setup-vp-setup-ref-"));
  const download = join(directory, "download");
  const executed = join(directory, "executed");
  const isTemplate = file.endsWith(".yml");
  const source = isTemplate
    ? readTemplate(file)[1]!.toJSON()[".setup-vp-bootstrap"].before_script[0]
    : readSource(file);
  const payload = isTemplate
    ? shell === "powershell"
      ? '[IO.File]::WriteAllText($env:SETUP_VP_TEST_EXECUTED, "executed")'
      : 'printf executed > "$SETUP_VP_TEST_EXECUTED"'
    : 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.SETUP_VP_TEST_EXECUTED, "executed");';
  const prelude =
    shell === "powershell"
      ? `
function Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [int]$TimeoutSec)
  [IO.File]::WriteAllText($env:SETUP_VP_TEST_DOWNLOAD, $Uri)
  Copy-Item -LiteralPath $env:SETUP_VP_TEST_PAYLOAD -Destination $OutFile
}
`
      : `
curl() {
  printf '%s' "$6" > "$SETUP_VP_TEST_DOWNLOAD"
  cp "$SETUP_VP_TEST_PAYLOAD" "$8"
}
wget() {
  printf '%s' "$8" > "$SETUP_VP_TEST_DOWNLOAD"
  cp "$SETUP_VP_TEST_PAYLOAD" "$7"
}
`;
  const scriptPath = join(directory, shell === "powershell" ? "test.ps1" : "test.sh");
  const payloadPath = join(directory, "payload");
  writeFileSync(scriptPath, prelude + source);
  writeFileSync(payloadPath, payload);
  try {
    const result = spawnSync(
      shell === "powershell" ? "powershell.exe" : shell,
      shell === "powershell"
        ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath]
        : [scriptPath],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          TMPDIR: directory,
          AGENT_TEMPDIRECTORY: directory,
          SETUP_VP_SETUP_REF: setupRef,
          SETUP_VP_RUNTIME_OUT: join(directory, "dist", "azure", "index.mjs"),
          SETUP_VP_TEST_DOWNLOAD: download,
          SETUP_VP_TEST_EXECUTED: executed,
          SETUP_VP_TEST_PAYLOAD: payloadPath,
        },
      },
    );
    expect(result.error).toBeUndefined();
    return {
      ...result,
      download: existsSync(download) ? readFileSync(download, "utf8") : undefined,
      executed: existsSync(executed),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("setup-ref download boundaries", () => {
  it.each(["gitlab/setup-vp.yml", "gitlab/setup-vp-windows.yml"])(
    "%s constrains inputs before script interpolation",
    (file) => {
      const input = readTemplate(file)[0]!.toJSON().spec.inputs["setup-ref"];
      expect(input.regex).toBe("\\A[A-Za-z0-9_-]+([./][A-Za-z0-9_-]+)*\\z");
    },
  );

  const targets: Array<[string, Shell, string]> = [
    ["gitlab/setup-vp.yml", "sh", "gitlab/bootstrap.sh"],
    ["gitlab/setup-vp.yml", "bash", "gitlab/bootstrap.sh"],
    ["gitlab/setup-vp-windows.yml", "powershell", "gitlab/bootstrap.ps1"],
    ["gitlab/bootstrap.sh", "bash", "dist/gitlab/index.mjs"],
    ["gitlab/bootstrap.ps1", "powershell", "dist/gitlab/index.mjs"],
    ["azure/bootstrap.sh", "bash", "dist/azure/index.mjs"],
    ["azure/bootstrap.ps1", "powershell", "dist/azure/index.mjs"],
  ];
  for (const [file, shell, downloadPath] of targets) {
    // Exercise the same native shells as each CI runner. Windows coverage runs
    // in the existing test-unit matrix in .github/workflows/test.yml.
    describe.skipIf((shell === "powershell") !== (process.platform === "win32"))(
      `${file} (${shell})`,
      () => {
        it.each([...safeRefs, "", undefined])("downloads and executes safe ref %j", (setupRef) => {
          const result = runScript(file, shell, setupRef);
          expect(result.status, result.stderr).toBe(0);
          expect(result.download).toBe(
            `https://raw.githubusercontent.com/voidzero-dev/setup-vp/${setupRef || `v${version}`}/${downloadPath}`,
          );
          expect(result.executed).toBe(true);
        });

        it.each(unsafeRefs)(
          "rejects unsafe ref %j before any download or execution",
          (setupRef) => {
            const result = runScript(file, shell, setupRef);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(
              file.startsWith("azure/") ? "invalid setupRef" : "invalid setup-ref",
            );
            expect(result.download).toBeUndefined();
            expect(result.executed).toBe(false);
          },
        );
      },
    );
  }
});
