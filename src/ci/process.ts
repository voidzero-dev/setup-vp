import { spawn, spawnSync } from "node:child_process";
import type { SpawnOptions, SpawnSyncOptions } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { isWindows } from "./platform.js";

export function run(command: string, args: string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status ?? 1}`);
}

/** Stream logs without retaining unbounded dependency-install output in memory. */
export function runWithOutput(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (data: Buffer) => {
      process.stdout.write(data);
      stdout = (stdout + data.toString()).slice(-4000);
    });
    child.stderr!.on("data", (data: Buffer) => {
      process.stderr.write(data);
      stderr = (stderr + data.toString()).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

// Resolve native executables without running a lookup tool from the workspace.
export function commandPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!command || command === "." || command === ".." || /[\\/:]/.test(command)) return undefined;

  const windows = isWindows();
  const pathKey = windows
    ? Object.keys(env)
        .sort()
        .find((key) => key.toUpperCase() === "PATH")
    : "PATH";
  const searchPath = (pathKey && env[pathKey]) || "";
  const filename = windows && !command.toLowerCase().endsWith(".exe") ? `${command}.exe` : command;
  const cwd = statSync(process.cwd(), { bigint: true });

  for (const entry of searchPath.split(path.delimiter)) {
    const directory = windows ? entry.replace(/^"(.*)"$/, "$1") : entry;
    // Empty and relative entries can refer to attacker-controlled checkout files.
    if (!path.isAbsolute(directory)) continue;
    // On Windows, isAbsolute also accepts drive-root-relative paths such as
    // \trusted. These change meaning when the install cwd is on another drive.
    if (windows && path.parse(directory).root.length === 1) continue;
    try {
      // Filesystem identity covers case aliases and symlinks without assuming
      // that all volumes on the same operating system use the same case rules.
      const directoryStat = statSync(directory, { bigint: true });
      if (directoryStat.dev === cwd.dev && directoryStat.ino === cwd.ino) continue;

      const candidate = path.join(directory, filename);
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, windows ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Missing or inaccessible entries do not prevent searching the rest of PATH.
    }
  }
  return undefined;
}

export function getCommandOutput(
  command: string,
  args: string[],
  options?: { cwd?: string },
): string | undefined {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout.trim();
  return undefined;
}
