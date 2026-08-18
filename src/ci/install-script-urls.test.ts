import { describe, it, expect } from "vite-plus/test";
import { getInstallScriptUrls, pkgPrNewCommitSha } from "./install-script-urls.js";

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

describe("getInstallScriptUrls", () => {
  it("pins an exact version to its release tag, with jsDelivr as mirror", () => {
    const { pinned, latest } = getInstallScriptUrls("0.2.9", "linux");
    expect(pinned).toEqual([
      "https://raw.githubusercontent.com/voidzero-dev/vite-plus/v0.2.9/packages/cli/install.sh",
      "https://cdn.jsdelivr.net/gh/voidzero-dev/vite-plus@v0.2.9/packages/cli/install.sh",
    ]);
    expect(latest).toEqual([
      "https://viteplus.dev/install.sh",
      "https://raw.githubusercontent.com/voidzero-dev/vite-plus/main/packages/cli/install.sh",
    ]);
  });

  it("pins prerelease versions to their release tag", () => {
    const { pinned } = getInstallScriptUrls("0.1.21-alpha.7", "linux");
    expect(pinned[0]).toContain("/v0.1.21-alpha.7/");
  });

  it("pins pkg.pr.new commit builds to the commit, lowercasing the SHA", () => {
    const { pinned } = getInstallScriptUrls(`0.0.0-commit.${commitSha.toUpperCase()}`, "linux");
    expect(pinned).toEqual([
      `https://raw.githubusercontent.com/voidzero-dev/vite-plus/${commitSha}/packages/cli/install.sh`,
      `https://cdn.jsdelivr.net/gh/voidzero-dev/vite-plus@${commitSha}/packages/cli/install.sh`,
    ]);
  });

  it.each(["latest", "next", "^0.2.0", "0.2", "0.2.x", "0.2.9+build.5", ""])(
    "does not pin %j",
    (version) => {
      const { pinned, latest } = getInstallScriptUrls(version, "linux");
      expect(pinned).toEqual([]);
      expect(latest).toHaveLength(2);
    },
  );

  it("uses install.ps1 on Windows for both pinned and latest URLs", () => {
    const { pinned, latest } = getInstallScriptUrls("0.2.9", "win32");
    for (const url of [...pinned, ...latest]) {
      expect(url).toMatch(/install\.ps1$/);
    }
  });
});
