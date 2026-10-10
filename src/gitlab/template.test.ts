import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseAllDocuments } from "yaml";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };
const releaseRef = `v${version}`;

function readTemplate(name: string) {
  const text = readFileSync(new URL("../../gitlab/" + name, import.meta.url), "utf8");
  const docs = parseAllDocuments(text, {
    customTags: [{ tag: "!reference", collection: "seq", resolve: (value) => value }],
  });
  expect(docs.flatMap((doc) => doc.errors)).toEqual([]);
  return { text, inputs: docs[0]!.toJSON().spec.inputs, jobs: docs[1]!.toJSON() };
}

type Shell = "bash" | "sh" | "powershell";
const runtimeInputs = Object.keys(readTemplate("setup-vp.yml").inputs).filter(
  (name) => name !== "cache-policy" && name !== "cache-namespace",
);
const unrestrictedInputs = runtimeInputs.filter((name) => {
  const input = readTemplate("setup-vp.yml").inputs[name];
  return !input.type && !input.regex && !input.options;
});

function envName(input: string) {
  return "SETUP_VP_" + input.toUpperCase().replaceAll("-", "_");
}

function runInputAssignments(
  shell: Shell,
  overrides: Record<string, string | boolean> = {},
  cacheSave = "",
) {
  const { inputs, jobs } = readTemplate(
    shell === "powershell" ? "setup-vp-windows.yml" : "setup-vp.yml",
  );
  const values = Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, (input as { default: unknown }).default]),
  );
  Object.assign(values, overrides);
  const interpolate = (value: string) =>
    value.replace(/\$\[\[ inputs\.([a-z-]+) \]\]/g, (_, name: string) => String(values[name]));
  const setup = jobs[".setup-vp"];
  const directory = mkdtempSync(join(tmpdir(), "setup-vp-gitlab-inputs-"));
  const marker = join(directory, "injected");
  const dump = join(directory, "dump.mjs");
  const scriptPath = join(directory, shell === "powershell" ? "inputs.ps1" : "inputs.sh");
  const names = [...runtimeInputs.map(envName), "SETUP_VP_CACHE_SAVE"];
  writeFileSync(
    dump,
    `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name => [name, process.env[name] ?? ""]))));`,
  );
  // Interpolate the actual script too: restoring inline inputs must make the
  // delimiter payloads execute and fail these regression tests.
  writeFileSync(
    scriptPath,
    (shell === "powershell" ? "$ErrorActionPreference = 'Stop'\n" : "set -eu\n") +
      interpolate(setup.before_script[0]) +
      (shell === "powershell"
        ? "\n& $env:SETUP_VP_TEST_NODE $env:SETUP_VP_TEST_DUMP\n"
        : '\n"$SETUP_VP_TEST_NODE" "$SETUP_VP_TEST_DUMP"\n'),
  );
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("SETUP_VP_")) delete env[name];
  }
  // Component inputs must still replace pre-existing runtime variables.
  for (const name of runtimeInputs) env[envName(name)] = "ignored";
  for (const [name, variable] of Object.entries(setup.variables ?? {})) {
    const value = variable as { value: string; expand: boolean };
    expect(value.expand).toBe(false);
    env[name] = interpolate(value.value);
  }
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
          ...env,
          SETUP_VP_CACHE_SAVE: cacheSave,
          SETUP_VP_TEST_MARKER: marker,
          SETUP_VP_TEST_NODE: process.execPath,
          SETUP_VP_TEST_DUMP: dump,
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("GitLab native templates", () => {
  it.each(["setup-vp.yml", "setup-vp-windows.yml"])(
    "%s defaults to the package.json release",
    (name) => {
      const { inputs, jobs } = readTemplate(name);
      expect(inputs["setup-ref"].default).toBe(releaseRef);
      const bootstrap = jobs[".setup-vp-bootstrap"].before_script[0];
      if (name === "setup-vp.yml") {
        expect(bootstrap).toContain(`SETUP_VP_SETUP_REF="\${SETUP_VP_SETUP_REF:-${releaseRef}}"`);
      } else {
        expect(bootstrap).toContain(
          `if (-not $env:SETUP_VP_SETUP_REF) { $env:SETUP_VP_SETUP_REF = '${releaseRef}' }`,
        );
      }
    },
  );

  it("keeps the Unix and Windows input contracts identical", () => {
    const unix = readTemplate("setup-vp.yml");
    const windows = readTemplate("setup-vp-windows.yml");
    expect(windows.inputs).toEqual(unix.inputs);
    expect(unix.inputs.version.default).toBe("");
    for (const key of [
      "version-file",
      "node-version",
      "node-version-file",
      "cache-dependency-path",
    ]) {
      expect(unix.inputs[key].default).toBe("");
      const envName = "SETUP_VP_" + key.toUpperCase().replaceAll("-", "_");
      expect(unix.text).toContain(envName);
      expect(windows.text).toContain(envName);
    }
  });

  it.each(["setup-vp.yml", "setup-vp-windows.yml"])(
    "provides opt-in native cache policy and post-save in %s",
    (name) => {
      const { inputs, jobs } = readTemplate(name);
      expect(inputs["cache-policy"].options).toEqual(["pull", "pull-push"]);
      expect(jobs[".setup-vp"].cache).toBeUndefined();
      const cached = jobs[".setup-vp-cached"];
      expect(cached.extends).toBe(".setup-vp");
      expect(cached.variables.SETUP_VP_CACHE).toBe("true");
      expect(cached.cache.paths).toEqual([".setup-vp-cache/"]);
      expect(cached.cache.policy).toBe("$[[ inputs.cache-policy ]]");
      expect(inputs["cache-namespace"].default).toBe("$CI_RUNNER_ID");
      expect(cached.cache.key).toBe(
        "setup-vp-v2-$[[ inputs.cache-namespace ]]-$CI_JOB_NAME_SLUG-$CI_COMMIT_REF_SLUG",
      );
      expect(cached.cache.fallback_keys).toEqual([
        "setup-vp-v2-$[[ inputs.cache-namespace ]]-$CI_JOB_NAME_SLUG-$CI_DEFAULT_BRANCH",
      ]);
      expect(cached.after_script.join("\n")).toContain("save-cache");
      expect(cached.cache.paths.join("\n")).not.toContain("env");
    },
  );

  it("sources the generated PowerShell environment", () => {
    const { jobs } = readTemplate("setup-vp-windows.yml");
    const bootstrap = jobs[".setup-vp-bootstrap"].before_script[0];
    expect(bootstrap).toContain("SETUP_VP_ENV_FORMAT = 'powershell'");
    expect(bootstrap).toContain(". $envFile");
    expect(bootstrap).toContain("finally");
  });

  it("passes identical literal string inputs through job variables on both platforms", () => {
    const unix = readTemplate("setup-vp.yml");
    const windows = readTemplate("setup-vp-windows.yml");
    expect(unix.jobs[".setup-vp"].variables).toEqual(windows.jobs[".setup-vp"].variables);
    for (const { jobs } of [unix, windows]) {
      const setup = jobs[".setup-vp"];
      for (const name of runtimeInputs.filter((name) => name !== "sfw")) {
        expect(Object.values(setup.variables ?? {})).toContainEqual({
          value: `$[[ inputs.${name} ]]`,
          expand: false,
        });
        expect(setup.before_script[0]).not.toContain(`$[[ inputs.${name} ]]`);
      }
    }
  });

  for (const shell of ["bash", "sh", "powershell"] as const) {
    describe.skipIf((shell === "powershell") !== (process.platform === "win32"))(
      `${shell} input assignments`,
      () => {
        it.each(unrestrictedInputs)("keeps delimiter payloads in %s as data", (name) => {
          const delimiter = envName(name) + "_EOF";
          const payload =
            shell === "powershell"
              ? "false\n'@\nSet-Content -LiteralPath $env:SETUP_VP_TEST_MARKER -Value injected\n$null = @'"
              : `false\n${delimiter}\nprintf injected > "$SETUP_VP_TEST_MARKER"\ncat <<'${delimiter}'`;
          expect(runInputAssignments(shell, { [name]: payload })[envName(name)]).toBe(payload);
        });

        it("preserves defaults and input precedence over runtime variables", () => {
          const { inputs } = readTemplate("setup-vp.yml");
          expect(runInputAssignments(shell)).toEqual({
            ...Object.fromEntries(
              runtimeInputs.map((name) => [envName(name), String(inputs[name].default)]),
            ),
            SETUP_VP_CACHE_SAVE: "",
          });
        });

        it.each([
          "",
          "quotes: '\"\n$CI_JOB_TOKEN ${TOKEN} $(echo injected) `echo injected`\r\nlast line\n\n",
        ])("preserves empty and special-character input values: %j", (value) => {
          const values = Object.fromEntries(unrestrictedInputs.map((name) => [name, value]));
          const result = runInputAssignments(shell, values);
          for (const name of unrestrictedInputs) expect(result[envName(name)]).toBe(value);
        });

        it("preserves structured inputs and handles validated boolean and cache inputs", () => {
          const runInstall =
            "- cwd: ./packages/app\n  args: ['--frozen-lockfile']\n- cwd: ./packages/lib\n";
          const packageManager = "npm: false\npnpm: true\n";
          const result = runInputAssignments(shell, {
            "run-install": runInstall,
            "package-manager": packageManager,
            sfw: true,
            "cache-policy": "pull",
          });
          expect(result.SETUP_VP_RUN_INSTALL).toBe(runInstall);
          expect(result.SETUP_VP_PACKAGE_MANAGER).toBe(packageManager);
          expect(result.SETUP_VP_SFW).toBe("true");
          expect(result.SETUP_VP_CACHE_SAVE).toBe("false");
          expect(
            runInputAssignments(shell, { "cache-policy": "pull-push" }, "false")
              .SETUP_VP_CACHE_SAVE,
          ).toBe("false");
        });
      },
    );
  }
});
