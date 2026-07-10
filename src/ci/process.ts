import { spawnSync } from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";

export function run(command: string, args: string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
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
