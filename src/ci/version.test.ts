import { describe, expect, it } from "vite-plus/test";
import { parseInstalledVpVersion } from "./version.js";

describe("parseInstalledVpVersion", () => {
  it("parses current and legacy vp --version output", () => {
    expect(parseInstalledVpVersion("vp v0.2.2\n")).toBe("0.2.2");
    expect(parseInstalledVpVersion("- Global: v0.2.0\n")).toBe("0.2.0");
    expect(parseInstalledVpVersion("unexpected")).toBe("unknown");
  });
});
