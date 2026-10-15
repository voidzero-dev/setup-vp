import { describe, expect, it, vi } from "vite-plus/test";
import { readEnvCurrent } from "./env-current.js";

const unknown = {
  nodeVersion: "unknown",
  packageManager: "unknown",
  packageManagerVersion: "unknown",
};

describe("readEnvCurrent", () => {
  it.each([
    ["vp v0.3.1", true],
    ["vp v1.0.0-rc.0", true],
    ["vp v0.0.0-commit.7d848b3da1987fa60b4cf18487fcc36a2a697e94", true],
    ["vp v0.3.0", false],
    ["", false],
    ["vp unknown", false],
  ])("runs vp env current for %j: %s", async (versionOutput, supported) => {
    const runEnvCurrent = vi.fn(() => JSON.stringify({ node: { version: "22.15.0" } }));
    const logWarning = vi.fn();

    const current = await readEnvCurrent(versionOutput, runEnvCurrent, logWarning);

    expect(runEnvCurrent).toHaveBeenCalledTimes(supported ? 1 : 0);
    expect(current.nodeVersion).toBe(supported ? "22.15.0" : "unknown");
    expect(logWarning).not.toHaveBeenCalled();
  });

  it("reads managed Node.js and package-manager versions", async () => {
    const output = JSON.stringify({
      node: {
        version: "24.20.0",
        source: "devEngines.runtime",
        source_path: "/project/package.json",
        project_root: "/project",
        bin_path: "/home/runner/.vite-plus/js_runtime/node/24.20.0/bin/node",
        installed: true,
        mode: "managed",
      },
      package_manager: {
        name: "bun",
        version: "1.4.2",
        source: "packageManager",
        source_path: "/project/package.json",
        project_root: "/project",
        bin_paths: { bun: "/home/runner/.vite-plus/package_manager/bun/1.4.2/bun/bin/bun" },
        installed: true,
        mode: "managed",
      },
    });

    expect(await readEnvCurrent("vp v0.3.1", () => output, vi.fn())).toEqual({
      nodeVersion: "24.20.0",
      packageManager: "bun",
      packageManagerVersion: "1.4.2",
    });
  });

  it("reads the system Node.js and reports unknown without a package manager", async () => {
    const output = JSON.stringify({
      node: {
        version: "22.15.0",
        source: "system PATH",
        bin_path: "/usr/local/bin/node",
        installed: true,
        mode: "system_first",
      },
    });
    const logWarning = vi.fn();

    expect(await readEnvCurrent("vp v0.3.1", async () => output, logWarning)).toEqual({
      ...unknown,
      nodeVersion: "22.15.0",
    });
    expect(logWarning).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", '{"version":"22.15.0"}'])(
    "reports unknown versions for %s",
    async (output) => {
      expect(await readEnvCurrent("vp v0.3.1", () => output, vi.fn())).toEqual(unknown);
    },
  );

  it.each([
    ["a failed command", () => undefined, "vp env current --json failed"],
    ["invalid JSON", () => "not json", "SyntaxError"],
    [
      "a thrown error",
      () => {
        throw new Error("spawn vp ENOENT");
      },
      "spawn vp ENOENT",
    ],
  ])("warns and reports unknown versions for %s", async (_name, runEnvCurrent, message) => {
    const logWarning = vi.fn();

    expect(await readEnvCurrent("vp v0.3.1", runEnvCurrent, logWarning)).toEqual(unknown);
    expect(logWarning).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(message));
  });

  it("rejects values that are not plain versions or names", async () => {
    const output = JSON.stringify({
      node: { version: "22.15.0\nSETUP_VP_CACHE_HIT=true" },
      package_manager: { name: "pnpm", version: 10 },
    });

    expect(await readEnvCurrent("vp v0.3.1", () => output, vi.fn())).toEqual({
      nodeVersion: "unknown",
      packageManager: "pnpm",
      packageManagerVersion: "unknown",
    });
  });
});
