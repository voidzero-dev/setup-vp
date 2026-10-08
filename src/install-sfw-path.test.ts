import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { restoreCache, saveCache } from "@actions/cache";
import { addPath, setFailed } from "@actions/core";
import { exec } from "@actions/exec";
import { setupSfw } from "./ci/install-sfw.js";
import { runInstall } from "./ci/run-install.js";
import { isWindows } from "./ci/platform.js";
import { commandPath } from "./ci/process.js";
import { findSfwOnPath, setupSfw as setupGitHubSfw } from "./install-sfw.js";
import { runViteInstall } from "./run-install.js";
import type { InstallCommand } from "./ci/types.js";
import type { Inputs } from "./types.js";

vi.mock("@actions/cache", () => ({ restoreCache: vi.fn(), saveCache: vi.fn() }));
vi.mock("@actions/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@actions/core")>()),
  addPath: vi.fn(),
  setFailed: vi.fn(),
}));
// Keep getExecOutput real: the regression must reach actual process execution.
vi.mock("@actions/exec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@actions/exec")>()),
  exec: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe.each(["portable", "GitHub Actions"] as const)("%s sfw execution", (adapter) => {
  it.each(["existing", "download", "cache"] as const)(
    "executes the selected %s binary despite workspace binaries and PATH changes",
    async (source) => {
      const root = mkdtempSync(path.join(tmpdir(), "setup-vp-sfw-execute-"));
      directories.push(root);
      const workspace = path.join(root, "workspace");
      const installDir = path.join(workspace, "install directory");
      const trustedBin = path.join(root, "trusted bin");
      const marker = path.join(root, "executed");
      const filename = isWindows() ? "sfw.exe" : "sfw";
      mkdirSync(installDir, { recursive: true });
      mkdirSync(trustedBin);
      vi.stubEnv("SETUP_VP_EXECUTION_MARKER", marker);
      vi.stubEnv("RUNNER_TEMP", root);
      vi.stubEnv("SETUP_VP_SFW_CACHE_DIR", undefined);
      vi.stubEnv("NoDefaultCurrentDirectoryInExePath", undefined);

      if (isWindows()) {
        const hook = path.join(root, "record.cjs");
        writeFileSync(
          hook,
          `const fs = require('node:fs');
fs.writeFileSync(process.env.SETUP_VP_EXECUTION_MARKER, [process.argv0, ...process.argv.slice(1)].join('\\n') + '\\n');
process.exit(0);`,
        );
        vi.stubEnv("NODE_OPTIONS", `--require ${JSON.stringify(hook)}`);
      }

      function writeExecutable(file: string): void {
        mkdirSync(path.dirname(file), { recursive: true });
        if (isWindows()) {
          copyFileSync(process.execPath, file);
        } else {
          writeFileSync(
            file,
            '#!/bin/sh\nprintf "%s\\n" "$0" "$@" > "$SETUP_VP_EXECUTION_MARKER"\n',
            {
              mode: 0o755,
            },
          );
        }
      }
      writeExecutable(path.join(workspace, filename));
      writeExecutable(path.join(installDir, filename));
      const existing = path.join(trustedBin, filename);
      if (source === "existing") writeExecutable(existing);

      const inputs: Inputs = {
        version: "latest",
        sfw: true,
        cache: false,
        cacheSave: true,
        workingDirectory: workspace,
        runInstall: [{ cwd: "install directory", args: ["--frozen-lockfile", "", "two words"] }],
      };
      const originalCwd = process.cwd();
      try {
        process.chdir(workspace);
        vi.stubEnv("PATH", [workspace, trustedBin].join(path.delimiter));
        let command: InstallCommand;
        if (adapter === "portable") {
          const download = vi.fn(async (_url: string, file: string) => writeExecutable(file));
          // A relative cache setting must still produce an absolute executable path.
          const options = { sfwEnabled: true, download, cacheDirectory: "../portable cache" };
          const env = { ...process.env };
          if (source === "cache")
            await setupSfw(inputs.runInstall, { ...options, env: { ...env } });
          command = await setupSfw(inputs.runInstall, { ...options, env });
          expect(download).toHaveBeenCalledTimes(source === "existing" ? 0 : 1);
        } else {
          const binary = path.join(root, "sfw-bin", filename);
          if (source === "cache") {
            writeExecutable(binary);
            vi.mocked(restoreCache).mockResolvedValue("cached");
          }
          vi.mocked(exec).mockImplementation(async () => {
            writeExecutable(binary);
            return 0;
          });
          command = await setupGitHubSfw(inputs);
          expect(exec).toHaveBeenCalledTimes(source === "download" ? 1 : 0);
          expect(saveCache).toHaveBeenCalledTimes(source === "download" ? 1 : 0);
          expect(addPath).toHaveBeenCalledTimes(source === "existing" ? 0 : 1);
        }

        expect(command.sfw).toBe(true);
        expect(path.isAbsolute(command.executable)).toBe(true);
        if (source === "existing") expect(command.executable).toBe(existing);
        // Exercise both an explicit PATH attack and Windows' implicit child-CWD search.
        for (const searchPath of [[workspace, trustedBin].join(path.delimiter), trustedBin]) {
          vi.stubEnv("PATH", searchPath);
          if (adapter === "portable") await runInstall(inputs.runInstall, workspace, command);
          else await runViteInstall(inputs, command);
          expect(setFailed).not.toHaveBeenCalled();
          const [executed, wrapped, ...args] = readFileSync(marker, "utf8").trimEnd().split("\n");
          const expected = statSync(command.executable, { bigint: true });
          expect(statSync(executed!, { bigint: true })).toMatchObject({
            dev: expected.dev,
            ino: expected.ino,
          });
          // Node normalizes the first argument to a path before the Windows preload hook.
          expect(path.basename(wrapped!)).toBe("vp");
          expect(args).toEqual(["install", "--frozen-lockfile", "", "two words"]);
        }
      } finally {
        process.chdir(originalCwd);
      }
    },
    30_000,
  );
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
    expect(await setupSfw([{}], { sfwEnabled: true, download })).toEqual({
      executable: binary,
      sfw: true,
    });
    expect(download).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(false);
  } finally {
    process.chdir(originalCwd);
  }
});
