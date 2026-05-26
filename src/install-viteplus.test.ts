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
  sfw: false,
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

  it("should throw after exhausting all rounds across both URLs", async () => {
    vi.mocked(exec).mockResolvedValue(6);

    await expect(installVitePlus(baseInputs)).rejects.toThrow(/after 4 attempts across 2 URL\(s\)/);
    // 2 rounds × 2 URLs = 4 attempts.
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it("should retry when exec itself throws (e.g. process spawn error)", async () => {
    vi.mocked(exec).mockRejectedValueOnce(new Error("spawn bash ENOENT")).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    expect(exec).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("should fall back to the GitHub install URL after a single primary failure", async () => {
    vi.mocked(exec).mockResolvedValueOnce(35).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    expect(exec).toHaveBeenCalledTimes(2);

    const primaryScript = (vi.mocked(exec).mock.calls[0][1] as string[])[1];
    expect(primaryScript).toContain("https://viteplus.dev/install.sh");

    const fallbackScript = (vi.mocked(exec).mock.calls[1][1] as string[])[1];
    expect(fallbackScript).toContain(
      "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.sh",
    );
  });

  it("should alternate primary and fallback URLs across rounds", async () => {
    vi.mocked(exec).mockResolvedValue(35);

    await expect(installVitePlus(baseInputs)).rejects.toThrow();

    const scripts = vi.mocked(exec).mock.calls.map((call) => (call[1] as string[])[1]);
    expect(scripts).toHaveLength(4);
    expect(scripts[0]).toContain("viteplus.dev/install.sh");
    expect(scripts[1]).toContain("raw.githubusercontent.com");
    expect(scripts[2]).toContain("viteplus.dev/install.sh");
    expect(scripts[3]).toContain("raw.githubusercontent.com");
  });

  it("should run the bash install with pipefail and timeout flags so transient failures fail fast", async () => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    const [cmd, args] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("bash");
    const script = (args as string[])[1];
    expect(script).toMatch(/^set -o pipefail;/);
    expect(script).toContain("--connect-timeout");
    expect(script).toContain("--max-time");
    expect(script).toMatch(/\| bash$/);
  });
});
