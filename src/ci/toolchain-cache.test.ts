import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  canRestoreToolchain,
  createToolchainCachePlan,
  discardRestoredToolchain,
  validateToolchain,
} from "./toolchain-cache.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

let root: string;
let env: NodeJS.ProcessEnv;
const options = { version: "1.3.0", nodeVersion: "22.23.1", projectDir: "" };
function write(file: string, value = "fixture") {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}
function plan(platform: NodeJS.Platform = process.platform) {
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
    write(join(root, ".node-version"), "24.15.0\n");
    expect(createToolchainCachePlan({ version: "1.3.0", projectDir: root }, env)?.nodeVersion).toBe(
      "24.15.0",
    );
    expect(plan().nodeVersion).toBe("22.23.1");
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
    expect(plan("linux").data).toBe(join(root, ".local/share/vite-plus"));
    env.XDG_DATA_HOME = join(root, "xdg");
    expect(plan("linux").data).toBe(join(root, "xdg/vite-plus"));
    write(join(root, ".vite-plus/current"));
    expect(plan("linux").data).toBe(join(root, ".vite-plus"));
    env.VP_DATA_DIR = join(root, "split");
    expect(createToolchainCachePlan(options, env)).toBeUndefined();
    env.VP_BIN_DIR = join(root, "bin");
    env.VP_CACHE_DIR = join(root, "cache");
    expect(plan().data).toBe(env.VP_DATA_DIR);
  });
  it("does not overwrite existing payloads, runtimes or dangling links", () => {
    const p = plan();
    expect(canRestoreToolchain(p)).toBe(true);
    mkdirSync(p.runtime, { recursive: true });
    expect(canRestoreToolchain(p)).toBe(false);
    rmSync(p.runtime, { recursive: true });
    mkdirSync(dirname(p.payload), { recursive: true });
    symlinkSync(join(root, "missing"), p.payload, "junction");
    expect(canRestoreToolchain(p)).toBe(false);
  });
  it("discards only the two restored version directories", () => {
    const p = plan();
    write(join(p.payload, "broken"));
    write(join(p.runtime, "broken"));
    const other = join(p.data, "config.json");
    write(other);
    discardRestoredToolchain(p);
    expect(canRestoreToolchain(p)).toBe(true);
    expect(() => writeFileSync(other, "preserved", { flag: "r+" })).not.toThrow();
  });
});

describe.each(["linux", "win32"] as const)("%s payload validation", (platform) => {
  let nodeVersion: string;
  let binaryVersion: string;
  let data: string;
  let native: string;
  beforeEach(() => {
    const p = plan(platform);
    nodeVersion = p.nodeVersion;
    binaryVersion = p.version;
    data = p.data;
    write(
      join(p.payload, "package.json"),
      JSON.stringify({
        name: "vp-global",
        version: p.version,
        dependencies: { "vite-plus": p.version },
      }),
    );
    const pkg = join(p.payload, "node_modules/vite-plus");
    write(
      join(pkg, "package.json"),
      JSON.stringify({ name: "vite-plus", version: p.version, dependencies: { dep: "1.0.0" } }),
    );
    write(join(pkg, "dist/bin.js"));
    write(join(pkg, "binding/index.cjs"));
    write(join(p.payload, "node_modules/dep/package.json"), '{"name":"dep","version":"1.0.0"}');
    native = join(pkg, "binding/addon.node");
    write(native);
    write(join(p.payload, "bin/.vp-setup-complete"));
    write(join(p.payload, "bin/vp-shim.exe"));
    mkdirSync(p.runtime, { recursive: true });
    vi.mocked(execFileSync).mockImplementation((file, args, opts) => {
      if (file === process.execPath) return JSON.stringify([native]);
      if (String(file).startsWith(p.runtime)) return `v${nodeVersion}\n`;
      const e = (opts as { env: NodeJS.ProcessEnv }).env;
      if (e.VP_SELF_SETUP_SUPPORT_CHECK) return "vite-plus-self-setup-v1\n";
      if (e.VP_DUMP_DIRS)
        return `data\t${data}\nbin\t${data}/bin\nconfig\t${data}\ncache\t${data}/cache\nstate\t${data}\n`;
      return (args as string[]).includes("--version") ? `vp v${binaryVersion}\n` : "";
    });
  });
  it("checks native artifacts without requiring restored configuration or shims", () => {
    expect(validateToolchain(plan(platform), env, platform)).toBe(true);
  });
  it("rejects a missing setup marker without running the cached binary", () => {
    rmSync(join(plan(platform).payload, "bin/.vp-setup-complete"));
    expect(validateToolchain(plan(platform), env, platform)).toBe(false);
    expect(execFileSync).not.toHaveBeenCalled();
  });
  it("rejects the wrong Node, CLI or directory selection", () => {
    nodeVersion = "24.15.0";
    expect(validateToolchain(plan(platform), env, platform)).toBe(false);
    nodeVersion = options.nodeVersion;
    binaryVersion = "1.3.1";
    expect(validateToolchain(plan(platform), env, platform)).toBe(false);
    binaryVersion = options.version;
    data = root;
    expect(validateToolchain(plan(platform), env, platform)).toBe(false);
  });
  it("rejects dependencies and bindings outside the payload", () => {
    native = join(root, "external.node");
    write(native);
    expect(validateToolchain(plan(platform), env, platform)).toBe(false);
    const dep = join(plan(platform).payload, "node_modules/dep");
    rmSync(dep, { recursive: true });
    write(join(root, "external/package.json"), "{}");
    symlinkSync(join(root, "external"), dep, "junction");
    expect(validateToolchain(plan(platform), env, platform)).toBe(false);
  });
});
