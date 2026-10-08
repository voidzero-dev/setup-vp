import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { parse as parseYaml } from "yaml";

const templatePath = fileURLToPath(new URL("../../azure/setup-vp.yml", import.meta.url));
const template = readFileSync(templatePath, "utf8");
const docs = parseYaml(template);
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

type Shell = "bash" | "powershell";
const prepareSteps = docs.steps.filter((step: { displayName?: string }) =>
  step.displayName?.startsWith("setup-vp prepare"),
) as Array<{ bash?: string; powershell?: string; env: Record<string, string> }>;
const finalizeSteps = docs.steps.filter((step: { displayName?: string }) =>
  step.displayName?.startsWith("setup-vp finalize"),
) as Array<{ bash?: string; powershell?: string; env: Record<string, unknown> }>;

function prepareStep(shell: Shell) {
  return prepareSteps.find((step) => step[shell])!;
}

function runPrepare(shell: Shell, setupRef: string) {
  const directory = mkdtempSync(join(tmpdir(), "setup-vp-azure-template-"));
  const download = join(directory, "download");
  const bootstrap = join(directory, "bootstrap");
  const marker = join(directory, "injected");
  // Render the real template source as Azure would, so reintroducing inline
  // parameter interpolation makes the injection payloads executable again.
  const script = prepareStep(shell)
    [shell]!.replaceAll("${{ parameters.setupRef }}", () => setupRef)
    .replaceAll("$(Agent.TempDirectory)", () => directory);
  const prelude =
    shell === "bash"
      ? `
curl() {
  printf '%s' "$6" > "$SETUP_VP_TEST_DOWNLOAD"
  printf '%s\\n' 'printf "%s" "$SETUP_VP_SETUP_REF" > "$SETUP_VP_TEST_BOOTSTRAP"' > "$8"
}
`
      : `
function Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [int]$TimeoutSec)
  [IO.File]::WriteAllText($env:SETUP_VP_TEST_DOWNLOAD, $Uri)
  Set-Content -LiteralPath $OutFile -Value '[IO.File]::WriteAllText($env:SETUP_VP_TEST_BOOTSTRAP, $env:SETUP_VP_SETUP_REF)'
}
`;
  const scriptPath = join(directory, shell === "bash" ? "prepare.sh" : "prepare.ps1");
  writeFileSync(scriptPath, prelude + script);
  try {
    const result = spawnSync(
      shell === "bash" ? "bash" : "powershell.exe",
      shell === "bash"
        ? [scriptPath]
        : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          AGENT_TEMPDIRECTORY: directory,
          SETUP_VP_SETUP_REF: setupRef,
          SETUP_VP_TEST_DOWNLOAD: download,
          SETUP_VP_TEST_BOOTSTRAP: bootstrap,
          SETUP_VP_TEST_MARKER: marker,
        },
      },
    );
    expect(result.error).toBeUndefined();
    return {
      ...result,
      download: existsSync(download) ? readFileSync(download, "utf8") : undefined,
      bootstrap: existsSync(bootstrap) ? readFileSync(bootstrap, "utf8") : undefined,
      injected: existsSync(marker),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Expand only the authEnv insertion from the real template. Support the old
// direct insertion too, so the execution test detects a return to that behavior.
function renderAuthEnv(shell: Shell, authEnv: Record<string, string>): Record<string, string> {
  const step = finalizeSteps.find((step) => step[shell])!;
  if (step.env["${{ insert }}"] === "${{ parameters.authEnv }}") return authEnv;
  const mapping = step.env["${{ each pair in parameters.authEnv }}"] as Record<string, string>;
  const entries = Object.entries(mapping);
  expect(entries).toHaveLength(1);
  const [key, value] = entries[0]!;
  expect(value).toBe("${{ pair.value }}");
  const format = key.match(/^\$\{\{ format\('([^']*)', pair\.key\) \}\}$/)?.[1];
  expect(format).toBeDefined();
  return Object.fromEntries(
    Object.entries(authEnv).map(([name, token]) => [format!.replaceAll("{0}", name), token]),
  );
}

function runFinalizeWithAuthEnv(shell: Shell, name: "NODE_OPTIONS" | "BASH_ENV") {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "setup-vp-azure-auth-env-")));
  const marker = join(directory, "injected");
  const hook = join(directory, "hook.sh");
  try {
    const runtimeDir = join(directory, "setup-vp-azure", "dist", "azure");
    mkdirSync(runtimeDir, { recursive: true });
    copyFileSync(
      new URL("../../dist/azure/index.mjs", import.meta.url),
      join(runtimeDir, "index.mjs"),
    );
    writeFileSync(hook, 'printf injected > "$SETUP_VP_TEST_MARKER"\n');
    const preload =
      "import{writeFileSync}from'node:fs';writeFileSync(process.env.SETUP_VP_TEST_MARKER,'injected');";
    const authEnv = {
      [name]:
        name === "BASH_ENV"
          ? hook
          : `--import=data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`,
    };
    const step = finalizeSteps.find((step) => step[shell])!;
    const script = step[shell]!.replaceAll(
      "$(SETUP_VP_BOOTSTRAP_NODE)",
      () => process.execPath,
    ).replaceAll("$(Agent.TempDirectory)", () => directory);
    const scriptPath = join(directory, shell === "bash" ? "finalize.sh" : "finalize.ps1");
    // PowerShell@2's wrapper propagates the last native command's exit code.
    writeFileSync(scriptPath, script + (shell === "powershell" ? "\nexit $LASTEXITCODE\n" : ""));
    const result = spawnSync(
      shell === "bash" ? "bash" : "powershell.exe",
      shell === "bash"
        ? [scriptPath]
        : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        encoding: "utf8",
        timeout: 10_000,
        cwd: directory,
        env: {
          ...process.env,
          SETUP_VP_RUN_INSTALL: "false",
          SETUP_VP_TEST_MARKER: marker,
          ...renderAuthEnv(shell, authEnv),
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `authEnv variable "${name}" is not a supported credential name`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("azure/setup-vp.yml", () => {
  it("declares the documented parameters with defaults", () => {
    const parameters = docs.parameters as Array<{
      name: string;
      type: string;
      default: unknown;
    }>;
    const byName = Object.fromEntries(parameters.map((entry) => [entry.name, entry]));

    expect(byName.version).toMatchObject({ type: "string", default: "" });
    expect(byName.versionFile).toMatchObject({ type: "string", default: "" });
    expect(byName.nodeVersionFile).toMatchObject({ type: "string", default: "" });
    expect(byName.bootstrapNodeVersion).toMatchObject({ type: "string", default: "24.x" });
    expect(byName.stepName).toMatchObject({ type: "string", default: "setupVp" });
    expect(byName.workingDirectory).toMatchObject({ type: "string", default: "." });
    expect(byName.runInstall).toMatchObject({ type: "object", default: true });
    expect(byName.sfw).toMatchObject({ type: "boolean", default: false });
    expect(byName.registryUrl).toMatchObject({ type: "string", default: "" });
    expect(byName.authEnv).toMatchObject({ type: "object", default: {} });
    expect(byName.scope).toMatchObject({ type: "string", default: "" });
    expect(byName.setupRef).toMatchObject({ type: "string", default: `v${version}` });
    expect(byName.nodeVersion).toMatchObject({ type: "string", default: "" });
    expect(byName.packageManager).toMatchObject({ type: "object", default: "" });
    expect(byName.nodeManager).toMatchObject({ type: "string", default: "" });
    expect(byName.cache).toMatchObject({ type: "boolean", default: false });
    expect(byName.cacheDependencyPath).toMatchObject({ type: "string", default: "" });
  });

  it("orders UseNode, prepare, Cache@2, and finalize", () => {
    const steps = docs.steps as Array<Record<string, unknown>>;
    const flattened = JSON.stringify(steps);
    expect(flattened).toContain("UseNode@1");
    expect(flattened).toContain("setup-vp prepare");
    expect(flattened).toContain("Cache@2");
    expect(flattened).toContain("setup-vp finalize");
    expect(flattened.indexOf("setup-vp prepare")).toBeLessThan(flattened.indexOf("Cache@2"));
    expect(flattened.indexOf("Cache@2")).toBeLessThan(flattened.indexOf("setup-vp finalize"));
  });

  it("serializes runInstall with convertToJson and avoids main downloads", () => {
    expect(template).toContain("${{ convertToJson(parameters.runInstall) }}");
    expect(
      template.split("SETUP_VP_PACKAGE_MANAGER: ${{ convertToJson(parameters.packageManager) }}"),
    ).toHaveLength(3);
    expect(template).not.toMatch(/setup-vp\/main\//);
    expect(template).toContain("$(SETUP_VP_LOCK_FILE)");
    expect(template).toContain("cacheHitVar: SETUP_VP_CACHE_HIT");
    expect(template.match(/NODE_AUTH_TOKEN: \$\(NODE_AUTH_TOKEN\)/g) ?? []).toHaveLength(2);
  });

  it("includes Unix and Windows branches", () => {
    expect(template).toContain("Windows_NT");
    expect(template).toContain("bootstrap.sh");
    expect(template).toContain("bootstrap.ps1");
    expect(template).toContain("name: ${{ parameters.stepName }}Windows");
    expect(template).toContain("name: ${{ parameters.stepName }}Unix");
    expect(template.match(/\$\(SETUP_VP_BOOTSTRAP_NODE\)/g)).toHaveLength(2);
    expect(template).not.toContain("${{ insert }}: ${{ parameters.authEnv }}");
  });

  it.each(["bash", "powershell"] as const)(
    "keeps authEnv names outside the %s launcher environment",
    (shell) => {
      const authEnv = { NODE_OPTIONS: "--require=./hook.cjs", CUSTOM_TOKEN: "$(CUSTOM_TOKEN)" };
      expect(renderAuthEnv(shell, authEnv)).toEqual({
        SETUP_VP_AUTH_ENV_NODE_OPTIONS: "--require=./hook.cjs",
        SETUP_VP_AUTH_ENV_CUSTOM_TOKEN: "$(CUSTOM_TOKEN)",
      });
    },
  );

  it("selects the agent shell at runtime", () => {
    expect(template).not.toContain("${{ if eq(variables['Agent.OS'], 'Windows_NT') }}");
    expect(template).not.toContain("${{ if ne(variables['Agent.OS'], 'Windows_NT') }}");
    expect(template).toContain(
      "condition: and(succeeded(), eq(variables['Agent.OS'], 'Windows_NT'))",
    );
    expect(template).toContain(
      "condition: and(succeeded(), ne(variables['Agent.OS'], 'Windows_NT'))",
    );
  });

  it.each(["bash", "powershell"] as const)(
    "passes setupRef only through %s's environment",
    (shell) => {
      const step = prepareStep(shell);
      expect(step.env.SETUP_VP_SETUP_REF).toBe("${{ parameters.setupRef }}");
      expect(step[shell]).not.toContain("${{");
    },
  );

  for (const shell of ["bash", "powershell"] as const) {
    describe.skipIf((shell === "powershell") !== (process.platform === "win32"))(
      `${shell} finalize`,
      () => {
        it.each(["NODE_OPTIONS", "BASH_ENV"] as const)(
          "rejects %s without executing startup code",
          (name) => runFinalizeWithAuthEnv(shell, name),
        );
      },
    );
    describe.skipIf((shell === "powershell") !== (process.platform === "win32"))(
      `${shell} prepare`,
      () => {
        it.each([`v${version}`, "a".repeat(40), "refs/tags/v1.21.1", "feature/test_ref-1"])(
          "downloads and runs the bootstrap for %s",
          (setupRef) => {
            const result = runPrepare(shell, setupRef);
            expect(result.status, result.stderr).toBe(0);
            const extension = shell === "bash" ? "sh" : "ps1";
            expect(result.download).toBe(
              `https://raw.githubusercontent.com/voidzero-dev/setup-vp/${setupRef}/azure/bootstrap.${extension}`,
            );
            expect(result.bootstrap).toBe(setupRef);
            expect(result.injected).toBe(false);
          },
        );

        it.each([
          "",
          "../other-repo/main",
          "refs/../main",
          "refs/./main",
          "refs//main",
          "v1%2f..",
          "v1?query",
          "v1#fragment",
          "v1 with spaces",
          "v1\n",
          "v1\r\n",
          shell === "bash"
            ? 'v1"; printf injected > "$SETUP_VP_TEST_MARKER"; exit 0; #'
            : 'v1"; Set-Content -LiteralPath $env:SETUP_VP_TEST_MARKER -Value injected; exit 0; #',
          shell === "bash"
            ? '$(printf injected > "$SETUP_VP_TEST_MARKER")'
            : "$(Set-Content -LiteralPath $env:SETUP_VP_TEST_MARKER -Value injected)",
          '`printf injected > "$SETUP_VP_TEST_MARKER"`',
        ])("rejects unsafe setupRef %j before downloading or executing commands", (setupRef) => {
          const result = runPrepare(shell, setupRef);
          expect(result.injected).toBe(false);
          expect(result.download).toBeUndefined();
          expect(result.bootstrap).toBeUndefined();
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("invalid setupRef");
        });
      },
    );
  }
});
