import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { downloadFile, getSfwAssetName, setupSfw } from "./install-sfw.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-vp-test-"));
  tempDirs.push(dir);
  return dir;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

afterEach(() => {
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
    expect(() => getSfwAssetName("win32", "x64", false)).toThrow(
      "Unsupported platform/arch for sfw",
    );
  });

  it("does not set up sfw when disabled or run-install is disabled", async () => {
    expect(await setupSfw([{}], { SETUP_VP_SFW: "false" })).toBe("vp");
    expect(await setupSfw([], { SETUP_VP_SFW: "true" })).toBe("vp");
  });

  it("uses an existing sfw command from PATH", async () => {
    const dir = tempDir();
    const binDir = path.join(dir, "bin");
    mkdirSync(binDir);
    const sfwBin = path.join(binDir, "sfw");
    writeFileSync(sfwBin, "#!/usr/bin/env sh\nexit 0\n", "utf8");
    chmodSync(sfwBin, 0o755);

    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${binDir}:${previousPath || ""}`;
      expect(await setupSfw([{}], { SETUP_VP_SFW: "true", PATH: process.env.PATH })).toBe("sfw");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("uses curl for default downloads", async () => {
    const dir = tempDir();
    const binDir = path.join(dir, "bin");
    const outputPath = path.join(dir, "sfw");
    const logFile = path.join(dir, "curl.log");
    mkdirSync(binDir);

    const curlBin = path.join(binDir, "curl");
    writeFileSync(
      curlBin,
      [
        "#!/usr/bin/env sh",
        `printf '%s\\n' "$*" > ${shellQuote(logFile)}`,
        'out=""',
        'while [ "$#" -gt 0 ]; do',
        '  if [ "$1" = "-o" ]; then',
        "    shift",
        '    out="$1"',
        "    break",
        "  fi",
        "  shift",
        "done",
        'printf "sfw" > "$out"',
      ].join("\n"),
      "utf8",
    );
    chmodSync(curlBin, 0o755);

    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${binDir}:${previousPath || ""}`;
      await downloadFile("https://example.test/sfw", outputPath);
    } finally {
      process.env.PATH = previousPath;
    }

    expect(readFileSync(outputPath, "utf8")).toBe("sfw");
    expect(readFileSync(logFile, "utf8")).toContain("https://example.test/sfw");
    expect(readFileSync(logFile, "utf8")).toContain("--max-time 60");
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
