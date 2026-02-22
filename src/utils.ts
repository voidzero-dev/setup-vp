import { info, warning, debug } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, basename } from "node:path";
import { LockFileType } from "./types.js";
import type { LockFileInfo } from "./types.js";

// Lock file patterns in priority order
const LOCK_FILES: Array<{ filename: string; type: LockFileType }> = [
  { filename: "pnpm-lock.yaml", type: LockFileType.Pnpm },
  { filename: "package-lock.json", type: LockFileType.Npm },
  { filename: "npm-shrinkwrap.json", type: LockFileType.Npm },
  { filename: "yarn.lock", type: LockFileType.Yarn },
];

/**
 * Detect lock file in the workspace
 */
export function detectLockFile(explicitPath?: string): LockFileInfo | undefined {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

  // If explicit path provided, use it
  if (explicitPath) {
    const fullPath = isAbsolute(explicitPath) ? explicitPath : join(workspace, explicitPath);

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

  // Auto-detect: search for lock files in workspace root
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
  // Default to npm
  return { type: LockFileType.Npm, path: fullPath, filename };
}

/**
 * Get cache directories based on package manager type
 */
export async function getCacheDirectories(lockType: LockFileType): Promise<string[]> {
  switch (lockType) {
    case LockFileType.Npm:
    case LockFileType.Pnpm:
    case LockFileType.Yarn:
      return getViteCacheDir();
    default:
      return [];
  }
}

async function getCommandOutput(command: string, args: string[]): Promise<string | undefined> {
  const cmdStr = `${command} ${args.join(" ")}`;
  try {
    const result = await getExecOutput(command, args, {
      silent: true,
      ignoreReturnCode: true,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
    debug(`Command "${cmdStr}" exited with code ${result.exitCode}`);
    return undefined;
  } catch (error) {
    warning(`Failed to run "${cmdStr}": ${error}`);
    return undefined;
  }
}

async function getViteCacheDir(): Promise<string[]> {
  const cacheDir = await getCommandOutput("vp", ["pm", "cache", "dir"]);
  return cacheDir ? [cacheDir] : [];
}
