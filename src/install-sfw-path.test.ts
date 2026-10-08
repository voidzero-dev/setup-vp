import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { setupSfw } from "./ci/install-sfw.js";
import { isWindows } from "./ci/platform.js";
import { commandPath } from "./ci/process.js";
import { findSfwOnPath } from "./install-sfw.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

it("does not execute planted lookup tools or reuse sfw from the working directory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "setup-vp-sfw-path-"));
  directories.push(root);
  const workspace = path.join(root, "workspace");
  const trustedBin = path.join(root, "trusted bin");
  const alias = path.join(root, "workspace-alias");
  const marker = path.join(root, "lookup-executed");
  const filename = isWindows() ? "sfw.exe" : "sfw";
  mkdirSync(workspace);
  mkdirSync(trustedBin);
  symlinkSync(workspace, alias, isWindows() ? "junction" : "dir");
  writeFileSync(path.join(workspace, filename), "workspace executable", { mode: 0o755 });
  vi.stubEnv("SETUP_VP_LOOKUP_MARKER", marker);

  if (isWindows()) {
    // A real PE executable makes a regressed execFileSync/spawnSync('where')
    // run the harmless marker hook, even without invoking a shell.
    copyFileSync(process.execPath, path.join(workspace, "where.exe"));
    const hook = path.join(root, "marker.cjs");
    writeFileSync(
      hook,
      "require('node:fs').writeFileSync(process.env.SETUP_VP_LOOKUP_MARKER, 'called'); process.exit(1);",
    );
    vi.stubEnv("NODE_OPTIONS", `--require ${JSON.stringify(hook)}`);
    writeFileSync(
      path.join(workspace, "where.cmd"),
      '@echo called > "%SETUP_VP_LOOKUP_MARKER%"\r\n@exit /b 1\r\n',
    );
  } else {
    for (const tool of ["which", "sh"]) {
      writeFileSync(
        path.join(workspace, tool),
        '#!/bin/sh\nprintf called > "$SETUP_VP_LOOKUP_MARKER"\nexit 1\n',
        { mode: 0o755 },
      );
    }
  }

  const originalCwd = process.cwd();
  try {
    process.chdir(workspace);
    // Cover implicit CWD, relative entries, absolute CWD, and a symlink/junction alias.
    vi.stubEnv(
      "PATH",
      ["", ".", "../workspace", workspace, alias, trustedBin].join(path.delimiter),
    );
    expect(commandPath("sfw")).toBeUndefined();
    expect(findSfwOnPath()).toBeNull();
    expect(existsSync(marker)).toBe(false);

    const binary = path.join(trustedBin, filename);
    writeFileSync(binary, "trusted executable", { mode: 0o755 });
    expect(commandPath("sfw")).toBe(binary);
    expect(findSfwOnPath()).toBe(binary);
    const download = vi.fn();
    expect(await setupSfw([{}], { sfwEnabled: true, download })).toBe("sfw");
    expect(download).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(false);
  } finally {
    process.chdir(originalCwd);
  }
});
