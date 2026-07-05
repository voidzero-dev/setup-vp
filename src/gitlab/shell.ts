import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptions } from "node:child_process";

export function shellQuote(value: string): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function exportShellEnv(
  name: string,
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.SETUP_VP_ENV_FILE || value === undefined) return;
  writeFileSync(env.SETUP_VP_ENV_FILE, `export ${name}=${shellQuote(value)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export function run(command: string, args: string[], options: SpawnSyncOptions = {}): void {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function commandPath(command: string): string | undefined {
  const result = spawnSync("sh", ["-c", 'command -v "$1"', "sh", command], {
    encoding: "utf8",
  });
  if (result.status === 0) return result.stdout.trim();
  return undefined;
}
