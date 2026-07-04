import { info, warning, debug } from "@actions/core";
import { getExecOutput } from "@actions/exec";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, basename, relative, sep } from "node:path";
import type { Inputs } from "./types.js";
import { LockFileType } from "./types.js";
import type { LockFileInfo } from "./types.js";

export function getVitePlusHome(): string {
  const home = process.platform === "win32" ? process.env.USERPROFILE : process.env.HOME;
  return join(home || homedir(), ".vite-plus");
}

// Is `child` at or below `parent`? Used to bound upward directory walks (catalog
// sources, lockfiles) to the workspace root. A leading ".." *segment* means the
// path escaped `parent`; guard the segment boundary so a child directory merely
// named "..foo" is not misclassified as outside.
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  if (isAbsolute(rel)) return false; // different root/drive
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * Extract the installed global Vite+ version from `vp --version` output.
 *
 * vp >= 0.2 prints the global version as `vp v0.2.0` on the first line; older
 * builds printed `- Global: v0.2.0`. Support both so the reported `version`
 * output stays correct across vp releases (a lone anchored regex silently broke
 * when the format changed). Returns "unknown" when neither shape matches.
 */
export function parseInstalledVpVersion(versionOutput: string): string {
  const match =
    versionOutput.match(/^\s*vp\s+v?(\d[^\s]*)/im) ??
    versionOutput.match(/Global:\s*v?(\d[^\s]*)/i);
  return match?.[1] ?? "unknown";
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
  silent = false,
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
      if (!silent) info(`Auto-detected lock file: ${lockInfo.filename}`);
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
