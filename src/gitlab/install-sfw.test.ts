import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadFile, getSfwAssetName, setupSfw } from "./install-sfw.js";
import { commandPath } from "../ci/process.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
vi.mock("../ci/process.js", () => ({ commandPath: vi.fn() }));

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-vp-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.resetAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GitLab sfw setup", () => {
  it("maps supported sfw release asset names", () => {
    expect(getSfwAssetName("linux", "x64", false)).toBe("sfw-free-linux-x86_64");
    expect(getSfwAssetName("linux", "x64", true)).toBe("sfw-free-musl-linux-x86_64");
    expect(getSfwAssetName("linux", "arm64", false)).toBe("sfw-free-linux-arm64");
    expect(getSfwAssetName("darwin", "arm64", false)).toBe("sfw-free-macos-arm64");
    expect(getSfwAssetName("win32", "x64", false)).toBe("sfw-free-windows-x86_64.exe");
    expect(getSfwAssetName("win32", "arm64", false)).toBe("sfw-free-windows-arm64.exe");
  });

  it("does not set up sfw when disabled or run-install is disabled", async () => {
    expect(await setupSfw([{}], { SETUP_VP_SFW: "false" })).toEqual({
      executable: "vp",
      sfw: false,
    });
    expect(await setupSfw([], { SETUP_VP_SFW: "true" })).toEqual({ executable: "vp", sfw: false });
  });

  it("uses an existing sfw command from PATH", async () => {
    const executable = path.join(tempDir(), "sfw");
    vi.mocked(commandPath).mockReturnValue(executable);

    expect(await setupSfw([{}], { SETUP_VP_SFW: "true" })).toEqual({ executable, sfw: true });
    expect(commandPath).toHaveBeenCalledWith("sfw", { SETUP_VP_SFW: "true" });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("uses curl for default downloads", async () => {
    const dir = tempDir();
    const outputPath = path.join(dir, "sfw");
    const curl = path.join(dir, "bin with spaces", "curl");
    vi.mocked(commandPath).mockReturnValue(curl);
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
    });

    await downloadFile("https://example.test/sfw", outputPath);

    expect(commandPath).toHaveBeenCalledWith("curl");
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      curl,
      [
        "-fsSL",
        "--connect-timeout",
        "5",
        "--max-time",
        "60",
        "https://example.test/sfw",
        "-o",
        outputPath,
      ],
      { stdio: "ignore" },
    );
  });

  it("times out stalled downloads", async () => {
    const dir = tempDir();
    const stalledClient: Parameters<typeof downloadFile>[4] = () => {
      const request = new EventEmitter() as EventEmitter & {
        destroy(error?: Error): void;
      };
      request.destroy = (error?: Error) => {
        if (error) request.emit("error", error);
      };
      return request as ReturnType<NonNullable<Parameters<typeof downloadFile>[4]>>;
    };

    await expect(
      downloadFile("http://example.test/sfw", path.join(dir, "sfw"), 0, 20, stalledClient),
    ).rejects.toThrow("download timed out after 20ms");
  });

  it("uses the override client when following redirects", async () => {
    const dir = tempDir();
    const urls: string[] = [];
    const redirectingClient: Parameters<typeof downloadFile>[4] = (url, callbackOrOptions) => {
      if (typeof url !== "string") throw new Error("expected string URL");
      if (typeof callbackOrOptions !== "function") throw new Error("expected response callback");
      const callback = callbackOrOptions;
      urls.push(url);
      const request = new EventEmitter() as EventEmitter & { destroy(error?: Error): void };
      request.destroy = (error?: Error) => {
        if (error) request.emit("error", error);
      };

      queueMicrotask(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: { location?: string };
          pipe(file: NodeJS.WritableStream): NodeJS.WritableStream;
          resume(): void;
        };
        response.headers = {};
        response.pipe = (file) => {
          queueMicrotask(() => file.end("sfw"));
          return file;
        };
        response.resume = () => undefined;

        if (urls.length === 1) {
          response.statusCode = 302;
          response.headers.location = "https://example.test/sfw";
          callback(response as unknown as IncomingMessage);
          return;
        }

        response.statusCode = 200;
        callback(response as unknown as IncomingMessage);
      });

      return request as ReturnType<NonNullable<Parameters<typeof downloadFile>[4]>>;
    };

    await downloadFile(
      "http://example.test/sfw",
      path.join(dir, "sfw"),
      0,
      1_000,
      redirectingClient,
    );

    expect(urls).toEqual(["http://example.test/sfw", "https://example.test/sfw"]);
  });
});
