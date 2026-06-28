import { info, warning, debug } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, basename } from "node:path";
import type { Inputs } from "./types.js";
import { LockFileType } from "./types.js";
import type { LockFileInfo } from "./types.js";

/**
 * Empty stdin payload (EOF) for child processes we spawn.
 *
 * On Windows runners stdin is not a TTY. Vite+ routes the package-manager
 * `.cmd` shims (pnpm/npm/yarn) through PowerShell, whose `.ps1` wrappers
 * introspect stdin (`$MyInvocation.ExpectingInput`) and block forever when the
 * child's stdin pipe is left open and empty, hanging the job for hours until
 * GitHub cancels it. `@actions/exec` leaves the child's stdin open unless
 * `input` is set, so we pass an empty buffer to send EOF immediately.
 *
 * A `Buffer` (not `""`, which is falsy) is required: `@actions/exec` only calls
 * `cp.stdin.end(input)` when `input` is truthy.
 *
 * See https://github.com/voidzero-dev/setup-vp/issues/90
 */
export const EMPTY_STDIN = Buffer.alloc(0);

export function getVitePlusHome(): string {
  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  return join(home || homedir(), ".vite-plus");
}

export function getWorkspaceDir(): string {
  return process.env.GITHUB_WORKSPACE || process.cwd();
}

export function resolvePath(filePath: string, baseDir: string): string {
  return isAbsolute(filePath) ? filePath : join(baseDir, filePath);
}

export function getConfiguredProjectDir(inputs: Inputs): string {
  if (!inputs.workingDirectory) {
    return getWorkspaceDir();
  }

  const projectDir = resolvePath(inputs.workingDirectory, getWorkspaceDir());

  if (!existsSync(projectDir)) {
    throw new Error(
      `working-directory not found: ${inputs.workingDirectory} (resolved to ${projectDir})`,
    );
  }

  if (!statSync(projectDir).isDirectory()) {
    throw new Error(
      `working-directory is not a directory: ${inputs.workingDirectory} (resolved to ${projectDir})`,
    );
  }

  return projectDir;
}

export function getInstallCwd(projectDir: string, cwd?: string): string {
  return cwd ? resolvePath(cwd, projectDir) : projectDir;
}

// Lock file patterns in priority order
const LOCK_FILES: Array<{ filename: string; type: LockFileType }> = [
  { filename: "pnpm-lock.yaml", type: LockFileType.Pnpm },
  { filename: "bun.lockb", type: LockFileType.Bun },
  { filename: "bun.lock", type: LockFileType.Bun },
  { filename: "package-lock.json", type: LockFileType.Npm },
  { filename: "npm-shrinkwrap.json", type: LockFileType.Npm },
  { filename: "yarn.lock", type: LockFileType.Yarn },
];

/**
 * Detect a lock file in the provided workspace directory.
 * Defaults to the GitHub workspace root.
 */
export function detectLockFile(
  explicitPath?: string,
  workspace = getWorkspaceDir(),
): LockFileInfo | undefined {
  // If explicit path provided, use it
  if (explicitPath) {
    const fullPath = resolvePath(explicitPath, workspace);

    if (existsSync(fullPath)) {
      const filename = basename(fullPath);
      const lockInfo = LOCK_FILES.find((l) => l.filename === filename);
      if (lockInfo) {
        return {
          type: lockInfo.type,
          path: fullPath,
          filename,
        };
      }
      // Unknown lock file type - try to infer from name
      return inferLockFileType(fullPath, filename);
    }
    return undefined;
  }

  // Auto-detect: search for lock files in the provided workspace directory
  const workspaceContents = readdirSync(workspace);

  for (const lockInfo of LOCK_FILES) {
    if (workspaceContents.includes(lockInfo.filename)) {
      const fullPath = join(workspace, lockInfo.filename);
      info(`Auto-detected lock file: ${lockInfo.filename}`);
      return {
        type: lockInfo.type,
        path: fullPath,
        filename: lockInfo.filename,
      };
    }
  }

  return undefined;
}

function inferLockFileType(fullPath: string, filename: string): LockFileInfo {
  // Infer type from filename patterns
  if (filename.includes("pnpm")) {
    return { type: LockFileType.Pnpm, path: fullPath, filename };
  }
  if (filename.includes("yarn")) {
    return { type: LockFileType.Yarn, path: fullPath, filename };
  }
  if (filename.startsWith("bun.")) {
    return { type: LockFileType.Bun, path: fullPath, filename };
  }
  // Default to npm
  return { type: LockFileType.Npm, path: fullPath, filename };
}

/**
 * Get cache directories based on package manager type
 */
export async function getCacheDirectories(lockType: LockFileType, cwd: string): Promise<string[]> {
  switch (lockType) {
    case LockFileType.Npm:
    case LockFileType.Pnpm:
    case LockFileType.Yarn:
    case LockFileType.Bun:
      return getViteCacheDir(cwd);
    default:
      return [];
  }
}

async function getCommandOutput(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<string | undefined> {
  const cmdStr = `${command} ${args.join(" ")}`;
  try {
    const result = await getExecOutput(command, args, {
      cwd: options?.cwd,
      silent: true,
      ignoreReturnCode: true,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    debug(`Command "${cmdStr}" exited with code ${result.exitCode}`);
    return undefined;
  } catch (error) {
    warning(`Failed to run "${cmdStr}": ${String(error)}`);
    return undefined;
  }
}

async function getViteCacheDir(cwd: string): Promise<string[]> {
  const cacheDir = await getCommandOutput("vp", ["pm", "cache", "dir"], { cwd });
  return cacheDir ? [cacheDir] : [];
}
