import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findReusableVitePlus } from "./reuse-viteplus.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("@actions/core", () => ({ debug: vi.fn() }));

let root: string;
let data: string;
let bin: string;
let config: string;
let versionDir: string;
let payload: string;
let env: NodeJS.ProcessEnv;
let platform: NodeJS.Platform;

function write(file: string, contents = "fixture"): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function dirsOutput(): string {
  return `layout\tsingle-root\ndata\t${data}\nbin\t${bin}\ncache\t${data}/cache\nconfig\t${config}\nstate\t${data}\n`;
}

function createInstallation(windows = false): void {
  versionDir = join(data, "0.3.0");
  payload = join(versionDir, "bin", windows ? "vp.exe" : "vp");
  write(payload);
  chmodSync(payload, 0o755);
  symlinkSync(versionDir, join(data, "current"), "junction");
  write(
    join(versionDir, "package.json"),
    JSON.stringify({
      name: "vp-global",
      version: "0.3.0",
      dependencies: { "vite-plus": "0.3.0" },
    }),
  );
  const packageDir = join(
    versionDir,
    "node_modules",
    ".pnpm",
    "vite-plus@0.3.0",
    "node_modules",
    "vite-plus",
  );
  write(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "vite-plus",
      version: "0.3.0",
      dependencies: { "fixture-dep": "1.0.0" },
    }),
  );
  write(join(packageDir, "dist", "bin.js"));
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
  for (const tool of ["vp", "node", "npm", "npx", "corepack", "vpx", "vpr"]) {
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
  vi.mocked(execFileSync).mockImplementation((_file, args) =>
    (args as string[]).includes("--version") ? "vp v0.3.0\nLocal vite-plus v9.9.9\n" : dirsOutput(),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function reuse(nodeManager?: boolean): string | undefined {
  return findReusableVitePlus("0.3.0", nodeManager, env, platform);
}

describe("findReusableVitePlus", () => {
  it("reuses the active exact version through an absolute payload probe", () => {
    createInstallation(process.platform === "win32");
    expect(reuse()).toBe(bin);
    expect(execFileSync).toHaveBeenCalledWith(
      join(data, "current", "bin", process.platform === "win32" ? "vp.exe" : "vp"),
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
      expect(findReusableVitePlus(version, undefined, env)).toBeUndefined();
      expect(execFileSync).not.toHaveBeenCalled();
    },
  );

  it.each(["VP_PR_VERSION", "VP_LOCAL_TGZ", "VP_LOCAL_BINARY", "VP_SKIP_DEPS_INSTALL"])(
    "does not bypass %s",
    (key) => {
      createInstallation(process.platform === "win32");
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
    createInstallation(process.platform === "win32");
    rmSync(join(data, "current"));
    mkdirSync(join(data, "0.3.1"));
    symlinkSync(join(data, "0.3.1"), join(data, "current"), "junction");
    expect(reuse()).toBeUndefined();
  });

  it.each([
    "package.json",
    "node_modules/vite-plus/package.json",
    "node_modules/vite-plus/dist/bin.js",
    "node_modules/.pnpm/vite-plus@0.3.0/node_modules/fixture-dep/package.json",
  ])("falls back when %s is missing", (file) => {
    createInstallation(process.platform === "win32");
    rmSync(join(versionDir, file));
    expect(reuse()).toBeUndefined();
  });

  it("does not accept a project package as the global installation", () => {
    createInstallation(process.platform === "win32");
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

  it.each(["{", '{"name":"vp-global","version":"0.3.1","dependencies":{"vite-plus":"0.3.0"}}'])(
    "rejects invalid or mismatched wrapper metadata",
    (content) => {
      createInstallation(process.platform === "win32");
      write(join(versionDir, "package.json"), content);
      expect(reuse()).toBeUndefined();
    },
  );

  it("rejects a binary with a different global version even if its local version matches", () => {
    createInstallation(process.platform === "win32");
    vi.mocked(execFileSync)
      .mockReturnValueOnce(dirsOutput())
      .mockReturnValueOnce("vp v0.3.1\nLocal vite-plus v0.3.0\n");
    expect(reuse()).toBeUndefined();
  });

  it.each([
    "unrecognized output",
    "data\trelative\nbin\t/bin\ncache\t/cache\nconfig\t/config\nstate\t/state\n",
  ])("rejects invalid directory output", (output) => {
    createInstallation(process.platform === "win32");
    vi.mocked(execFileSync).mockReturnValue(output);
    expect(reuse()).toBeUndefined();
  });

  it("rejects a payload whose environment selects a different data directory", () => {
    createInstallation(process.platform === "win32");
    mkdirSync(join(root, "other"));
    vi.mocked(execFileSync).mockReturnValue(
      dirsOutput().replace(`data\t${data}`, `data\t${join(root, "other")}`),
    );
    expect(reuse()).toBeUndefined();
  });

  it("falls back when a probe fails or times out", () => {
    createInstallation(process.platform === "win32");
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
    createInstallation(process.platform === "win32");
    Object.assign(env, overrides);
    expect(reuse()).toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it.each([undefined, true])(
    "falls back when managed Node.js must be enabled (%s)",
    (nodeManager) => {
      createInstallation(process.platform === "win32");
      write(join(config, "config.json"), '{"shimMode":"system_first"}');
      expect(reuse(nodeManager)).toBeUndefined();
    },
  );

  it("falls back when managed Node.js must be disabled", () => {
    createInstallation(process.platform === "win32");
    expect(reuse(false)).toBeUndefined();
  });

  it("reuses system-first mode and honors the input over VP_NODE_MANAGER", () => {
    createInstallation(process.platform === "win32");
    write(join(config, "config.json"), '{"shimMode":"system_first"}');
    env.VP_NODE_MANAGER = "yes";
    expect(reuse(false)).toBe(bin);
    env.VP_NODE_MANAGER = "no";
    expect(reuse()).toBe(bin);
  });

  it("falls back when a required shim is missing", () => {
    createInstallation(process.platform === "win32");
    rmSync(join(bin, process.platform === "win32" ? "npm.exe" : "npm"));
    expect(reuse()).toBeUndefined();
  });

  it("falls back when environment files are missing", () => {
    createInstallation(process.platform === "win32");
    rmSync(join(config, process.platform === "win32" ? "env.ps1" : "env"));
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
      createInstallation(platform === "win32");
      expect(reuse()).toBe(bin);
    },
  );

  it("validates Windows trampoline contents and ownership", () => {
    platform = "win32";
    createInstallation(true);
    expect(reuse()).toBe(bin);
    write(join(bin, "node.shim"), `vite-plus-shim-v1\ndata=${root}/other\ncache=${data}/cache\n`);
    expect(reuse()).toBeUndefined();
  });

  it("rejects a stale Windows trampoline", () => {
    platform = "win32";
    createInstallation(true);
    write(join(bin, "vp.exe"), "old trampoline");
    expect(reuse()).toBeUndefined();
  });
});
