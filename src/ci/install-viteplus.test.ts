import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { writeFileSync } from "node:fs";
import { installVitePlus } from "./install-viteplus.js";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync }));

function result(status: number | null, error?: NodeJS.ErrnoException): SpawnSyncReturns<Buffer> {
  return {
    pid: 1,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status,
    signal: null,
    error,
  };
}

const missingCommand = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
const options = {
  platform: "win32" as const,
  sleep: async () => undefined,
  logWarningFn: () => undefined,
};

beforeEach(() => {
  spawnSync.mockReset();
});

describe("portable installer shell selection", () => {
  it.each(["0.2.9", "0.3.1"])(
    "uses Windows PowerShell when pwsh is missing for Vite+ %s",
    async (version) => {
      spawnSync.mockImplementation(
        (command: string, _args: string[], spawnOptions: SpawnSyncOptions) => {
          if (command === "pwsh") return result(null, missingCommand);
          if (command !== "powershell.exe") throw new Error(`Unexpected shell: ${command}`);
          const dirsFile = spawnOptions.env?.SETUP_VP_DIRS_FILE;
          if (dirsFile) {
            writeFileSync(
              dirsFile,
              "data\t/data\nbin\t/bin\ncache\t/cache\nconfig\t/config\nstate\t/state\n",
            );
          }
          return result(0);
        },
      );
      await installVitePlus(version, { ...options, env: { PATH: "" } });

      expect(spawnSync.mock.calls.map(([command]) => command)).toEqual(["pwsh", "powershell.exe"]);
      expect(spawnSync.mock.calls[1]!.slice(1)).toEqual(spawnSync.mock.calls[0]!.slice(1));
    },
  );

  it("prefers pwsh when it is available", async () => {
    spawnSync.mockReturnValue(result(0));
    await installVitePlus("0.2.9", { ...options, env: { PATH: "" } });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawnSync.mock.calls[0]![0]).toBe("pwsh");
  });

  it.each([
    { status: 23, error: undefined, reason: "exit code 23" },
    {
      status: null,
      error: Object.assign(new Error("spawn EACCES"), { code: "EACCES" }),
      reason: "EACCES",
    },
  ])("does not switch shells after $reason", async ({ status, error, reason }) => {
    spawnSync.mockReturnValue(result(status, error));
    await expect(installVitePlus("0.2.9", { ...options, env: { PATH: "" } })).rejects.toThrow(
      reason,
    );
    expect(spawnSync).toHaveBeenCalledTimes(8);
    expect(spawnSync.mock.calls.every(([command]) => command === "pwsh")).toBe(true);
  });

  it("does not try PowerShell when bash is missing on Unix", async () => {
    spawnSync.mockReturnValue(result(null, missingCommand));
    await expect(
      installVitePlus("0.2.9", { ...options, platform: "linux", env: { PATH: "" } }),
    ).rejects.toThrow("ENOENT");
    expect(spawnSync).toHaveBeenCalledTimes(8);
    expect(spawnSync.mock.calls.every(([command]) => command === "bash")).toBe(true);
  });
});
