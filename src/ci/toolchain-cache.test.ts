import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { hasVitePlusNativeBinding } from "./viteplus-payload.js";
import {
  canRestoreToolchain,
  createToolchainCachePlan,
  discardRestoredToolchain,
  validateToolchain,
} from "./toolchain-cache.js";
import type { ToolchainCachePlan } from "./toolchain-cache.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

let root: string;
let env: NodeJS.ProcessEnv;
const options = { version: "1.3.0", nodeVersion: "22.23.1", projectDir: "" };
function writeFixture(file: string, value = "fixture"): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}
function createPlan(platform: NodeJS.Platform = process.platform): ToolchainCachePlan {
  return createToolchainCachePlan({ ...options, projectDir: root }, env, platform)!;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "toolchain-cache-test-"));
  env = { VP_HOME: join(root, "vp"), HOME: root, USERPROFILE: root };
});
afterEach(() => {
  vi.resetAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("toolchain cache selection", () => {
  it.each(["latest", "^1.3.0", "0.2.9", "0.0.0-commit.1234567"])(
    "skips unsupported Vite+ selector %s",
    (version) => {
      expect(createToolchainCachePlan({ ...options, version }, env)).toBeUndefined();
    },
  );
  it.each([undefined, "lts", "22", "^22.18.0"])(
    "does not freeze Node selector %s",
    (nodeVersion) => {
      expect(
        createToolchainCachePlan({ ...options, nodeVersion, projectDir: root }, env),
      ).toBeUndefined();
    },
  );
  it("discovers exact project pins but gives explicit inputs priority", () => {
    writeFixture(join(root, ".node-version"), "24.15.0\n");
    expect(createToolchainCachePlan({ version: "1.3.0", projectDir: root }, env)?.nodeVersion).toBe(
      "24.15.0",
    );
    expect(createPlan().nodeVersion).toBe("22.23.1");
    expect(createToolchainCachePlan({ ...options, nodeManager: false }, env)).toBeUndefined();
  });
  it("accepts immutable preview builds and normalizes a Node v prefix", () => {
    const version = `0.0.0-commit.${"a".repeat(40)}`;
    expect(
      createToolchainCachePlan({ ...options, version, nodeVersion: "v22.23.1" }, env)?.version,
    ).toBe(version);
  });
  it.each(["VP_LOCAL_TGZ", "VP_LOCAL_BINARY", "VP_SKIP_DEPS_INSTALL", "VP_PR_VERSION"])(
    "bypasses %s",
    (key) => {
      expect(createToolchainCachePlan(options, { ...env, [key]: "override" })).toBeUndefined();
    },
  );
  it("partitions version, architecture, libc, directory and registry identities", () => {
    const key = createToolchainCachePlan(options, env, "linux", "x64", "glibc")!.key;
    for (const other of [
      createToolchainCachePlan({ ...options, version: "1.3.1" }, env, "linux", "x64", "glibc"),
      createToolchainCachePlan(
        { ...options, nodeVersion: "24.15.0" },
        env,
        "linux",
        "x64",
        "glibc",
      ),
      createToolchainCachePlan(options, env, "linux", "arm64", "glibc"),
      createToolchainCachePlan(options, env, "linux", "x64", "musl"),
      createToolchainCachePlan(
        options,
        { ...env, VP_HOME: join(root, "other") },
        "linux",
        "x64",
        "glibc",
      ),
      createToolchainCachePlan(
        options,
        { ...env, NPM_CONFIG_REGISTRY: "https://registry.example.test" },
        "linux",
        "x64",
        "glibc",
      ),
    ])
      expect(other?.key).not.toBe(key);
  });
  it("uses explicit roots, legacy installations and split defaults as hints", () => {
    delete env.VP_HOME;
    expect(createPlan("linux").data).toBe(join(root, ".local/share/vite-plus"));
    env.XDG_DATA_HOME = join(root, "xdg");
    expect(createPlan("linux").data).toBe(join(root, "xdg/vite-plus"));
    writeFixture(join(root, ".vite-plus/current"));
    expect(createPlan("linux").data).toBe(join(root, ".vite-plus"));
    env.VP_DATA_DIR = join(root, "split");
    expect(createToolchainCachePlan(options, env)).toBeUndefined();
    env.VP_BIN_DIR = join(root, "bin");
    env.VP_CACHE_DIR = join(root, "cache");
    expect(createPlan().data).toBe(env.VP_DATA_DIR);
  });
  it("does not overwrite existing payloads, runtimes or dangling links", () => {
    const cachePlan = createPlan();
    expect(canRestoreToolchain(cachePlan)).toBe(true);
    mkdirSync(cachePlan.runtime, { recursive: true });
    expect(canRestoreToolchain(cachePlan)).toBe(false);
    rmSync(cachePlan.runtime, { recursive: true });
    mkdirSync(dirname(cachePlan.payload), { recursive: true });
    symlinkSync(join(root, "missing"), cachePlan.payload, "junction");
    expect(canRestoreToolchain(cachePlan)).toBe(false);
  });
  it("discards only the two restored version directories", () => {
    const cachePlan = createPlan();
    writeFixture(join(cachePlan.payload, "broken"));
    writeFixture(join(cachePlan.runtime, "broken"));
    const other = join(cachePlan.data, "config.json");
    writeFixture(other);
    discardRestoredToolchain(cachePlan);
    expect(canRestoreToolchain(cachePlan)).toBe(true);
    expect(() => writeFileSync(other, "preserved", { flag: "r+" })).not.toThrow();
  });
});

describe.each(["linux", "win32"] as const)("%s payload validation", (platform) => {
  let nodeVersion: string;
  let binaryVersion: string;
  let data: string;
  let native: string;
  beforeEach(() => {
    const cachePlan = createPlan(platform);
    nodeVersion = cachePlan.nodeVersion;
    binaryVersion = cachePlan.version;
    data = cachePlan.data;
    writeFixture(
      join(cachePlan.payload, "package.json"),
      JSON.stringify({
        name: "vp-global",
        version: cachePlan.version,
        dependencies: { "vite-plus": cachePlan.version },
      }),
    );
    const pkg = join(cachePlan.payload, "node_modules/vite-plus");
    writeFixture(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "vite-plus",
        version: cachePlan.version,
        dependencies: { dep: "1.0.0" },
      }),
    );
    writeFixture(join(pkg, "dist/bin.js"));
    writeFixture(join(pkg, "binding/index.cjs"));
    writeFixture(
      join(cachePlan.payload, "node_modules/dep/package.json"),
      '{"name":"dep","version":"1.0.0"}',
    );
    native = join(pkg, "binding/addon.node");
    writeFixture(native);
    writeFixture(join(cachePlan.payload, "bin/.vp-setup-complete"));
    writeFixture(join(cachePlan.payload, "bin/vp-shim.exe"));
    mkdirSync(cachePlan.runtime, { recursive: true });
    vi.mocked(execFileSync).mockImplementation((file, args, opts) => {
      if (file === process.execPath) return JSON.stringify([native]);
      if (String(file).startsWith(cachePlan.runtime)) return `v${nodeVersion}\n`;
      const e = (opts as { env: NodeJS.ProcessEnv }).env;
      if (e.VP_SELF_SETUP_SUPPORT_CHECK) return "vite-plus-self-setup-v1\n";
      if (e.VP_DUMP_DIRS)
        return `data\t${data}\nbin\t${data}/bin\nconfig\t${data}\ncache\t${data}/cache\nstate\t${data}\n`;
      return (args as string[]).includes("--version") ? `vp v${binaryVersion}\n` : "";
    });
  });
  it("checks native artifacts without requiring restored configuration or shims", () => {
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(true);
  });
  it("checks preview binding metadata instead of the loader's original release version", () => {
    const cachePlan = createPlan(platform);
    const version = `0.0.0-commit.${"a".repeat(40)}`;
    expect(
      hasVitePlusNativeBinding(realpathSync(cachePlan.payload), { env, encoding: "utf8" }, version),
    ).toBe(false);
    writeFixture(
      join(cachePlan.payload, "node_modules/vite-plus/package.json"),
      JSON.stringify({ version }),
    );
    expect(
      hasVitePlusNativeBinding(realpathSync(cachePlan.payload), { env, encoding: "utf8" }, version),
    ).toBe(true);
    expect(execFileSync).toHaveBeenLastCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ NAPI_RS_ENFORCE_VERSION_CHECK: "0" }),
      }),
    );
  });
  it("rejects a missing setup marker without running the cached binary", () => {
    rmSync(join(createPlan(platform).payload, "bin/.vp-setup-complete"));
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });
  it("rejects the wrong Node, CLI or directory selection", () => {
    nodeVersion = "24.15.0";
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(false);
    nodeVersion = options.nodeVersion;
    binaryVersion = "1.3.1";
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(false);
    binaryVersion = options.version;
    data = root;
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(false);
  });
  it("rejects dependencies and bindings outside the payload", () => {
    native = join(root, "external.node");
    writeFixture(native);
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(false);
    const dep = join(createPlan(platform).payload, "node_modules/dep");
    rmSync(dep, { recursive: true });
    writeFixture(join(root, "external/package.json"), "{}");
    symlinkSync(join(root, "external"), dep, "junction");
    expect(validateToolchain(createPlan(platform), env, platform)).toBe(false);
  });
});
