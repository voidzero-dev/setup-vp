import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { setupSfw, SFW_VERSION } from "./install-sfw.js";
import { commandPath } from "./process.js";

vi.mock("./process.js", () => ({ commandPath: vi.fn() }));
const directories: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
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

      expect(installCommand).toBe("vp");
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
    expect(await setupSfw([{}], { sfwEnabled: false, vitePlusVersion, logWarning })).toBe("vp");
    expect(logWarning).not.toHaveBeenCalled();
  });

  it.each(["0.3.2", "0.3.3-alpha.1", "latest", "next"])(
    "keeps sfw enabled for %s",
    async (version) => {
      vi.mocked(commandPath).mockReturnValue("/bin/sfw");
      const logWarning = vi.fn();
      expect(await setupSfw([{}], { sfwEnabled: true, vitePlusVersion: version, logWarning })).toBe(
        "sfw",
      );
      expect(logWarning).not.toHaveBeenCalled();
    },
  );
});

describe("portable sfw cache", () => {
  it("reuses a complete versioned asset without a second download", async () => {
    const cacheDirectory = mkdtempSync(path.join(tmpdir(), "setup-vp-sfw-cache-"));
    directories.push(cacheDirectory);
    const download = vi.fn(async (_url: string, file: string) => {
      writeFileSync(file, "binary");
    });
    const options = {
      sfwEnabled: true,
      platform: "linux" as const,
      arch: "x64",
      isMusl: false,
      cacheDirectory,
      download,
    };
    await setupSfw([{}], { ...options, env: {} });
    const env = { PATH: "/bin" };
    await setupSfw([{}], { ...options, env });
    expect(download).toHaveBeenCalledTimes(1);
    const bin = path.join(cacheDirectory, SFW_VERSION, "sfw-free-linux-x86_64", "sfw");
    expect(readFileSync(bin, "utf8")).toBe("binary");
    expect(env.PATH).toBe(path.dirname(bin) + ":/bin");
    await setupSfw([{}], { ...options, isMusl: true, env: {} });
    expect(download).toHaveBeenCalledTimes(2);
  });
});
