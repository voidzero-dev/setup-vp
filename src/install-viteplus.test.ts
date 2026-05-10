import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { exec } from "@actions/exec";
import { warning } from "@actions/core";
import { installVitePlus } from "./install-viteplus.js";
import type { Inputs } from "./types.js";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  addPath: vi.fn(),
}));

vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const baseInputs: Inputs = {
  version: "latest",
  nodeVersion: undefined,
  nodeVersionFile: undefined,
  workingDirectory: undefined,
  runInstall: [],
  cache: false,
  cacheDependencyPath: undefined,
  registryUrl: undefined,
  scope: undefined,
};

describe("installVitePlus", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should succeed on first attempt without retrying", async () => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it("should retry on transient failure and eventually succeed", async () => {
    vi.mocked(exec).mockResolvedValueOnce(6).mockResolvedValueOnce(6).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    expect(exec).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("should throw after exhausting all retries", async () => {
    vi.mocked(exec).mockResolvedValue(6);

    await expect(installVitePlus(baseInputs)).rejects.toThrow(/after 5 attempts/);
    expect(exec).toHaveBeenCalledTimes(5);
  });

  it("should retry when exec itself throws (e.g. process spawn error)", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("spawn bash ENOENT")).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    expect(exec).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("should run the bash install with pipefail and curl retry flags so transient failures are handled", async () => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    const [cmd, args] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("bash");
    const script = (args as string[])[1];
    expect(script).toMatch(/^set -o pipefail;/);
    expect(script).toContain("--retry 3");
    expect(script).toContain("--retry-all-errors");
    expect(script).toContain("--connect-timeout");
    expect(script).toContain("--max-time");
    expect(script).toMatch(/\| bash$/);
  });
});
