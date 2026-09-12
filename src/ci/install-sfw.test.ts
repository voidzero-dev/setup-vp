import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { setupSfw, SFW_VERSION } from "./install-sfw.js";

vi.mock("./process.js", () => ({ commandPath: () => undefined }));
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
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
