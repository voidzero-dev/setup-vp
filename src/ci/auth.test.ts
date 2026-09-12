import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { configureAuth, isReservedAuthVariable } from "./auth.js";
import type { RuntimeEnv } from "./types.js";

const directories: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-vp-auth-"));
  directories.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("portable project auth", () => {
  it("supplements scoped registries, preserves user config, and never writes secret values", () => {
    const project = tempDir();
    const userConfig = path.join(tempDir(), ".npmrc");
    const content =
      "@scope:registry=https://registry.example/npm/\n//other.example/:_authToken=${CUSTOM_TOKEN}\n";
    writeFileSync(path.join(project, ".npmrc"), content);
    writeFileSync(userConfig, "strict-ssl=true\n");
    const env: RuntimeEnv = {
      NODE_AUTH_TOKEN: "secret",
      CUSTOM_TOKEN: "other-secret",
      NPM_CONFIG_USERCONFIG: userConfig,
    };
    const exporter = vi.fn();
    const npmrc = configureAuth("", "", env, exporter, project)!;
    directories.push(path.dirname(npmrc));
    const result = readFileSync(npmrc, "utf8");
    expect(result).toContain("strict-ssl=true");
    expect(result).toContain("//registry.example/npm/:_authToken=${NODE_AUTH_TOKEN}");
    expect(result).not.toContain("secret");
    expect(readFileSync(path.join(project, ".npmrc"), "utf8")).toBe(content);
    expect(statSync(npmrc).mode & 0o777).toBe(0o600);
    expect(exporter).toHaveBeenCalledWith("NODE_AUTH_TOKEN", "secret");
    expect(exporter).toHaveBeenCalledWith("CUSTOM_TOKEN", "other-secret");
    expect(env.PNPM_CONFIG_USERCONFIG).toBe(npmrc);
  });

  it("does not replace explicit project auth or expand environment references in registry keys", () => {
    const project = tempDir();
    writeFileSync(
      path.join(project, ".npmrc"),
      [
        "registry=https://registry.example/",
        "//registry.example/:_authToken=${CUSTOM_TOKEN}",
        "@other:registry=https://${REGISTRY_HOST}/",
        "cache=${PATH}",
        "other=${AGENT_TEMPDIRECTORY}",
      ].join("\n"),
    );
    const exporter = vi.fn();
    expect(
      configureAuth(
        "",
        "",
        {
          NODE_AUTH_TOKEN: "secret",
          CUSTOM_TOKEN: "custom",
          PATH: "/bin",
          AGENT_TEMPDIRECTORY: "/tmp",
        },
        exporter,
        project,
      ),
    ).toBeUndefined();
    expect(exporter.mock.calls).toEqual([["CUSTOM_TOKEN", "custom"]]);
  });

  it("does not invent supplemental tokens when NODE_AUTH_TOKEN is absent", () => {
    const project = tempDir();
    writeFileSync(path.join(project, ".npmrc"), "registry=https://registry.example/");
    const env: RuntimeEnv = {};
    expect(configureAuth("", "", env, undefined, project)).toBeUndefined();
    expect(env).toEqual({});
  });

  it("reserves provider-managed environment names while allowing CI auth tokens", () => {
    for (const name of [
      "PATH",
      "SETUP_VP_ENV_FILE",
      "BUILD_BUILDID",
      "SYSTEM_DEBUG",
      "CI_PROJECT_DIR",
      "RUNNER_OS",
    ]) {
      expect(isReservedAuthVariable(name)).toBe(true);
    }
    for (const name of ["NODE_AUTH_TOKEN", "CUSTOM_TOKEN", "CI_JOB_TOKEN", "SYSTEM_ACCESSTOKEN"]) {
      expect(isReservedAuthVariable(name)).toBe(false);
    }
  });
});
