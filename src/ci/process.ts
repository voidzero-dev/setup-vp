import { spawn, spawnSync } from "node:child_process";
import type { SpawnOptions, SpawnSyncOptions } from "node:child_process";

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

export function commandPath(command: string): string | undefined {
  if (process.platform === "win32") {
    const result = spawnSync("where", [command], { encoding: "utf8" });
    if (result.status === 0) {
      const line = result.stdout.trim().split(/\r?\n/)[0]?.trim();
      return line || undefined;
    }
    return undefined;
  }

  const result = spawnSync("sh", ["-c", 'command -v "$1"', "sh", command], {
    encoding: "utf8",
  });
  if (result.status === 0) return result.stdout.trim();
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
