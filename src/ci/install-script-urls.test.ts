import { describe, it, expect } from "vite-plus/test";
import { getInstallScriptSources, pkgPrNewCommitSha } from "./install-script-urls.js";

const commitSha = "7d848b3da1987fa60b4cf18487fcc36a2a697e94";

describe("pkgPrNewCommitSha", () => {
  it("extracts the SHA from a pkg.pr.new commit build", () => {
    expect(pkgPrNewCommitSha(`0.0.0-commit.${commitSha}`)).toBe(commitSha);
  });

  it("returns undefined for regular versions and near-miss SHA lengths", () => {
    expect(pkgPrNewCommitSha("0.2.9")).toBeUndefined();
    expect(pkgPrNewCommitSha(`0.0.0-commit.${commitSha.slice(0, 39)}`)).toBeUndefined();
  });
});

describe("getInstallScriptSources", () => {
  it("pins historical versions to a commit and the same checksum on both mirrors", () => {
    const { pinned } = getInstallScriptSources("0.2.9", "linux");
    expect(pinned.map(({ url }) => url)).toEqual([
      "https://raw.githubusercontent.com/voidzero-dev/vite-plus/73bdd105c2b7c263b55f7e9b48a37a8933cc317a/packages/cli/install.sh",
      "https://cdn.jsdelivr.net/gh/voidzero-dev/vite-plus@73bdd105c2b7c263b55f7e9b48a37a8933cc317a/packages/cli/install.sh",
    ]);
    expect(pinned[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(pinned[1]!.sha256).toBe(pinned[0]!.sha256);
    expect(pinned[0]!.legacy).toBeUndefined();
  });

  it("keeps prerelease-specific pins", () => {
    const { pinned } = getInstallScriptSources("0.1.21-alpha.7", "linux");
    expect(pinned[0]!.url).toContain("/c61621ac610ad114746b98d7e457ca4e13171837/");
  });

  it.each([
    "latest",
    "next",
    "99.0.0",
    "^0.2.0",
    "0.2",
    "0.2.x",
    "0.2.9+build.5",
    "",
    "__proto__",
    `0.0.0-commit.${commitSha}`,
  ])("uses only the bundled fallback pin for %j", (version) => {
    const { pinned, fallback } = getInstallScriptSources(version, "linux");
    expect(pinned).toEqual([]);
    expect(fallback).toEqual(getInstallScriptSources("latest", "linux").fallback);
    expect(fallback).toHaveLength(2);
  });

  it.each(["linux", "win32"] as const)(
    "pins all %s files, including legacy dependencies",
    (platform) => {
      const { fallback } = getInstallScriptSources("latest", platform);
      const extension = platform === "win32" ? "ps1" : "sh";
      for (const source of fallback) {
        expect(source.url).toMatch(
          new RegExp(`[/@][a-f0-9]{40}/packages/cli/install\\.${extension}$`),
        );
        expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(source.legacy?.url).toBe(
          source.url.replace(`install.${extension}`, `install-legacy.${extension}`),
        );
        expect(source.legacy?.sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    },
  );
});
