import { describe, it, expect } from "vite-plus/test";
import { getSfwAssetName, isSfwSupported } from "./install-sfw.js";

describe("getSfwAssetName", () => {
  it("returns macOS arm64 asset", () => {
    expect(getSfwAssetName("darwin", "arm64", false)).toBe("sfw-free-macos-arm64");
  });

  it("returns macOS x64 asset", () => {
    expect(getSfwAssetName("darwin", "x64", false)).toBe("sfw-free-macos-x86_64");
  });

  it("ignores isMusl on darwin", () => {
    expect(getSfwAssetName("darwin", "arm64", true)).toBe("sfw-free-macos-arm64");
    expect(getSfwAssetName("darwin", "x64", true)).toBe("sfw-free-macos-x86_64");
  });

  it("returns Linux glibc arm64 asset", () => {
    expect(getSfwAssetName("linux", "arm64", false)).toBe("sfw-free-linux-arm64");
  });

  it("returns Linux glibc x64 asset", () => {
    expect(getSfwAssetName("linux", "x64", false)).toBe("sfw-free-linux-x86_64");
  });

  it("returns Linux musl arm64 asset", () => {
    expect(getSfwAssetName("linux", "arm64", true)).toBe("sfw-free-musl-linux-arm64");
  });

  it("returns Linux musl x64 asset", () => {
    expect(getSfwAssetName("linux", "x64", true)).toBe("sfw-free-musl-linux-x86_64");
  });

  it("returns Windows arm64 asset", () => {
    expect(getSfwAssetName("win32", "arm64", false)).toBe("sfw-free-windows-arm64.exe");
  });

  it("returns Windows x64 asset", () => {
    expect(getSfwAssetName("win32", "x64", false)).toBe("sfw-free-windows-x86_64.exe");
  });

  it("ignores isMusl on win32", () => {
    expect(getSfwAssetName("win32", "x64", true)).toBe("sfw-free-windows-x86_64.exe");
  });

  it("throws on unsupported platform", () => {
    expect(() => getSfwAssetName("freebsd" as NodeJS.Platform, "x64", false)).toThrow(
      /freebsd\/x64/,
    );
  });

  it("throws on unsupported arch", () => {
    expect(() => getSfwAssetName("linux", "ia32", false)).toThrow(/linux\/ia32/);
  });

  it("includes libc in error message for unsupported Linux arch", () => {
    expect(() => getSfwAssetName("linux", "ia32", true)).toThrow(/musl/);
    expect(() => getSfwAssetName("linux", "ia32", false)).toThrow(/glibc/);
  });
});

describe("isSfwSupported", () => {
  it("returns true on Linux, false elsewhere (matches current platform)", () => {
    expect(isSfwSupported()).toBe(process.platform === "linux");
  });
});
