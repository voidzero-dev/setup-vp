import { describe, expect, it, vi } from "vite-plus/test";
import { installVitePlus } from "./install-viteplus.js";

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
    const runInstall = vi.fn((_url: string) => 1);
    const warnings: string[] = [];

    await expect(
      installVitePlus("0.2.9", {
        platform: "linux",
        env: { PATH: "" },
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
    expect(warnings.some((message) => message.includes("falling back to the latest"))).toBe(true);
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
  });
});
