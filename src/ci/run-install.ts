import path from "node:path";
import { parse as parseYaml } from "yaml";
import { runWithOutput } from "./process.js";
import type { InstallCommand, RunInstallEntry } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRunInstallEntry(value: unknown): RunInstallEntry {
  if (!isRecord(value)) {
    throw new Error("run-install entries must be objects");
  }

  for (const key of Object.keys(value)) {
    if (key !== "cwd" && key !== "args") {
      throw new Error(`unsupported run-install key: ${key}`);
    }
  }

  const entry: RunInstallEntry = {};
  if (value.cwd !== undefined) {
    if (typeof value.cwd !== "string") {
      throw new Error("run-install.cwd must be a string");
    }
    entry.cwd = value.cwd;
  }

  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== "string")) {
      throw new Error("run-install.args must be an array of strings");
    }
    entry.args = value.args;
  }

  return entry;
}

function validateRunInstallInput(value: unknown): import("./types.js").RunInstallInput {
  if (value === null || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(validateRunInstallEntry);
  return validateRunInstallEntry(value);
}

export function parseFlowArray(value: string): string[] {
  const parsed: unknown = parseYaml(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("args must be an array of strings");
  }
  return parsed;
}

export function parseRunInstall(value: string): RunInstallEntry[] {
  const parsed = validateRunInstallInput(parseYaml(value) ?? null);
  if (!parsed) return [];
  return parsed === true ? [{}] : Array.isArray(parsed) ? parsed : [parsed];
}

// Retain the adapter export for consumers of the previous subset parser.
export const parseYamlSubset = parseRunInstall;

export function isSfwVpNotFoundFlake(stdout: string, stderr: string): boolean {
  return /Command 'vp' not found in PATH/.test(stdout + "\n" + stderr);
}

export async function runInstall(
  entries: RunInstallEntry[],
  projectDir: string,
  installCommand: InstallCommand,
  env: NodeJS.ProcessEnv = process.env,
  options: { platform?: NodeJS.Platform; execute?: typeof runWithOutput } = {},
): Promise<void> {
  const installEnv = { ...env };
  delete installEnv.SETUP_VP_ENV_FILE;
  const execute = options.execute ?? runWithOutput;
  const failures: string[] = [];

  for (const entry of entries) {
    const cwd = entry.cwd ? path.resolve(projectDir, entry.cwd) : projectDir;
    const installArgs = ["install", ...(entry.args || [])];
    const args = installCommand === "sfw" ? ["vp", ...installArgs] : installArgs;
    const label = `${installCommand} ${args.join(" ")} (cwd: ${cwd})`;
    console.log(`setup-vp: running ${label}`);
    try {
      let result = await execute(installCommand, args, { cwd, env: installEnv });
      if (
        result.exitCode !== 0 &&
        installCommand === "sfw" &&
        isSfwVpNotFoundFlake(result.stdout, result.stderr)
      ) {
        console.warn(
          "setup-vp: sfw could not resolve vp; warming the PowerShell command cache and retrying once.",
        );
        if ((options.platform ?? process.platform) === "win32") {
          try {
            await execute("powershell.exe", ["-NoProfile", "-Command", "Get-Command vp"], {
              cwd,
              env: installEnv,
            });
          } catch {
            // A failed warm-up must not prevent the retry.
          }
        }
        result = await execute(installCommand, args, { cwd, env: installEnv });
      }
      if (result.exitCode !== 0) {
        failures.push(
          `${label} exited with code ${result.exitCode}\n${result.stderr.trim() || result.stdout.trim()}`,
        );
      }
    } catch (error) {
      failures.push(`${label}: ${String(error)}`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}
