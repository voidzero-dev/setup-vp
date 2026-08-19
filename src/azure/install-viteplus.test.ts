import { describe, expect, it, vi } from "vite-plus/test";
import { writeFileSync } from "node:fs";
import { installVitePlus } from "./install-viteplus.js";

function writeDirsFile(env: Record<string, string>, bin: string): void {
  writeFileSync(
    env.SETUP_VP_DIRS_FILE,
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
  it("uses PowerShell installers on Windows and bash installers on Unix", async () => {
    const calls: NodeJS.Platform[] = [];
    const runInstall = vi.fn(
      (
        _url: string,
        _env: Record<string, string>,
        platform: NodeJS.Platform = process.platform,
      ) => {
        calls.push(platform);
        return 0;
      },
    );

    await installVitePlus("latest", {
      platform: "win32",
      env: { PATH: "" },
      prependPath: () => undefined,
      sleep: async () => undefined,
      runInstall,
      logWarningFn: () => undefined,
    });
    await installVitePlus("latest", {
      platform: "linux",
      env: { PATH: "" },
      prependPath: () => undefined,
      sleep: async () => undefined,
      runInstall,
      logWarningFn: () => undefined,
    });

    expect(calls).toEqual(["win32", "linux"]);
    expect(runInstall.mock.calls[0]?.[0]).toContain("install.ps1");
    expect(runInstall.mock.calls[1]?.[0]).toContain("install.sh");
  });

  it("installs exact versions with the release-tag script before the latest script", async () => {
    // Fail every attempt so the full URL order is observable.
    const runInstall = vi.fn((_url: string, _env: Record<string, string>) => 1);
    const warnings: string[] = [];

    await expect(
      installVitePlus("0.2.9", {
        platform: "linux",
        env: {
          PATH: "",
          VP_VPDIRS_AWARE: "1",
          SETUP_VP_DIRS_FILE: "/tmp/stale-vp-dirs",
        },
        prependPath: () => undefined,
        sleep: async () => undefined,
        runInstall,
        logWarningFn: (message) => warnings.push(message),
      }),
    ).rejects.toThrow(/after 8 attempts across 4 URL\(s\)/);

    const urls = runInstall.mock.calls.map((call) => call[0]);
    expect(urls[0]).toContain("/v0.2.9/packages/cli/install.sh");
    expect(urls[1]).toContain("jsdelivr");
    expect(urls[4]).toBe("https://viteplus.dev/install.sh");
    expect(warnings.some((message) => message.includes("Falling back to the latest"))).toBe(true);
    const installEnv = runInstall.mock.calls[0]?.[1] as Record<string, string>;
    expect(installEnv.VP_VPDIRS_AWARE).toBeUndefined();
    expect(installEnv.SETUP_VP_DIRS_FILE).toBeUndefined();
  });

  it("routes pkg.pr.new commit builds through VP_PR_VERSION", async () => {
    const runInstall = vi.fn(() => 0);
    const sha = "a".repeat(40);

    await installVitePlus(`0.0.0-commit.${sha}`, {
      platform: "linux",
      env: { PATH: "" },
      prependPath: () => undefined,
      sleep: async () => undefined,
      runInstall,
      logWarningFn: () => undefined,
    });

    const installCalls = runInstall.mock.calls as unknown as Array<
      [string, Record<string, string>, NodeJS.Platform?]
    >;
    expect(installCalls[0]?.[1]?.VP_PR_VERSION).toBe(sha);
    expect(installCalls[0]?.[1]?.VP_VPDIRS_AWARE).toBe("1");
    expect(installCalls[0]?.[1]?.SETUP_VP_DIRS_FILE).toMatch(/setup-vp-dirs-.*\.txt$/);
  });

  it("prepends the bin directory reported by the installed payload", async () => {
    const prependPath = vi.fn();
    const env = { PATH: "/usr/bin" };
    const runInstall = vi.fn((_url: string, installEnv: Record<string, string>) => {
      writeDirsFile(installEnv, "/test/data/bin");
      return 0;
    });

    await installVitePlus("latest", {
      platform: "linux",
      env,
      prependPath,
      sleep: async () => undefined,
      runInstall,
      logWarningFn: () => undefined,
    });

    expect(prependPath).toHaveBeenCalledWith("/test/data/bin");
    expect(env.PATH).toBe("/test/data/bin:/usr/bin");
  });
});
