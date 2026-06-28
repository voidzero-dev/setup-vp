import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import { getExecOutput } from "@actions/exec";
import { runViteInstall } from "./run-install.js";
import type { Inputs } from "./types.js";

vi.mock("@actions/core", () => ({
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  getExecOutput: vi.fn(),
}));

const baseInputs: Inputs = {
  version: "latest",
  nodeVersion: undefined,
  nodeVersionFile: undefined,
  workingDirectory: undefined,
  runInstall: [{}],
  sfw: false,
  cache: false,
  cacheDependencyPath: undefined,
  registryUrl: undefined,
  scope: undefined,
};

describe("runViteInstall", () => {
  beforeEach(() => {
    process.env.GITHUB_WORKSPACE = "/tmp/workspace";
    vi.mocked(getExecOutput).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.GITHUB_WORKSPACE;
  });

  // Regression test for https://github.com/voidzero-dev/setup-vp/issues/90
  //
  // On Windows runners stdin is not a TTY. Vite+ routes the package-manager
  // `.cmd` shims through PowerShell, whose `.ps1` wrappers read stdin and block
  // forever when the child's stdin pipe is left open and empty, hanging the job
  // for hours. `@actions/exec` only closes the child's stdin when `input` is a
  // truthy value, so we must pass an empty Buffer (EOF) to avoid the hang.
  it("closes stdin so vp install cannot hang on Windows runners", async () => {
    await runViteInstall(baseInputs);

    expect(getExecOutput).toHaveBeenCalledTimes(1);
    const options = vi.mocked(getExecOutput).mock.calls[0][2];
    expect(options?.input).toBeDefined();
    expect(Buffer.isBuffer(options?.input)).toBe(true);
    expect(options?.input?.length).toBe(0);
  });

  it("closes stdin for the sfw-wrapped install too", async () => {
    await runViteInstall({ ...baseInputs, sfw: true });

    const [cmd, args, options] = vi.mocked(getExecOutput).mock.calls[0];
    expect(cmd).toBe("sfw");
    expect(args).toEqual(["vp", "install"]);
    expect(Buffer.isBuffer(options?.input)).toBe(true);
    expect(options?.input?.length).toBe(0);
  });
});
