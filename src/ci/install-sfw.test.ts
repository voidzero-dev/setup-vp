import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { setupSfw, SFW_VERSION } from "./install-sfw.js";
import { commandPath } from "./process.js";

vi.mock("./process.js", () => ({ commandPath: vi.fn() }));
vi.mock("./sfw-release-digests.js", () => ({
  getSfwAssetDigest: () => createHash("sha256").update("binary").digest("hex"),
}));
const directories: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("portable sfw preview handling", () => {
  const vitePlusVersion = "0.0.0-commit.7d848b3da1987fa60b4cf18487fcc36a2a697e94";

  it.each(["linux", "darwin", "win32"] as const)(
    "skips sfw lookup, downloads, and exports for previews on %s",
    async (platform) => {
      vi.mocked(commandPath).mockReturnValue("/bin/sfw");
      const download = vi.fn();
      const exportVariable = vi.fn();
      const logWarning = vi.fn();
      const env = { SETUP_VP_SFW: "true", PATH: "/bin" };

      const installCommand = await setupSfw([{}], {
        env,
        vitePlusVersion,
        platform,
        download,
        exportVariable,
        logWarning,
      });

      expect(installCommand).toEqual({ executable: "vp", sfw: false });
      expect(logWarning).toHaveBeenCalledExactlyOnceWith(
        `sfw was requested but is automatically disabled for Vite+ preview build ${vitePlusVersion}; Socket Firewall Free will not be used.`,
      );
      expect(commandPath).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      expect(exportVariable).not.toHaveBeenCalled();
      expect(env.PATH).toBe("/bin");
    },
  );

  it("does not warn when sfw is already disabled for a preview", async () => {
    const logWarning = vi.fn();
    expect(await setupSfw([{}], { sfwEnabled: false, vitePlusVersion, logWarning })).toEqual({
      executable: "vp",
      sfw: false,
    });
    expect(logWarning).not.toHaveBeenCalled();
  });

  it.each(["0.3.2", "0.3.3-alpha.1", "latest", "next"])(
    "keeps sfw enabled for %s",
    async (version) => {
      vi.mocked(commandPath).mockReturnValue("/bin/sfw");
      const logWarning = vi.fn();
      expect(
        await setupSfw([{}], { sfwEnabled: true, vitePlusVersion: version, logWarning }),
      ).toEqual({ executable: "/bin/sfw", sfw: true });
      expect(logWarning).not.toHaveBeenCalled();
    },
  );
});

describe("portable sfw cache", () => {
  async function fixture() {
    const root = await realpath(mkdtempSync(path.join(tmpdir(), "setup-vp-sfw-cache-")));
    directories.push(root);
    // Keep private staging and the cache separate and clean both after each test.
    vi.stubEnv(process.platform === "win32" ? "TEMP" : "TMPDIR", root);
    const cacheDirectory = path.join(root, "cache");
    const bin = path.join(cacheDirectory, SFW_VERSION, "sfw-free-linux-x86_64", "sfw");
    const download = vi.fn(async (_url: string, file: string) => writeFileSync(file, "binary"));
    const logWarning = vi.fn();
    return {
      bin,
      download,
      logWarning,
      options: {
        sfwEnabled: true,
        platform: "linux" as const,
        arch: "x64",
        isMusl: false,
        cacheDirectory,
        download,
        logWarning,
      },
    };
  }

  it("uses a verified private copy of a cached binary", async () => {
    const { bin, download, options } = await fixture();
    await setupSfw([{}], { ...options, env: {} });
    const env = { PATH: "/bin" };
    const command = await setupSfw([{}], { ...options, env });
    expect(download).toHaveBeenCalledTimes(1);
    expect(command.sfw).toBe(true);
    expect(command.executable).not.toBe(bin);
    expect(readFileSync(command.executable, "utf8")).toBe("binary");
    expect(env.PATH).toBe(path.dirname(command.executable) + ":/bin");
    await setupSfw([{}], { ...options, isMusl: true, env: {} });
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("replaces a cache entry with a different digest", async () => {
    const { bin, download, logWarning, options } = await fixture();
    await setupSfw([{}], { ...options, env: {} });
    writeFileSync(bin, "outdated binary");

    const command = await setupSfw([{}], { ...options, env: {} });

    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining("invalid cached sfw"));
    expect(download).toHaveBeenCalledTimes(2);
    expect(readFileSync(command.executable, "utf8")).toBe("binary");
    expect(readFileSync(bin, "utf8")).toBe("binary");
  });

  it("rejects downloads that do not match the release digest", async () => {
    const { bin, download, options } = await fixture();
    download.mockImplementation(async (_url, file) => writeFileSync(file, "incomplete download"));
    const env = { PATH: "/bin" };

    await expect(setupSfw([{}], { ...options, env })).rejects.toThrow("SHA-256 mismatch");
    expect(download).toHaveBeenCalledTimes(2);
    expect(env.PATH).toBe("/bin");
    expect(() => readFileSync(bin)).toThrow();
  });
});
