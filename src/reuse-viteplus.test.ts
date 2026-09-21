import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isWindows } from "./ci/platform.js";
import { findReusableVitePlus } from "./reuse-viteplus.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("@actions/core", () => ({ debug: vi.fn() }));

let root: string;
let data: string;
let bin: string;
let config: string;
let versionDir: string;
let nativeFile: string;
let version: string;
let env: NodeJS.ProcessEnv;
let platform: NodeJS.Platform;

function write(file: string, contents = "fixture"): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function dirsOutput(): string {
  return `layout\tsingle-root\ndata\t${data}\nbin\t${bin}\ncache\t${data}/cache\nconfig\t${config}\nstate\t${data}\n`;
}

function createInstallation({
  tools = ["vp", "node", "npm", "npx", "corepack", "vpx", "vpr"],
  directory = version,
}: { tools?: string[]; directory?: string } = {}): void {
  const windows = isWindows(platform);
  versionDir = join(data, directory);
  const payload = join(versionDir, "bin", windows ? "vp.exe" : "vp");
  write(payload);
  chmodSync(payload, 0o755);
  mkdirSync(data, { recursive: true });
  symlinkSync(versionDir, join(data, "current"), "junction");
  write(
    join(versionDir, "package.json"),
    JSON.stringify({
      name: "vp-global",
      version,
      dependencies: { "vite-plus": version },
    }),
  );
  const packageDir = join(
    versionDir,
    "node_modules",
    ".pnpm",
    `vite-plus@${version}`,
    "node_modules",
    "vite-plus",
  );
  write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "vite-plus",
      version,
      dependencies: { "fixture-dep": "1.0.0" },
    }),
  );
  write(join(packageDir, "dist", "bin.js"));
  write(join(packageDir, "binding", "index.cjs"));
  nativeFile = join(packageDir, "..", "@voidzero-dev", "vite-plus-native", "vite-plus.node");
  write(nativeFile);
  write(
    join(packageDir, "..", "fixture-dep", "package.json"),
    '{"name":"fixture-dep","version":"1.0.0"}',
  );
  symlinkSync(packageDir, join(versionDir, "node_modules", "vite-plus"), "junction");
  write(join(config, windows ? "env.ps1" : "env"));
  mkdirSync(bin, { recursive: true });
  if (windows) {
    write(join(versionDir, "bin", "vp-shim.exe"), "trampoline");
    write(join(bin, "vp-use.cmd"));
  }
  for (const tool of tools) {
    if (windows) {
      write(join(bin, `${tool}.exe`), "trampoline");
      write(
        join(bin, `${tool}.shim`),
        `vite-plus-shim-v1\nlayout=single-root\ndata=${data}\ncache=${data}/cache\n`,
      );
    } else {
      symlinkSync(payload, join(bin, tool));
    }
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "setup-vp-reuse-test-"));
  data = join(root, "data");
  bin = join(data, "bin");
  config = data;
  env = { VP_HOME: data, HOME: join(root, "home"), USERPROFILE: join(root, "home") };
  platform = process.platform;
  version = "0.3.0";
  vi.mocked(execFileSync).mockImplementation((file, args) => {
    if (file === process.execPath) return JSON.stringify([nativeFile]);
    return (args as string[]).includes("--version")
      ? `vp v${version}\nLocal vite-plus v9.9.9\n`
      : dirsOutput();
  });
});

