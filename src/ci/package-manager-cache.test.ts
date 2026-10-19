import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createToolchainCachePlan } from "./toolchain-cache.js";
import { createPackageManagerCachePlan, validatePackageManager } from "./package-manager-cache.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

let root: string;
let env: NodeJS.ProcessEnv;
function write(path: string, text = "fixture"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function fixture(name = "pnpm", platform: NodeJS.Platform = process.platform) {
  const toolchain = createToolchainCachePlan(
    { version: "1.3.0", nodeVersion: "24.22.0", projectDir: root },
    env,
    platform,
  )!;
  const manager = {
    name,
    version: "12.14.0",
    mode: "managed",
    bin_paths: {
      [name]: join(
        toolchain.data,
        "package_manager",
        name,
        "12.14.0",
        name,
        "bin",
        `${name}${platform === "win32" ? ".cmd" : ""}`,
      ),
    },
  };
  const create = () =>
    createPackageManagerCachePlan(
      toolchain,
      JSON.stringify({ package_manager: manager }),
      root,
      env,
      platform,
    );
  return { toolchain, manager, create };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pm-cache-"));
  env = { VP_HOME: join(root, "vp"), NPM_CONFIG_USERCONFIG: join(root, "user.npmrc") };
  vi.mocked(execFileSync).mockReturnValue("12.14.0\n");
});
afterEach(() => {
  vi.resetAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("package manager cache selection", () => {
  it("accepts equivalent paths without trusting directories outside the selected version", () => {
    const { manager, create } = fixture();
    manager.bin_paths.pnpm = manager.bin_paths.pnpm.replace(
      "pnpm/12.14.0",
      "pnpm/unused/../12.14.0",
    );
    expect(create()).toBeDefined();
    manager.bin_paths.pnpm = join(root, "outside/pnpm");
    expect(create()).toBeUndefined();
  });
  it.skipIf(process.platform !== "win32")("normalizes mixed Windows path separators", () => {
    const { manager, create } = fixture("pnpm", "win32");
    manager.bin_paths.pnpm = manager.bin_paths.pnpm.replaceAll("\\", "/");
    expect(create()).toBeDefined();
  });
  it.each(["npm", "pnpm", "yarn", "bun"])(
    "selects only the resolved %s version directory",
    (name) => {
      const { create, toolchain } = fixture(name);
      expect(create()?.path).toBe(join(toolchain.data, "package_manager", name, "12.14.0"));
    },
  );
  it.each(["latest", "default", "^12.0.0", "../outside", "unknown"])(
    "skips unresolved version %s",
    (version) => {
      const { manager, create } = fixture();
      manager.version = version;
      expect(create()).toBeUndefined();
    },
  );
  it("skips system managers, bundled npm, and unsupported layouts", () => {
    const { manager, create } = fixture();
    manager.mode = "system_first";
    expect(create()).toBeUndefined();
    manager.mode = "managed";
    manager.bin_paths.pnpm = join(root, "node/bin/npm");
    expect(create()).toBeUndefined();
    manager.name = "__proto__";
    expect(create()).toBeUndefined();
  });
  it("partitions registry configuration without publishing its contents", () => {
    const { create } = fixture();
    const key = create()!.key;
    write(
      join(root, ".npmrc"),
      "registry=https://registry.example.test\n//registry.example.test/:_authToken=secret",
    );
    expect(create()!.key).not.toBe(key);
    expect(create()!.key).not.toContain("secret");
    const projectKey = create()!.key;
    write(env.NPM_CONFIG_USERCONFIG!, "registry=https://other.example.test");
    expect(create()!.key).not.toBe(projectKey);
  });
});

describe.each(["linux", "win32"] as const)("%s package manager validation", (platform) => {
  it.each([
    ["pnpm", "pnpx", "pnpm.cjs"],
    ["yarn", "yarnpkg", "yarn.js"],
    ["npm", "npx", "npm-cli.js"],
  ])("probes the cached %s JS entry with the managed Node runtime", (name, alias, script) => {
    const plan = fixture(name, platform).create()!;
    const bin = join(plan.path, name, "bin");
    for (const stem of [name, alias])
      write(join(bin, `${stem}${platform === "win32" ? ".cmd" : ""}`));
    write(join(bin, script));
    expect(validatePackageManager(plan, platform)).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith(
      plan.node,
      [join(bin, script), "--version"],
      expect.any(Object),
    );
    vi.mocked(execFileSync).mockReturnValue("12.13.0\n");
    expect(validatePackageManager(plan, platform)).toBe(false);
    rmSync(join(bin, script));
    expect(validatePackageManager(plan, platform)).toBe(false);
  });
  it.each([
    ["pnpm", "pnpx"],
    ["bun", "bunx"],
  ])("probes the native %s binary without a global shim", (name, alias) => {
    const plan = fixture(name, platform).create()!;
    const bin = join(plan.path, name, "bin");
    const native = join(bin, `${name}.native${platform === "win32" ? ".exe" : ""}`);
    for (const stem of [name, alias])
      write(join(bin, `${stem}${platform === "win32" ? ".exe" : ""}`));
    write(native);
    expect(validatePackageManager(plan, platform)).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith(native, ["--version"], expect.any(Object));
    rmSync(join(bin, `${alias}${platform === "win32" ? ".exe" : ""}`));
    expect(validatePackageManager(plan, platform)).toBe(false);
  });
});

it("rejects missing installs and entries outside the cached directory", () => {
  const plan = fixture().create()!;
  expect(validatePackageManager(plan)).toBe(false);
  const outside = join(root, "external");
  write(join(outside, "pnpm.native"));
  write(join(outside, "pnpm"));
  write(join(outside, "pnpx"));
  mkdirSync(join(plan.path, "pnpm"), { recursive: true });
  symlinkSync(outside, join(plan.path, "pnpm/bin"), "junction");
  expect(validatePackageManager(plan)).toBe(false);
  expect(execFileSync).not.toHaveBeenCalled();
});
