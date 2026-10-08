import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configAuthentication, propagateProjectNpmrcAuth } from "./auth.js";
import { exportVariable, info } from "@actions/core";

vi.mock("@actions/core", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  exportVariable: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe("configAuthentication", () => {
  const runnerTemp = resolve("/tmp/runner");

  beforeEach(() => {
    vi.stubEnv("RUNNER_TEMP", runnerTemp);
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("should write .npmrc with registry and auth token", () => {
    configAuthentication("https://registry.npmjs.org/");

    const expectedPath = join(runnerTemp, ".npmrc");
    expect(writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}"),
    );
    expect(writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("registry=https://registry.npmjs.org/"),
    );
  });

  it("should append trailing slash if missing", () => {
    configAuthentication("https://registry.npmjs.org");

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("registry=https://registry.npmjs.org/"),
    );
  });

  it("should auto-detect scope for GitHub Packages registry", () => {
    vi.stubEnv("GITHUB_REPOSITORY_OWNER", "voidzero-dev");

    configAuthentication("https://npm.pkg.github.com");

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("@voidzero-dev:registry=https://npm.pkg.github.com/"),
    );
  });

  it("should use explicit scope", () => {
    configAuthentication("https://npm.pkg.github.com", "@myorg");

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("@myorg:registry=https://npm.pkg.github.com/"),
    );
  });

  it("should prepend @ to scope if missing", () => {
    configAuthentication("https://npm.pkg.github.com", "myorg");

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("@myorg:registry=https://npm.pkg.github.com/"),
    );
  });

  it("should lowercase scope", () => {
    configAuthentication("https://npm.pkg.github.com", "@MyOrg");

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("@myorg:registry=https://npm.pkg.github.com/"),
    );
  });

  it("should preserve existing .npmrc content except registry and auth lines", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      [
        "always-auth=true",
        "registry=https://old.reg/",
        "//old.reg/:_authToken=${NODE_AUTH_TOKEN}",
      ].join("\n"),
    );

    configAuthentication("https://registry.npmjs.org/");

    const written = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    expect(written).toContain("always-auth=true");
    expect(written).not.toContain("https://old.reg/");
    expect(written).toContain("registry=https://registry.npmjs.org/");
  });

  it("should remove existing auth token lines for the same registry", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      [
        "//registry.npmjs.org/:_authToken=old-token",
        "registry=https://registry.npmjs.org/",
        "other-config=true",
      ].join("\n"),
    );

    configAuthentication("https://registry.npmjs.org/");

    const written = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    expect(written).not.toContain("old-token");
    expect(written).toContain("other-config=true");
    expect(written).toContain("//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}");
  });

  it("should handle Windows-style line endings in existing .npmrc", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("always-auth=true\r\nregistry=https://old.reg/\r\n");

    configAuthentication("https://registry.npmjs.org/");

    const written = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    expect(written).toContain("always-auth=true");
    expect(written).not.toContain("https://old.reg/");
  });

  it("should not auto-detect scope for lookalike GitHub Packages URLs", () => {
    vi.stubEnv("GITHUB_REPOSITORY_OWNER", "voidzero-dev");

    configAuthentication("https://npm.pkg.github.com.evil.example");

    const written = vi.mocked(writeFileSync).mock.calls[0]![1] as string;
    // Should NOT have scoped registry — the host doesn't match exactly
    expect(written).not.toContain("@voidzero-dev:");
  });

  it("should throw on invalid URL", () => {
    expect(() => configAuthentication("not-a-url")).toThrow("Invalid registry-url");
  });

  it("should export NPM_CONFIG_USERCONFIG", () => {
    configAuthentication("https://registry.npmjs.org/");

    expect(exportVariable).toHaveBeenCalledWith(
      "NPM_CONFIG_USERCONFIG",
      join(runnerTemp, ".npmrc"),
    );
  });

  it("should export PNPM_CONFIG_USERCONFIG", () => {
    configAuthentication("https://registry.npmjs.org/");

    expect(exportVariable).toHaveBeenCalledWith(
      "PNPM_CONFIG_USERCONFIG",
      join(runnerTemp, ".npmrc"),
    );
  });

  it("should export NODE_AUTH_TOKEN placeholder when not set", () => {
    configAuthentication("https://registry.npmjs.org/");

    expect(exportVariable).toHaveBeenCalledWith("NODE_AUTH_TOKEN", "XXXXX-XXXXX-XXXXX-XXXXX");
  });

  it("should preserve existing NODE_AUTH_TOKEN", () => {
    vi.stubEnv("NODE_AUTH_TOKEN", "my-real-token");

    configAuthentication("https://registry.npmjs.org/");

    expect(exportVariable).toHaveBeenCalledWith("NODE_AUTH_TOKEN", "my-real-token");
  });
});

