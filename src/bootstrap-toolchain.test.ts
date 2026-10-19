import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { exec, getExecOutput } from "@actions/exec";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bootstrapToolchain } from "./bootstrap-toolchain.js";
import { createToolchainCachePlan } from "./ci/toolchain-cache.js";
import type { ToolchainCachePlan } from "./ci/toolchain-cache.js";

vi.mock("@actions/exec", () => ({ exec: vi.fn(), getExecOutput: vi.fn() }));

let root: string;
let plan: ToolchainCachePlan;
let bootstrap: string;
const binaryName = process.platform === "win32" ? "vp.exe" : "vp";
beforeEach(() => {
  vi.resetAllMocks();
  root = mkdtempSync(join(tmpdir(), "native-bootstrap-test-"));
  plan = createToolchainCachePlan(
    { version: "1.3.0", nodeVersion: "24.22.0", projectDir: root },
    { VP_HOME: root },
  )!;
  mkdirSync(join(plan.payload, "bin"), { recursive: true });
  writeFileSync(join(plan.payload, "bin", binaryName), "verified executable");
  writeFileSync(join(plan.payload, "bin", ".vp-setup-complete"), "");
  bootstrap = "";
  vi.mocked(exec).mockImplementation(async (binary) => {
    bootstrap = binary;
    expect(readFileSync(binary, "utf8")).toBe("verified executable");
    expect(existsSync(join(dirname(binary), ".vp-setup-complete"))).toBe(false);
    symlinkSync(plan.payload, join(root, "current"), "junction");
    return 0;
  });
  vi.mocked(getExecOutput).mockResolvedValue({
    stdout: `data\t${root}\nbin\t${root}/bin\ncache\t${root}/cache\nconfig\t${root}\nstate\t${root}\n`,
    stderr: "",
    exitCode: 0,
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("cached native bootstrap", () => {
  it("uses the native handoff and removes only its temporary executable", async () => {
    const env = {
      VP_HOME: root,
      VP_SETUP_NODE_VERSION: "24.22.0",
      VP_DUMP_DIRS: "1",
      VP_SELF_SETUP_SUPPORT_CHECK: "1",
    };
    expect(await bootstrapToolchain(plan, env, root)).toEqual({ bin: `${root}/bin` });
    const childEnv = vi.mocked(exec).mock.calls[0]![2]!.env!;
    expect(childEnv.VP_SELF_SETUP_SHELL).toBe(process.platform === "win32" ? "powershell" : "sh");
    expect(childEnv.VP_SETUP_NODE_VERSION).toBe("24.22.0");
    expect(childEnv.VP_DUMP_DIRS).toBeUndefined();
    expect(childEnv.VP_SELF_SETUP_SUPPORT_CHECK).toBeUndefined();
    expect(env.VP_DUMP_DIRS).toBe("1");
    expect(existsSync(bootstrap)).toBe(false);
    expect(existsSync(join(plan.payload, "bin", ".vp-setup-complete"))).toBe(true);
  });
  it("leaves an existing active installation to the normal installer", async () => {
    mkdirSync(join(root, "current"));
    expect(await bootstrapToolchain(plan, {}, root)).toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });
  it("cleans up after a failed handoff", async () => {
    vi.mocked(exec).mockImplementation(async (binary) => {
      bootstrap = binary;
      throw new Error("setup failed");
    });
    await expect(bootstrapToolchain(plan, {}, root)).rejects.toThrow("setup failed");
    expect(existsSync(bootstrap)).toBe(false);
  });
  it("rejects a successful exit that did not activate the cached payload", async () => {
    vi.mocked(exec).mockImplementation(async () => {
      mkdirSync(join(root, "current"));
      return 0;
    });
    await expect(bootstrapToolchain(plan, {}, root)).rejects.toThrow("did not activate");
  });
  it("rejects a different data root after setup", async () => {
    vi.mocked(getExecOutput).mockResolvedValue({
      stdout: `data\t${tmpdir()}\nbin\t${root}/bin\ncache\t${root}\nconfig\t${root}\nstate\t${root}\n`,
      stderr: "",
      exitCode: 0,
    });
    await expect(bootstrapToolchain(plan, {}, root)).rejects.toThrow("unexpected data directory");
  });
});
