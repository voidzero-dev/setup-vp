import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { exec } from "@actions/exec";
import { addPath, warning } from "@actions/core";
import { writeFileSync } from "node:fs";
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

const commitSha = "7d848b3da1987fa60b4cf18487fcc36a2a697e94";

function writeDirsFile(options: unknown, bin: string): void {
  const dirsFile = (options as { env: Record<string, string> }).env.SETUP_VP_DIRS_FILE;
  writeFileSync(
    dirsFile,
    [
      "data\t/test/data",
      `bin\t${bin}`,
      "cache\t/test/cache",
      "config\t/test/config",
      "state\t/test/state",
    ].join("\n"),
  );
}

describe("installVitePlus", () => {
  // installVitePlus spreads process.env into the child env, so a VP_PR_VERSION
  // inherited from the runner (setup-vp's own CI sets it) would make these tests
  // non-hermetic. Clear it before each test; unstubAllEnvs restores the original.
  beforeEach(() => {
    vi.stubEnv("VP_PR_VERSION", undefined);
    vi.stubEnv("VP_NODE_MANAGER", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("should succeed on first attempt without retrying", async () => {
    vi.mocked(exec).mockImplementationOnce(async (_command, _args, options) => {
      writeDirsFile(options, "/test/data/bin");
      return 0;
    });

    await installVitePlus(baseInputs);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
    expect(addPath).toHaveBeenCalledWith("/test/data/bin");
  });

  it("should fall back to the legacy bin for Vite+ releases without VpDirs", async () => {
    vi.stubEnv("HOME", "/home/runner");
    vi.stubEnv("PATH", "/usr/bin");
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    expect(addPath).toHaveBeenCalledWith("/home/runner/.vite-plus/bin");
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

  // ci/install-script-urls.test.ts tests the exact URL strings. These tests
  // verify that the version reaches the URL selection.
  it.each([
    { desc: "exact versions", version: "0.2.9", ref: "v0.2.9" },
    { desc: "pkg.pr.new commit builds", version: `0.0.0-commit.${commitSha}`, ref: commitSha },
  ])(
    "should install $desc with the install script from their git ref",
    async ({ version, ref }) => {
      vi.mocked(exec).mockResolvedValueOnce(0);

      await installVitePlus({ ...baseInputs, version });

      const script = (vi.mocked(exec).mock.calls[0][1] as string[])[1];
      expect(script).toContain(
        `https://raw.githubusercontent.com/voidzero-dev/vite-plus/${ref}/packages/cli/install.sh`,
      );
    },
  );

  it("should fall back to the jsDelivr mirror of the pinned script on failure", async () => {
    vi.mocked(exec).mockResolvedValueOnce(35).mockResolvedValueOnce(0);

    await installVitePlus({ ...baseInputs, version: "0.2.9" });

    const fallbackScript = (vi.mocked(exec).mock.calls[1][1] as string[])[1];
    expect(fallbackScript).toContain(
      "https://cdn.jsdelivr.net/gh/voidzero-dev/vite-plus@v0.2.9/packages/cli/install.sh",
    );
    // If both pinned attempts fail, the code warns before it uses the latest
    // URLs. Success on the mirror must not trigger the compatibility fallback.
    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining("latest install script"));
  });

  it("should fall back to the latest install script only after exhausting pinned URLs", async () => {
    // 4 pinned attempts fail (2 rounds × 2 URLs), the 5th (latest CDN) succeeds.
    vi.mocked(exec)
      .mockResolvedValueOnce(22)
      .mockResolvedValueOnce(22)
      .mockResolvedValueOnce(22)
      .mockResolvedValueOnce(22)
      .mockResolvedValueOnce(0);

    await installVitePlus({ ...baseInputs, version: "0.2.9" });

    const scripts = vi.mocked(exec).mock.calls.map((call) => (call[1] as string[])[1]);
    expect(scripts[0]).toContain("/v0.2.9/");
    expect(scripts[1]).toContain("jsdelivr");
    expect(scripts[2]).toContain("/v0.2.9/");
    expect(scripts[3]).toContain("jsdelivr");
    expect(scripts[4]).toContain("https://viteplus.dev/install.sh");
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("The latest script may not be compatible with 0.2.9"),
    );
  });

  it("should count pinned and latest URLs in the exhaustion error for exact versions", async () => {
    vi.mocked(exec).mockResolvedValue(6);

    await expect(installVitePlus({ ...baseInputs, version: "0.2.9" })).rejects.toThrow(
      /after 8 attempts across 4 URL\(s\)/,
    );
    // 2 rounds × 2 pinned URLs + 2 rounds × 2 latest URLs.
    expect(exec).toHaveBeenCalledTimes(8);
  });

  it("should source the bash installer and dump its resolved directories", async () => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    const [cmd, args] = vi.mocked(exec).mock.calls[0];
    expect(cmd).toBe("bash");
    const script = (args as string[])[1];
    expect(script).toMatch(/^set -o pipefail;/);
    expect(script).toContain("--connect-timeout");
    expect(script).toContain("--max-time");
    expect(script).toContain("source /dev/stdin");
    expect(script).toContain('VP_DUMP_DIRS=1 "$SHIM_DIR/vp"');
  });

  it("should declare VpDirs support to the installer", async () => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus(baseInputs);

    const options = vi.mocked(exec).mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.VP_VPDIRS_AWARE).toBe("1");
    expect(options.env.SETUP_VP_DIRS_FILE).toMatch(/setup-vp-dirs-.*\.txt$/);
  });

  it.each([
    {
      desc: "should route pkg.pr.new commit builds through VP_PR_VERSION",
      version: `0.0.0-commit.${commitSha}`,
      expected: commitSha,
    },
    {
      desc: "should not set VP_PR_VERSION for regular published versions",
      version: "0.2.1",
      expected: undefined,
    },
    {
      desc: "should require a full 40-char SHA and ignore near-miss lengths",
      // 39 hex chars: matched the old 7-40 bound but not the tightened 40.
      version: `0.0.0-commit.${commitSha.slice(0, 39)}`,
      expected: undefined,
    },
  ])("$desc", async ({ version, expected }) => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus({ ...baseInputs, version });

    const options = vi.mocked(exec).mock.calls[0][2] as { env: { [key: string]: string } };
    expect(options.env.VP_PR_VERSION).toBe(expected);
  });

  it.each([
    {
      desc: "should pass VP_NODE_MANAGER=no when node-manager is false",
      nodeManager: false,
      expected: "no",
    },
    {
      desc: "should pass VP_NODE_MANAGER=yes when node-manager is true",
      nodeManager: true,
      expected: "yes",
    },
    {
      desc: "should leave VP_NODE_MANAGER unset when node-manager is not specified",
      nodeManager: undefined,
      expected: undefined,
    },
  ])("$desc", async ({ nodeManager, expected }) => {
    vi.mocked(exec).mockResolvedValueOnce(0);

    await installVitePlus({ ...baseInputs, nodeManager });

    const options = vi.mocked(exec).mock.calls[0][2] as { env: { [key: string]: string } };
    expect(options.env.VP_NODE_MANAGER).toBe(expected);
  });
});