describe("propagateProjectNpmrcAuth", () => {
  const runnerTemp = resolve("/tmp/runner");
  const projectDir = resolve("/workspace/project");
  const npmrcPath = join(projectDir, ".npmrc");
  const supplementalPath = join(runnerTemp, ".npmrc");

  function mockNpmrc(content: string, supplemental?: string): void {
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (p === npmrcPath) return content;
      if (p === supplementalPath && supplemental !== undefined) return supplemental;
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    });
    vi.mocked(existsSync).mockImplementation(
      (p) => p === supplementalPath && supplemental !== undefined,
    );
  }

  function mockNoNpmrc(): void {
    vi.mocked(readFileSync).mockImplementation(() => {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    });
    vi.mocked(existsSync).mockReturnValue(false);
  }

  beforeEach(() => {
    vi.stubEnv("RUNNER_TEMP", runnerTemp);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("does nothing when there is no project .npmrc", () => {
    mockNoNpmrc();

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("exports referenced env vars that are set in the environment", () => {
    mockNpmrc("//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}");
    vi.stubEnv("NODE_AUTH_TOKEN", "my-real-token");

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).toHaveBeenCalledWith("NODE_AUTH_TOKEN", "my-real-token");
    expect(info).toHaveBeenCalledWith(expect.stringContaining(".npmrc"));
  });

  it("skips env vars that are not set", () => {
    mockNpmrc("//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}");
    vi.stubEnv("NODE_AUTH_TOKEN", "");

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).not.toHaveBeenCalled();
  });

  it("does not re-export PATH or HOME even if referenced", () => {
    mockNpmrc("cache=${HOME}/.npm-cache");
    vi.stubEnv("HOME", "/home/runner");

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).not.toHaveBeenCalledWith("HOME", expect.anything());
  });

  it("blocks runner-managed GITHUB_* and RUNNER_* vars by default", () => {
    mockNpmrc(
      [
        "tag=${GITHUB_REF}",
        "agent=${RUNNER_NAME}",
        "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}",
      ].join("\n"),
    );
    vi.stubEnv("GITHUB_REF", "refs/heads/main");
    vi.stubEnv("RUNNER_NAME", "runner-1");
    vi.stubEnv("NODE_AUTH_TOKEN", "tok");

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).not.toHaveBeenCalledWith("GITHUB_REF", expect.anything());
    expect(exportVariable).not.toHaveBeenCalledWith("RUNNER_NAME", expect.anything());
    expect(exportVariable).toHaveBeenCalledWith("NODE_AUTH_TOKEN", "tok");
  });

  it("allows GITHUB_TOKEN through as an auth token", () => {
    mockNpmrc("//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}");
    vi.stubEnv("GITHUB_TOKEN", "gh-token");

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).toHaveBeenCalledWith("GITHUB_TOKEN", "gh-token");
  });

  it("exports all referenced auth-like env vars, deduping repeats", () => {
    mockNpmrc(
      [
        "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}",
        "//registry.example.com/:_authToken=${NPM_TOKEN}",
        "//other.example.com/:_authToken=${GITHUB_TOKEN}",
      ].join("\n"),
    );
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    vi.stubEnv("NPM_TOKEN", "npm-token");

    propagateProjectNpmrcAuth(projectDir);

    expect(exportVariable).toHaveBeenCalledWith("GITHUB_TOKEN", "gh-token");
    expect(exportVariable).toHaveBeenCalledWith("NPM_TOKEN", "npm-token");
    const ghCalls = vi.mocked(exportVariable).mock.calls.filter((c) => c[0] === "GITHUB_TOKEN");
    expect(ghCalls).toHaveLength(1);
  });

  it("rethrows non-ENOENT read errors", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });

    expect(() => propagateProjectNpmrcAuth(projectDir)).toThrow("EACCES");
  });

  it.each([
    "registry=https://attacker.invalid/",
    "@scope:registry=https://attacker.invalid/npm/",
    "registry=https://registry.npmjs.org/\n@scope:registry=https://attacker.invalid/",
  ])("does not add auth for repository-controlled registries: %s", (content) => {
    mockNpmrc(content);
    vi.stubEnv("NODE_AUTH_TOKEN", "secret");

    propagateProjectNpmrcAuth(projectDir);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(exportVariable).not.toHaveBeenCalled();
  });

  it("preserves explicit auth without adding tokens for other project registries", () => {
    mockNpmrc(
      [
        "registry=https://attacker.invalid/",
        "@myorg:registry=https://npm.pkg.github.com",
        "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}",
      ].join("\n"),
    );
    vi.stubEnv("NODE_AUTH_TOKEN", "ghp_xxx");
    vi.stubEnv("GITHUB_TOKEN", "gh-token");

    propagateProjectNpmrcAuth(projectDir);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(exportVariable).toHaveBeenCalledExactlyOnceWith("GITHUB_TOKEN", "gh-token");
  });

  it("does not write supplemental .npmrc when NODE_AUTH_TOKEN is not set", () => {
    mockNpmrc("@myorg:registry=https://npm.pkg.github.com");

    propagateProjectNpmrcAuth(projectDir);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(exportVariable).not.toHaveBeenCalledWith("NPM_CONFIG_USERCONFIG", expect.anything());
    expect(exportVariable).not.toHaveBeenCalledWith("PNPM_CONFIG_USERCONFIG", expect.anything());
  });

  it("leaves the runner user config unchanged for project registries", () => {
    mockNpmrc(
      "@scope:registry=https://attacker.invalid/",
      "strict-ssl=true\n//trusted.example/:_authToken=${CUSTOM_TOKEN}",
    );
    vi.stubEnv("NODE_AUTH_TOKEN", "secret");

    propagateProjectNpmrcAuth(projectDir);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(exportVariable).not.toHaveBeenCalled();
    expect(readFileSync).toHaveBeenCalledExactlyOnceWith(npmrcPath, "utf8");
  });

  it("propagates environment references in registry values without adding auth", () => {
    mockNpmrc("@myorg:registry=${CUSTOM_REGISTRY}");
    vi.stubEnv("NODE_AUTH_TOKEN", "tok");
    vi.stubEnv("CUSTOM_REGISTRY", "https://npm.example.com");

    propagateProjectNpmrcAuth(projectDir);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(exportVariable).toHaveBeenCalledWith("CUSTOM_REGISTRY", "https://npm.example.com");
  });

  it("propagates token references from uppercase auth keys without adding auth", () => {
    mockNpmrc(
      [
        "@myorg:registry=https://npm.pkg.github.com",
        "//npm.pkg.github.com/:_AUTHTOKEN=${NODE_AUTH_TOKEN}",
      ].join("\n"),
    );
    vi.stubEnv("NODE_AUTH_TOKEN", "tok");

    propagateProjectNpmrcAuth(projectDir);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(exportVariable).toHaveBeenCalledExactlyOnceWith("NODE_AUTH_TOKEN", "tok");
  });
});
