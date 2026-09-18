import { describe, expect, it } from "vite-plus/test";
import { isWindows } from "./platform.js";

describe("isWindows", () => {
  it("returns true for Windows", () => {
    expect(isWindows("win32")).toBe(true);
  });

  it.each(["aix", "darwin", "freebsd", "linux", "openbsd", "sunos"] as const)(
    "returns false for %s",
    (platform) => {
      expect(isWindows(platform)).toBe(false);
    },
  );
});
