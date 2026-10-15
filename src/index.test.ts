import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@actions/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@actions/core")>();
  return {
    ...actual,
    getState: vi.fn(() => "true"),
    info: vi.fn(),
    saveState: vi.fn(),
    setOutput: vi.fn(),
    warning: vi.fn(),
  };
});
vi.mock("./inputs.js", () => ({
  getInputs: () => ({
    version: "",
    runInstall: [],
    sfw: false,
    cache: false,
    cacheSave: true,
  }),
}));
vi.mock("./cache-save.js", () => ({
  saveCache: vi.fn(),
}));
vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
  getExecOutput: vi.fn(async () => ({ stdout: "vp v0.3.2" })),
}));
vi.mock("./install-viteplus.js", () => ({ installVitePlus: vi.fn() }));
vi.mock("./install-sfw.js", () => ({ setupSfw: vi.fn() }));
vi.mock("./run-install.js", () => ({ runViteInstall: vi.fn() }));
vi.mock("./auth.js", () => ({
  configAuthentication: vi.fn(),
  propagateProjectNpmrcAuth: vi.fn(),
}));
vi.mock("./version-file.js", () => ({ resolveVitePlusVersion: vi.fn() }));

import { info, setOutput, warning } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { saveCache } from "./cache-save.js";
import { runMain, runPost } from "./index.js";
import { installVitePlus } from "./install-viteplus.js";
import { setupSfw } from "./install-sfw.js";
import { runViteInstall } from "./run-install.js";
import { resolveVitePlusVersion } from "./version-file.js";
import type { Inputs } from "./types.js";

const mockedInfo = vi.mocked(info);
const mockedSaveCache = vi.mocked(saveCache);

const inputs = (cache: boolean, cacheSave: boolean): Inputs => ({
  version: "",
  runInstall: [],
  sfw: false,
  cache,
  cacheSave,
});

describe("runMain sfw", () => {
  it("passes the selected sfw executable to the install runner", async () => {
    vi.mocked(resolveVitePlusVersion).mockReturnValue("latest");
    const command = { executable: "/trusted/sfw", sfw: true };
    vi.mocked(setupSfw).mockResolvedValue(command);
    const requested = { ...inputs(false, true), sfw: true, runInstall: [{}] };

    await runMain(requested);

    expect(runViteInstall).toHaveBeenCalledWith(requested, command);
  });

  it("passes the resolved preview version to sfw setup and installs without sfw", async () => {
    const version = "0.0.0-commit.7d848b3da1987fa60b4cf18487fcc36a2a697e94";
    vi.mocked(resolveVitePlusVersion).mockReturnValue(version);
    vi.mocked(setupSfw).mockResolvedValue({ executable: "vp", sfw: false });
    const requested = { ...inputs(false, true), sfw: true, runInstall: [{}] };

    await runMain(requested);

    expect(installVitePlus).toHaveBeenCalledWith({ ...requested, version });
    expect(setupSfw).toHaveBeenCalledWith({ ...requested, version });
    expect(runViteInstall).toHaveBeenCalledWith(requested, { executable: "vp", sfw: false });
  });
});

function callOrder(mock: { calls: unknown[][]; invocationCallOrder: number[] }, args: string) {
  const index = mock.calls.findIndex(
    (call) => Array.isArray(call[1]) && call[1].join(" ") === args,
  );
  expect(index, args).not.toBe(-1);
  return mock.invocationCallOrder[index]!;
}

describe("runMain environment outputs", () => {
  const currentEnv = JSON.stringify({
    node: { version: "24.20.0", source: "devEngines.runtime", installed: true, mode: "managed" },
    package_manager: {
      name: "bun",
      version: "1.4.2",
      source: "packageManager",
      installed: true,
      mode: "managed",
    },
  });
  const outputNames = ["node-version", "package-manager", "package-manager-version"];

  function mockVp(version: string, envCurrent: () => string) {
    vi.mocked(getExecOutput).mockImplementation(async (_command, args) => ({
      exitCode: 0,
      stdout: args?.[0] === "env" ? envCurrent() : `vp v${version}`,
      stderr: "",
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_WORKSPACE", "/workspace");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mockVp("0.3.2", () => "");
  });

  it("sets Node.js and package-manager outputs from vp env current", async () => {
    mockVp("0.3.1", () => currentEnv);

    await runMain(inputs(false, true));

    expect(getExecOutput).toHaveBeenCalledWith("vp", ["env", "current", "--json"], {
      cwd: "/workspace",
      silent: true,
    });
    expect(setOutput).toHaveBeenCalledWith("version", "0.3.1");
    expect(setOutput).toHaveBeenCalledWith("node-version", "24.20.0");
    expect(setOutput).toHaveBeenCalledWith("package-manager", "bun");
    expect(setOutput).toHaveBeenCalledWith("package-manager-version", "1.4.2");
  });

  it("reads vp env current after Node.js, package-manager, and install setup", async () => {
    mockVp("0.3.1", () => currentEnv);

    await runMain({
      ...inputs(false, true),
      nodeVersion: "24",
      packageManager: { bun: false },
      runInstall: [{}],
    });

    const envCurrent = callOrder(vi.mocked(getExecOutput).mock, "env current --json");
    expect(callOrder(vi.mocked(exec).mock, "env use 24")).toBeLessThan(envCurrent);
    expect(callOrder(vi.mocked(exec).mock, "env off bun")).toBeLessThan(envCurrent);
    expect(vi.mocked(runViteInstall).mock.invocationCallOrder[0]).toBeLessThan(envCurrent);
  });

  it("reports unknown versions on Vite+ before 0.3.1", async () => {
    mockVp("0.3.0", () => currentEnv);

    await runMain(inputs(false, true));

    expect(getExecOutput).not.toHaveBeenCalledWith(
      "vp",
      ["env", "current", "--json"],
      expect.anything(),
    );
    expect(setOutput).toHaveBeenCalledWith("version", "0.3.0");
    for (const name of outputNames) expect(setOutput).toHaveBeenCalledWith(name, "unknown");
  });

  it("reports unknown versions when vp env current fails", async () => {
    mockVp("0.3.1", () => {
      throw new Error("vp env current failed");
    });

    await runMain(inputs(false, true));

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("vp env current failed"));
    for (const name of outputNames) expect(setOutput).toHaveBeenCalledWith(name, "unknown");
  });
});

describe("runPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips silently when caching is disabled", async () => {
    await runPost(inputs(false, true));

    expect(mockedSaveCache).not.toHaveBeenCalled();
    expect(mockedInfo).not.toHaveBeenCalled();
  });

  it("logs and skips when cache saving is disabled", async () => {
    await runPost(inputs(true, false));

    expect(mockedSaveCache).not.toHaveBeenCalled();
    expect(mockedInfo).toHaveBeenCalledWith("Cache saving is disabled. Skipping cache save.");
  });

  it("saves the cache when caching and cache saving are enabled", async () => {
    await runPost(inputs(true, true));

    expect(mockedSaveCache).toHaveBeenCalledOnce();
    expect(mockedInfo).not.toHaveBeenCalled();
  });
});