afterEach(() => {
  vi.resetAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function reuse(): string | undefined {
  return findReusableVitePlus(version, env, platform)?.bin;
}

describe("findReusableVitePlus", () => {
  it("returns the fallback bin from the selected data directory", () => {
    bin = join(root, "separate-bin");
    createInstallation();
    const fallbackBin = join(data, "fallback-bin");
    mkdirSync(fallbackBin);
    expect(findReusableVitePlus(version, env, platform)).toEqual({ bin, fallbackBin });
  });

  describe.each(["linux", "win32"] as const)("%s shim layouts", (targetPlatform) => {
    beforeEach(() => {
      platform = targetPlatform;
    });

    const modernTools = [
      "vp",
      "node",
      "npm",
      "npx",
      "pnpm",
      "pnpx",
      "yarn",
      "yarnpkg",
      "bun",
      "bunx",
      "vpx",
      "vpr",
    ];

    it.each(["0.3.1", "0.3.2", "0.3.3"])("reuses %s without a Corepack shim", (release) => {
      version = release;
      createInstallation({ tools: modernTools });
      expect(reuse()).toBe(bin);
    });

    it("still requires the Corepack shim for 0.3.0", () => {
      createInstallation();
      rmSync(join(bin, isWindows(platform) ? "corepack.exe" : "corepack"));
      expect(reuse()).toBeUndefined();
    });

    it("reuses the active directory from a native reinstall", () => {
      version = "0.3.3";
      createInstallation({ tools: modernTools, directory: "0.3.3+force.123.456" });
      expect(reuse()).toBe(bin);
    });

    it("rejects an active installation outside the selected data directory", () => {
      version = "0.3.3";
      createInstallation({ tools: modernTools, directory: join("..", "external") });
      expect(reuse()).toBeUndefined();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it.each(["pnpm", "pnpx", "yarn", "yarnpkg", "bun", "bunx"])(
      "repairs a 0.3.3 installation with a missing %s shim",
      (tool) => {
        version = "0.3.3";
        createInstallation({ tools: modernTools });
        rmSync(join(bin, isWindows(platform) ? `${tool}.exe` : tool));
        expect(reuse()).toBeUndefined();
      },
    );
  });

  it("reuses the active exact version through an absolute payload probe", () => {
    createInstallation();
    expect(reuse()).toBe(bin);
    expect(execFileSync).toHaveBeenCalledWith(
      join(data, "current", "bin", isWindows(platform) ? "vp.exe" : "vp"),
      [],
      expect.objectContaining({
        env: { ...env, VP_DUMP_DIRS: "1" },
        timeout: 5000,
        cwd: tmpdir(),
      }),
    );
  });

  it.each(["latest", "next", "^0.3.0", "0.3", "0.2.9", `0.0.0-commit.${"a".repeat(40)}`])(
    "leaves %s to the installer",
    (version) => {
      expect(findReusableVitePlus(version, env)).toBeUndefined();
      expect(execFileSync).not.toHaveBeenCalled();
    },
  );

  it.each(["VP_PR_VERSION", "VP_LOCAL_TGZ", "VP_LOCAL_BINARY", "VP_SKIP_DEPS_INSTALL"])(
    "does not bypass %s",
    (key) => {
      createInstallation();
      env[key] = "override";
      expect(reuse()).toBeUndefined();
      expect(execFileSync).not.toHaveBeenCalled();
    },
  );

  it("falls back on a fresh runner", () => {
    expect(reuse()).toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("does not activate an installed version when current points elsewhere", () => {
    createInstallation();
    rmSync(join(data, "current"));
    mkdirSync(join(data, "0.3.1"));
    symlinkSync(join(data, "0.3.1"), join(data, "current"), "junction");
    expect(reuse()).toBeUndefined();
  });

  it.each([
    "package.json",
    "node_modules/vite-plus/package.json",
    "node_modules/vite-plus/dist/bin.js",
    "node_modules/vite-plus/binding/index.cjs",
    "node_modules/.pnpm/vite-plus@0.3.0/node_modules/fixture-dep/package.json",
  ])("falls back when %s is missing", (file) => {
    createInstallation();
    rmSync(join(versionDir, file));
    expect(reuse()).toBeUndefined();
  });

  it("does not accept a project package as the global installation", () => {
    createInstallation();
    rmSync(join(versionDir, "node_modules", "vite-plus"));
    const project = join(root, "project");
    write(
      join(project, "package.json"),
      '{"name":"vite-plus","version":"0.3.0","dependencies":{}}',
    );
    write(join(project, "dist", "bin.js"));
    symlinkSync(project, join(versionDir, "node_modules", "vite-plus"), "junction");
    expect(reuse()).toBeUndefined();
  });

  it.each(["package", "file"])(
    "falls back when the loaded native binding %s is missing",
    (target) => {
      createInstallation();
      rmSync(target === "package" ? dirname(nativeFile) : nativeFile, { recursive: true });
      expect(reuse()).toBeUndefined();
    },
  );

  it("probes the installed binding loader with the action's Node runtime", () => {
    createInstallation();
    expect(reuse()).toBe(bin);
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      ["--input-type=commonjs", "--eval", expect.any(String), expect.stringContaining("index.cjs")],
      expect.objectContaining({
        env: { ...env, NAPI_RS_ENFORCE_VERSION_CHECK: "1" },
        cwd: tmpdir(),
        timeout: 5000,
      }),
    );
  });

  it("falls back when the native loader fails", () => {
    createInstallation();
    vi.mocked(execFileSync)
      .mockReturnValueOnce(dirsOutput())
      .mockReturnValueOnce(`vp v${version}`)
      .mockImplementationOnce(() => {
        throw new Error("Cannot find native binding");
      });
    expect(reuse()).toBeUndefined();
  });

  it.each(["[]", "null", "invalid JSON"])(
    "rejects a native probe without binding files: %s",
    (output) => {
      createInstallation();
      vi.mocked(execFileSync)
        .mockReturnValueOnce(dirsOutput())
        .mockReturnValueOnce(`vp v${version}`)
        .mockReturnValueOnce(output);
      expect(reuse()).toBeUndefined();
    },
  );

  it("does not accept a native binding from outside the active installation", () => {
    createInstallation();
    nativeFile = join(root, "other-installation", "vite-plus.node");
    write(nativeFile);
    expect(reuse()).toBeUndefined();
  });

  it.each(["{", '{"name":"vp-global","version":"0.3.1","dependencies":{"vite-plus":"0.3.0"}}'])(
    "rejects invalid or mismatched wrapper metadata",
    (content) => {
      createInstallation();
      write(join(versionDir, "package.json"), content);
      expect(reuse()).toBeUndefined();
    },
  );

  it("rejects a binary with a different global version even if its local version matches", () => {
    createInstallation();
    vi.mocked(execFileSync)
      .mockReturnValueOnce(dirsOutput())
      .mockReturnValueOnce("vp v0.3.1\nLocal vite-plus v0.3.0\n");
    expect(reuse()).toBeUndefined();
  });

  it.each([
    "unrecognized output",
    "data\trelative\nbin\t/bin\ncache\t/cache\nconfig\t/config\nstate\t/state\n",
  ])("rejects invalid directory output", (output) => {
    createInstallation();
    vi.mocked(execFileSync).mockReturnValue(output);
    expect(reuse()).toBeUndefined();
  });

  it("rejects a payload whose environment selects a different data directory", () => {
    createInstallation();
    mkdirSync(join(root, "other"));
    vi.mocked(execFileSync).mockReturnValue(
      dirsOutput().replace(`data\t${data}`, `data\t${join(root, "other")}`),
    );
    expect(reuse()).toBeUndefined();
  });

  it("falls back when a probe fails or times out", () => {
    createInstallation();
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("ETIMEDOUT");
    });
    expect(reuse()).toBeUndefined();
  });

  it.each([
    { VP_HOME: "relative" },
    { VP_BIN_DIR: "/bin" },
    { VP_BIN_DIR: "/bin", VP_DATA_DIR: "relative", VP_CACHE_DIR: "/cache" },
  ])("does not bypass invalid directory overrides", (overrides) => {
    createInstallation();
    Object.assign(env, overrides);
    expect(reuse()).toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each([
    { shimMode: "system_first" },
    { nodeShimMode: "system_first" },
    { packageManagerShimModes: { npm: "system_first" } },
    { nodeShimMode: "managed", packageManagerShimModes: { pnpm: "system_first" } },
  ])("falls back when installer defaults must be restored: %j", (modes) => {
    createInstallation();
    write(join(config, "config.json"), JSON.stringify(modes));
    expect(reuse()).toBeUndefined();
  });

  it("reuses an installation with enabled scoped modes", () => {
    createInstallation();
    write(
      join(config, "config.json"),
      JSON.stringify({
        nodeShimMode: "managed",
        packageManagerShimModes: { npm: "managed", pnpm: "managed" },
      }),
    );
    env.VP_NODE_MANAGER = "yes";
    expect(reuse()).toBe(bin);
  });

  describe.each([
    "VP_NODE_MANAGER",
    "VP_PM_MANAGER",
    "VP_NPM_MANAGER",
    "VP_PNPM_MANAGER",
    "VP_YARN_MANAGER",
    "VP_BUN_MANAGER",
  ])("%s installer override", (key) => {
    it.each(["no", "invalid"])("leaves %s to the installer", (value) => {
      createInstallation();
      env[key] = value;
      expect(reuse()).toBeUndefined();
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it.each(["yes", ""])("reuses managed installations for %s", (value) => {
      createInstallation();
      env[key] = value;
      expect(reuse()).toBe(bin);
    });
  });

  it("falls back when a required shim is missing", () => {
    createInstallation();
    rmSync(join(bin, isWindows(platform) ? "npm.exe" : "npm"));
    expect(reuse()).toBeUndefined();
  });

  it("falls back when environment files are missing", () => {
    createInstallation();
    rmSync(join(config, isWindows(platform) ? "env.ps1" : "env"));
    expect(reuse()).toBeUndefined();
  });

  it.each(["legacy", "xdg", "overrides"])(
    "discovers a %s installation without relying on PATH",
    (layout) => {
      delete env.VP_HOME;
      if (layout === "legacy") data = join(env.HOME!, ".vite-plus");
      else if (layout === "xdg") {
        platform = "linux";
        env.XDG_DATA_HOME = join(root, "xdg");
        data = join(env.XDG_DATA_HOME, "vite-plus");
      } else {
        env.VP_DATA_DIR = data;
        env.VP_CACHE_DIR = join(data, "cache");
        env.VP_BIN_DIR = join(root, "custom-bin");
      }
      bin = env.VP_BIN_DIR || join(data, "bin");
      config = join(root, "config");
      createInstallation();
      expect(reuse()).toBe(bin);
    },
  );

  it("validates Windows trampoline contents and ownership", () => {
    platform = "win32";
    createInstallation();
    expect(reuse()).toBe(bin);
    write(join(bin, "node.shim"), `vite-plus-shim-v1\ndata=${root}/other\ncache=${data}/cache\n`);
    expect(reuse()).toBeUndefined();
  });

  it("rejects a stale Windows trampoline", () => {
    platform = "win32";
    createInstallation();
    write(join(bin, "vp.exe"), "old trampoline");
    expect(reuse()).toBeUndefined();
  });
});
