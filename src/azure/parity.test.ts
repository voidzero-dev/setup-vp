import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { configureAuth } from "../ci/auth.js";
import { installVitePlus } from "../ci/install-viteplus.js";
import { setupSfw, SFW_VERSION } from "../ci/install-sfw.js";
import { parseRunInstall } from "../ci/run-install.js";
import { runPrepare, runFinalize } from "./index.js";
import type { AzurePorts } from "./index.js";

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "setup-vp-azure-parity-"));
  directories.push(root);
  const project = path.join(root, "app");
  mkdirSync(project);
  const env = { SYSTEM_DEFAULTWORKINGDIRECTORY: root, SETUP_VP_WORKING_DIRECTORY: "app" };
  const ports = {
    installVitePlus: vi.fn<typeof installVitePlus>(async () => {}),
    prepareCacheMetadata: vi.fn(() => ({ ready: false })),
    configureAuth: vi.fn(configureAuth),
    setupSfw: vi.fn<typeof setupSfw>().mockResolvedValue({ executable: "vp", sfw: false }),
    parseRunInstall,
    runInstall: vi.fn(),
    getCommandOutput: vi.fn((): string | undefined => "vp v0.3.1"),
    run: vi.fn(),
    parseInstalledVpVersion: vi.fn(() => "0.3.1"),
    prependPath: vi.fn(),
    setVariable: vi.fn(),
    logWarning: vi.fn(),
    logInfo: vi.fn(),
  } satisfies AzurePorts;
  return { root, project, env, ports };
}

