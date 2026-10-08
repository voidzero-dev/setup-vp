import { accessSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commandPath } from "./process.js";
import { runInstall } from "./run-install.js";

// Exercise Windows path rules on every host; native execution is covered separately.
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, default: actual.win32 };
});
vi.mock("./platform.js", () => ({ isWindows: () => true }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  accessSync: vi.fn(),
  statSync: vi.fn((file: string) => ({
    dev: 1n,
    ino: file === String.raw`C:\source` ? 1n : 2n,
    isFile: () => true,
  })),
}));

beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(String.raw`C:\source`);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Windows command paths", () => {
  it.each([
    String.raw`\trusted`,
    "/trusted",
    String.raw`"\trusted"`,
    "\\",
    "/",
    String.raw`C:trusted`,
  ])("rejects %s before inspecting a file relative to the setup drive", (directory) => {
    expect(commandPath("sfw", { PATH: directory })).toBeUndefined();
    expect(statSync).toHaveBeenCalledExactlyOnceWith(String.raw`C:\source`, { bigint: true });
    expect(accessSync).not.toHaveBeenCalled();
  });

  it.each([
    String.raw`C:\trusted`,
    "C:/trusted",
    String.raw`"C:\trusted bin"`,
    String.raw`\\server\share\trusted`,
    "//server/share/trusted",
    String.raw`\\?\C:\trusted`,
    String.raw`\\?\UNC\server\share\trusted`,
  ])("retains the qualified path %s when installation uses another drive", async (directory) => {
    const executable = commandPath("sfw", { PATH: `\\unqualified;${directory}` });
    const expected = path.join(directory.replace(/^"(.*)"$/, "$1"), "sfw.exe");
    expect(executable).toBe(expected);

    const execute = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const installCwd = String.raw`D:\project`;
    await runInstall([{}], installCwd, { executable: executable!, sfw: true }, {}, { execute });
    expect(execute).toHaveBeenCalledExactlyOnceWith(expected, ["vp", "install"], {
      cwd: installCwd,
      env: {},
    });
    expect(path.resolve(installCwd, executable!)).toBe(
      path.resolve(String.raw`C:\source`, expected),
    );
  });
});
