import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { configureAuth } from "./auth.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "setup-vp-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("configureAuth", () => {
  it("writes registry auth config and updates the provided env object", () => {
    const targetEnv: Record<string, string | undefined> = {};
    const npmrc = configureAuth("https://npm.pkg.github.com", "MyOrg", targetEnv);

    expect(npmrc).toBeTruthy();
    if (!npmrc) throw new Error("expected configureAuth to return an npmrc path");
    tempDirs.push(path.dirname(npmrc));
    expect(targetEnv.NPM_CONFIG_USERCONFIG).toBe(npmrc);
    expect(targetEnv.PNPM_CONFIG_USERCONFIG).toBe(npmrc);
    expect(targetEnv.NODE_AUTH_TOKEN).toBe("XXXXX-XXXXX-XXXXX-XXXXX");
    expect(path.basename(path.dirname(npmrc))).toMatch(/^setup-vp-npmrc-/);
    expect(npmrc).not.toBe(path.join(tmpdir(), `setup-vp-npmrc.${process.pid}`));
    expect(statSync(npmrc).mode & 0o777).toBe(0o600);
    expect(readFileSync(npmrc, "utf8")).toBe(
      "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n@myorg:registry=https://npm.pkg.github.com/\n",
    );
  });

  it("writes registry auth exports for the GitLab job shell", () => {
    const dir = tempDir();
    const envFile = path.join(dir, "env.sh");
    writeFileSync(envFile, "", "utf8");

    const previousEnvFile = process.env.SETUP_VP_ENV_FILE;
    const previousNodeAuthToken = process.env.NODE_AUTH_TOKEN;
    const previousNpmConfig = process.env.NPM_CONFIG_USERCONFIG;
    const previousPnpmConfig = process.env.PNPM_CONFIG_USERCONFIG;

    try {
      process.env.SETUP_VP_ENV_FILE = envFile;
      delete process.env.NODE_AUTH_TOKEN;
      const npmrc = configureAuth("https://npm.pkg.github.com", "MyOrg");
      if (npmrc) tempDirs.push(path.dirname(npmrc));

      const exports = readFileSync(envFile, "utf8");
      expect(exports).toContain("export NPM_CONFIG_USERCONFIG=");
      expect(exports).toContain("export PNPM_CONFIG_USERCONFIG=");
      expect(exports).toContain("export NODE_AUTH_TOKEN='XXXXX-XXXXX-XXXXX-XXXXX'");
    } finally {
      if (previousEnvFile === undefined) delete process.env.SETUP_VP_ENV_FILE;
      else process.env.SETUP_VP_ENV_FILE = previousEnvFile;
      if (previousNodeAuthToken === undefined) delete process.env.NODE_AUTH_TOKEN;
      else process.env.NODE_AUTH_TOKEN = previousNodeAuthToken;
      if (previousNpmConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
      else process.env.NPM_CONFIG_USERCONFIG = previousNpmConfig;
      if (previousPnpmConfig === undefined) delete process.env.PNPM_CONFIG_USERCONFIG;
      else process.env.PNPM_CONFIG_USERCONFIG = previousPnpmConfig;
    }
  });

  it("rejects invalid registry URLs", () => {
    expect(() => configureAuth("not-a-url", "", {})).toThrow("Invalid registry-url");
  });

  it("skips registry auth when no registry URL is configured", () => {
    const targetEnv: Record<string, string | undefined> = {};
    expect(configureAuth("", "", targetEnv)).toBeUndefined();
    expect(targetEnv).toEqual({});
  });

  it("keeps an existing NODE_AUTH_TOKEN when configuring auth", () => {
    const targetEnv: Record<string, string | undefined> = { NODE_AUTH_TOKEN: "real-token" };
    const npmrc = configureAuth("https://registry.example.test/npm", "", targetEnv);
    if (npmrc) tempDirs.push(path.dirname(npmrc));
    expect(targetEnv.NODE_AUTH_TOKEN).toBe("real-token");
  });
});