describe("Azure parity", () => {
  it("passes custom auth mappings to install subprocesses and exports referenced secrets", async () => {
    const { project, env, ports } = fixture();
    const secret = 'token with "quotes", \\ and\nnewlines';
    writeFileSync(path.join(project, ".npmrc"), "//registry.example/:_authToken=${CUSTOM_TOKEN}\n");
    const target: NodeJS.ProcessEnv = { ...env, SETUP_VP_AUTH_ENV_CUSTOM_TOKEN: secret };
    ports.runInstall.mockImplementation((_entries, _project, _command, installEnv) => {
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify({token:process.env.CUSTOM_TOKEN,transport:process.env.SETUP_VP_AUTH_ENV_CUSTOM_TOKEN}))",
        ],
        { env: installEnv, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ token: secret });
    });

    await runFinalize(target, ports);

    expect(ports.runInstall).toHaveBeenCalledOnce();
    expect(ports.setVariable).toHaveBeenCalledWith("CUSTOM_TOKEN", secret, { isSecret: true });
  });

  it("rejects unsafe auth mappings before auth, install, or version commands", async () => {
    const { env, ports } = fixture();
    await expect(
      runFinalize({ ...env, SETUP_VP_AUTH_ENV_NODE_OPTIONS: "--require=./payload.cjs" }, ports),
    ).rejects.toThrow("is not a supported credential name");
    expect(ports.configureAuth).not.toHaveBeenCalled();
    expect(ports.setupSfw).not.toHaveBeenCalled();
    expect(ports.runInstall).not.toHaveBeenCalled();
    expect(ports.getCommandOutput).not.toHaveBeenCalled();
    expect(ports.setVariable).not.toHaveBeenCalled();
  });

  it("exports the full installer PATH for subsequent Azure tasks", async () => {
    const { root, env, ports } = fixture();
    const bin = path.join(root, "bin");
    const data = path.join(root, "data");
    const fallbackBin = path.join(data, "fallback-bin");
    mkdirSync(fallbackBin, { recursive: true });
    ports.installVitePlus.mockImplementation((version, options) =>
      installVitePlus(version, {
        ...options,
        runInstall: (_url, installEnv) => {
          writeFileSync(
            installEnv.SETUP_VP_DIRS_FILE!,
            `data\t${data}\nbin\t${bin}\ncache\t/cache\nconfig\t/config\nstate\t/state\n`,
          );
          return 0;
        },
      }),
    );

    await runPrepare({ ...env, PATH: "/system/bin", SETUP_VP_VERSION: "latest" }, ports);

    expect(ports.prependPath).toHaveBeenCalledWith(bin);
    expect(ports.setVariable).toHaveBeenCalledWith(
      "PATH",
      [bin, "/system/bin", fallbackBin].join(path.delimiter),
    );
  });

  it("resolves a monorepo catalog pin and selects Node from a file in workingDirectory", async () => {
    const { root, project, env, ports } = fixture();
    writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ devDependencies: { "vite-plus": "catalog:" } }),
    );
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "catalog:\n  vite-plus: 0.3.1\n");
    writeFileSync(path.join(project, ".tool-versions"), "nodejs 22.15.0\n");
    await runPrepare({ ...env, SETUP_VP_NODE_VERSION_FILE: ".tool-versions" }, ports);
    expect(ports.installVitePlus).toHaveBeenCalledWith("0.3.1", expect.any(Object));
    expect(ports.run).toHaveBeenCalledWith("vp", ["env", "use", "22.15.0"], { cwd: project });
  });

  it("supports explicit version files and rejects conflicting Node manager settings", async () => {
    const { project, env, ports } = fixture();
    writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ devDependencies: { "vite-plus": "0.3.1" } }),
    );
    writeFileSync(path.join(project, "pnpm-workspace.yaml"), "catalog:\n  vite-plus: 0.3.2\n");
    await runPrepare({ ...env, SETUP_VP_VERSION_FILE: "pnpm-workspace.yaml" }, ports);
    expect(ports.installVitePlus).toHaveBeenCalledWith("0.3.2", expect.any(Object));
    ports.installVitePlus.mockClear();
    await expect(
      runPrepare({ ...env, SETUP_VP_NODE_VERSION: "22", SETUP_VP_NODE_MANAGER: "false" }, ports),
    ).rejects.toThrow("cannot be used with node-manager");
    expect(ports.installVitePlus).not.toHaveBeenCalled();
  });

  it("emits named outputs and preserves secret status for project auth references", async () => {
    const { project, env, ports } = fixture();
    writeFileSync(path.join(project, ".npmrc"), "//registry.example/:_authToken=${CUSTOM_TOKEN}");
    await runFinalize({ ...env, CUSTOM_TOKEN: "secret", SETUP_VP_CACHE_HIT: "inexact" }, ports);
    expect(ports.setVariable).toHaveBeenCalledWith("CUSTOM_TOKEN", "secret", { isSecret: true });
    expect(ports.setVariable).toHaveBeenCalledWith("version", "0.3.1", { isOutput: true });
    expect(ports.setVariable).toHaveBeenCalledWith("cacheHit", "false", { isOutput: true });
    expect(ports.getCommandOutput).toHaveBeenCalledWith("vp", ["--version"], { cwd: project });
  });

  it("does not treat an undefined Azure secret macro as an auth token", async () => {
    const { project, env, ports } = fixture();
    writeFileSync(path.join(project, ".npmrc"), "registry=https://registry.example/");
    const target = { ...env, NODE_AUTH_TOKEN: "$(NODE_AUTH_TOKEN)" };
    await runFinalize(target, ports);
    expect(target.NODE_AUTH_TOKEN).toBeUndefined();
    expect(ports.setVariable).not.toHaveBeenCalledWith(
      "NPM_CONFIG_USERCONFIG",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not attach NODE_AUTH_TOKEN to repository-controlled registries", async () => {
    const { project, env, ports } = fixture();
    writeFileSync(
      path.join(project, ".npmrc"),
      "registry=https://attacker.invalid/\n@scope:registry=https://other.invalid/npm/\n",
    );
    const target: NodeJS.ProcessEnv = { ...env, NODE_AUTH_TOKEN: "secret" };

    await runFinalize(target, ports);
    if (target.NPM_CONFIG_USERCONFIG) directories.push(path.dirname(target.NPM_CONFIG_USERCONFIG));

    expect(target.NPM_CONFIG_USERCONFIG).toBeUndefined();
    expect(target.PNPM_CONFIG_USERCONFIG).toBeUndefined();
    expect(ports.setVariable.mock.calls.some(([name]) => name.endsWith("CONFIG_USERCONFIG"))).toBe(
      false,
    );
    expect(ports.runInstall).toHaveBeenCalledWith(
      expect.anything(),
      project,
      { executable: "vp", sfw: false },
      target,
    );
  });

  it("passes the selected sfw executable to the install runner", async () => {
    const { project, env, ports } = fixture();
    const command = { executable: path.join(project, "trusted", "sfw"), sfw: true };
    ports.setupSfw.mockResolvedValue(command);
    const target = { ...env, SETUP_VP_SFW: "true" };

    await runFinalize(target, ports);

    expect(ports.runInstall).toHaveBeenCalledWith([{}], project, command, target);
  });

  it("prepares a version/platform-specific sfw cache only when an install will run", async () => {
    const { env, ports } = fixture();
    await runPrepare({ ...env, SETUP_VP_SFW: "true", SETUP_VP_RUN_INSTALL: "false" }, ports);
    expect(ports.setVariable).not.toHaveBeenCalledWith("SETUP_VP_SFW_READY", "true");
    await runPrepare({ ...env, SETUP_VP_SFW: "true" }, ports);
    expect(ports.setVariable).toHaveBeenCalledWith("SETUP_VP_SFW_READY", "true");
    expect(ports.setVariable).toHaveBeenCalledWith(
      "SETUP_VP_SFW_CACHE_KEY",
      expect.stringMatching(new RegExp(`^${SFW_VERSION.replaceAll(".", "\\.")}-sfw-free-`)),
    );
  });

  it.each(["explicit", "package.json", "version-file"])(
    "disables sfw and its cache for a preview resolved from %s",
    async (source) => {
      const { project, env, ports } = fixture();
      const version = "0.0.0-commit.7d848b3da1987fa60b4cf18487fcc36a2a697e94";
      const target: NodeJS.ProcessEnv = { ...env, SETUP_VP_SFW: "true" };
      if (source === "explicit") {
        target.SETUP_VP_VERSION = version;
      } else if (source === "version-file") {
        writeFileSync(
          path.join(project, "pnpm-workspace.yaml"),
          `catalog:\n  vite-plus: ${version}\n`,
        );
        target.SETUP_VP_VERSION_FILE = "pnpm-workspace.yaml";
      } else {
        writeFileSync(
          path.join(project, "package.json"),
          JSON.stringify({ devDependencies: { "vite-plus": version } }),
        );
      }
      // Azure carries task.setvariable values into the following task's environment.
      ports.setVariable.mockImplementation((name, value) => {
        target[name] = value;
      });
      ports.setupSfw.mockImplementation(setupSfw);

      await runPrepare(target, ports);

      expect(ports.installVitePlus).toHaveBeenCalledWith(version, expect.any(Object));
      expect(target.SETUP_VP_SFW_READY).toBe("false");
      expect(target.SETUP_VP_SFW_CACHE_DIR).toBeUndefined();
      expect(target.SETUP_VP_RESOLVED_VERSION).toBe(version);
      // Finalize has the original sfw input but does not receive version-file from the template.
      delete target.SETUP_VP_VERSION_FILE;
      await runFinalize(target, ports);

      expect(ports.runInstall).toHaveBeenCalledWith(
        [{}],
        project,
        { executable: "vp", sfw: false },
        target,
      );
      expect(ports.logWarning).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(`automatically disabled for Vite+ preview build ${version}`),
      );
    },
  );

  it.each(["$(CUSTOM_TOKEN)", "$(MISSING_SECRET)"])(
    "removes an unresolved custom auth macro %s before install",
    async (value) => {
      const { project, env, ports } = fixture();
      writeFileSync(
        path.join(project, ".npmrc"),
        "//registry.example/:_authToken=${CUSTOM_TOKEN}\n",
      );
      const target: NodeJS.ProcessEnv = {
        ...env,
        SETUP_VP_AUTH_ENV_CUSTOM_TOKEN: value,
        UNRELATED_VALUE: "$(keep-me)",
      };
      await runFinalize(target, ports);
      expect(target.CUSTOM_TOKEN).toBeUndefined();
      expect(target.UNRELATED_VALUE).toBe("$(keep-me)");
      expect(ports.setVariable.mock.calls.some(([name]) => name === "CUSTOM_TOKEN")).toBe(false);
      expect(ports.runInstall).toHaveBeenCalledWith(
        expect.anything(),
        project,
        { executable: "vp", sfw: false },
        target,
      );
    },
  );

  it.each([undefined, ""])(
    "fails the final version check without publishing success outputs (%s)",
    async (output) => {
      const { env, ports } = fixture();
      ports.getCommandOutput.mockReturnValue(output);
      await expect(runFinalize(env, ports)).rejects.toThrow("Failed to verify Vite+ installation");
      expect(ports.setVariable).not.toHaveBeenCalled();
    },
  );
});
