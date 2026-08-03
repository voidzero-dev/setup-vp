import path from "node:path";
import { basename, isAbsolute, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { getCommandOutput } from "./process.js";
import type { LockFileInfo, LockFileType, LogFn } from "./types.js";
import { LockFileType as LockType } from "./types.js";

const LOCK_FILES: Array<{ filename: string; type: LockFileType }> = [
  { filename: "pnpm-lock.yaml", type: LockType.Pnpm },
  { filename: "bun.lockb", type: LockType.Bun },
  { filename: "bun.lock", type: LockType.Bun },
  { filename: "package-lock.json", type: LockType.Npm },
  { filename: "npm-shrinkwrap.json", type: LockType.Npm },
  { filename: "yarn.lock", type: LockType.Yarn },
];

function resolvePath(filePath: string, baseDir: string): string {
  return isAbsolute(filePath) ? filePath : join(baseDir, filePath);
}

function inferLockFileType(fullPath: string, filename: string): LockFileInfo {
  if (filename.includes("pnpm")) {
    return { type: LockType.Pnpm, path: fullPath, filename };
  }
  if (filename.includes("yarn")) {
    return { type: LockType.Yarn, path: fullPath, filename };
  }
  if (filename.startsWith("bun.")) {
    return { type: LockType.Bun, path: fullPath, filename };
  }
  return { type: LockType.Npm, path: fullPath, filename };
}

export function detectLockFile(
  explicitPath: string | undefined,
  workspace: string,
): LockFileInfo | undefined {
  if (explicitPath) {
    const fullPath = resolvePath(explicitPath, workspace);
    if (existsSync(fullPath)) {
      const filename = basename(fullPath);
      const lockInfo = LOCK_FILES.find((entry) => entry.filename === filename);
      if (lockInfo) {
        return {
          type: lockInfo.type,
          path: fullPath,
          filename,
        };
      }
      return inferLockFileType(fullPath, filename);
    }
    return undefined;
  }

  const workspaceContents = readdirSync(workspace);
  for (const lockInfo of LOCK_FILES) {
    if (workspaceContents.includes(lockInfo.filename)) {
      const fullPath = join(workspace, lockInfo.filename);
      return {
        type: lockInfo.type,
        path: fullPath,
        filename: lockInfo.filename,
      };
    }
  }

  return undefined;
}

export interface CacheMetadata {
  ready: boolean;
  cachePath?: string;
  lockFile?: string;
  lockType?: string;
}

export function prepareCacheMetadata(options: {
  projectDir: string;
  cacheDependencyPath?: string;
  logWarning?: LogFn;
}): CacheMetadata {
  const { projectDir, cacheDependencyPath, logWarning } = options;
  const lockFile = detectLockFile(cacheDependencyPath || undefined, projectDir);

  if (!lockFile) {
    logWarning?.(
      "setup-vp: cache is enabled but no supported lock file was found; skipping cache.",
    );
    return { ready: false };
  }

  const lockDir = path.dirname(lockFile.path);
  const cachePath = getCommandOutput("vp", ["pm", "cache", "dir"], { cwd: lockDir });
  if (!cachePath) {
    logWarning?.(
      `setup-vp: could not resolve package-manager cache directory for ${lockFile.filename}; skipping cache.`,
    );
    return { ready: false };
  }

  return {
    ready: true,
    cachePath,
    lockFile: lockFile.path,
    lockType: lockFile.type,
  };
}
