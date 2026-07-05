import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { commandPath, exportShellEnv, shellQuote } from "./shell.js";

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

describe("GitLab shell helpers", () => {
  it("quotes shell environment values", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("has spaces")).toBe("'has spaces'");
    expect(shellQuote("it's ok")).toBe("'it'\\''s ok'");
  });

  it("appends shell exports when an env file is configured", () => {
    const dir = tempDir();
    const envFile = path.join(dir, "env.sh");
    writeFileSync(envFile, "", "utf8");

    exportShellEnv("SETUP_VP_TEST", "value with ' quote", { SETUP_VP_ENV_FILE: envFile });

    expect(readFileSync(envFile, "utf8")).toBe("export SETUP_VP_TEST='value with '\\'' quote'\n");
  });

  it("does not write shell exports without an env file or value", () => {
    exportShellEnv("SETUP_VP_TEST", "value", {});
    exportShellEnv("SETUP_VP_TEST", undefined, { SETUP_VP_ENV_FILE: "unused" });
  });

  it("finds commands on PATH", () => {
    expect(commandPath("sh")).toBeTruthy();
    expect(commandPath("setup-vp-command-that-should-not-exist")).toBeUndefined();
  });

  it("does not interpolate command names into shell source", () => {
    const dir = tempDir();
    const marker = path.join(dir, "injected");

    expect(commandPath(`sh"; printf injected > ${marker}; #`)).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });
});
