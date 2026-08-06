import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";

// Mock the external shells before importing the SUT so its in-file references
// resolve to the mocked versions (same pattern as install-sfw.test.ts).
vi.mock("@actions/core", () => ({
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@actions/exec", () => ({
  getExecOutput: vi.fn(),
}));

import { setFailed, warning } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { isSfwVpNotFoundFlake, runViteInstall } from "./run-install.js";
import type { Inputs } from "./types.js";

// Real stderr from sfw-free v1.15.0 when its 10s PowerShell resolution
// times out on Windows (see voidzero-dev/setup-vp: sfw Windows flake).
const SFW_NOT_FOUND_STDERR = `Command 'vp' not found in PATH.

Possible solutions:
- Verify the command is installed
- Check it's in your PATH by running: where vp
- Try the full command name with extension (e.g., vp.cmd)  - set SFW_DEBUG=true flag for more info.`;

const baseInputs: Inputs = {
  version: "latest",
  runInstall: [{}],
  sfw: true,
  cache: false,
};

const mockedExec = vi.mocked(getExecOutput);

function execResult(exitCode: number, stderr = "", stdout = "") {
  return { exitCode, stdout, stderr };
}

const originalPlatform = process.platform;

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

describe("isSfwVpNotFoundFlake", () => {
  it("matches the sfw not-found signature in stderr", () => {
    expect(isSfwVpNotFoundFlake("", SFW_NOT_FOUND_STDERR)).toBe(true);
  });

  it("matches the signature in stdout", () => {
    expect(isSfwVpNotFoundFlake(SFW_NOT_FOUND_STDERR, "")).toBe(true);
  });

  it("does not match other failures", () => {
    expect(isSfwVpNotFoundFlake("", "ERR_PNPM_FETCH_404 not found")).toBe(false);
    expect(isSfwVpNotFoundFlake("", "Command 'pnpm' not found in PATH.")).toBe(false);
    expect(isSfwVpNotFoundFlake("", "")).toBe(false);
  });
});

describe("runViteInstall sfw retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("runs once and succeeds without retry", async () => {
    mockedExec.mockResolvedValueOnce(execResult(0));

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("warms PowerShell and retries once on the not-found flake (win32)", async () => {
    stubPlatform("win32");
    mockedExec
      .mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR))
      .mockResolvedValueOnce(execResult(0)) // warm-up
      .mockResolvedValueOnce(execResult(0)); // retry

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(mockedExec.mock.calls[0]?.[0]).toBe("sfw");
    expect(mockedExec.mock.calls[1]?.[0]).toBe("powershell.exe");
    expect(mockedExec.mock.calls[1]?.[1]).toEqual(["-NoProfile", "-Command", "Get-Command vp"]);
    expect(mockedExec.mock.calls[2]?.[0]).toBe("sfw");
    expect(mockedExec.mock.calls[2]?.[1]).toEqual(["vp", "install"]);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("retries without a warm-up on non-Windows platforms", async () => {
    stubPlatform("linux");
    mockedExec
      .mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR))
      .mockResolvedValueOnce(execResult(0)); // retry

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedExec.mock.calls[1]?.[0]).toBe("sfw");
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("fails without retry when the failure does not match the signature", async () => {
    stubPlatform("win32");
    mockedExec.mockResolvedValueOnce(execResult(1, "ERR_PNPM_FETCH_404 not found"));

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(setFailed).toHaveBeenCalledTimes(1);
  });

  it("does not retry when sfw is disabled", async () => {
    stubPlatform("win32");
    mockedExec.mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR));

    await runViteInstall({ ...baseInputs, sfw: false });

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(setFailed).toHaveBeenCalledTimes(1);
  });

  it("stops retrying as soon as a retry succeeds", async () => {
    stubPlatform("win32");
    mockedExec
      .mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR))
      .mockResolvedValueOnce(execResult(0)) // warm-up 1
      .mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR)) // retry 1 flakes again
      .mockResolvedValueOnce(execResult(0)) // warm-up 2
      .mockResolvedValueOnce(execResult(0)); // retry 2 succeeds

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(5);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(setFailed).not.toHaveBeenCalled();
  });

  it("gives up after 3 retries when the flake persists", async () => {
    stubPlatform("win32");
    mockedExec.mockResolvedValue(execResult(1, SFW_NOT_FOUND_STDERR));

    await runViteInstall(baseInputs);

    // 1 initial attempt + 3 x (warm-up + retry)
    expect(mockedExec).toHaveBeenCalledTimes(7);
    expect(warning).toHaveBeenCalledTimes(3);
    expect(setFailed).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when a retry fails with a different error", async () => {
    stubPlatform("win32");
    mockedExec
      .mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR))
      .mockResolvedValueOnce(execResult(0)) // warm-up
      .mockResolvedValueOnce(execResult(1, "ERR_PNPM_FETCH_404 not found")); // real failure

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(setFailed).toHaveBeenCalledTimes(1);
  });

  it("still retries when the warm-up itself throws", async () => {
    stubPlatform("win32");
    mockedExec
      .mockResolvedValueOnce(execResult(1, SFW_NOT_FOUND_STDERR))
      .mockRejectedValueOnce(new Error("spawn powershell.exe ENOENT")) // warm-up
      .mockResolvedValueOnce(execResult(0)); // retry

    await runViteInstall(baseInputs);

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(setFailed).not.toHaveBeenCalled();
  });
});
