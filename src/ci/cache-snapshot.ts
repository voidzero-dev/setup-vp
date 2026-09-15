import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { CacheMetadata } from "./cache.js";
import { isWithin } from "./project.js";

function copyCacheDirectory(source: string, destination: string, overwrite: boolean): void {
  source = path.resolve(source);
  destination = path.resolve(destination);
  cpSync(source, destination, {
    recursive: true,
    force: overwrite,
    errorOnExist: false,
    filter: (src, dest) => {
      const destStat = lstatSync(dest, { throwIfNoEntry: false });
      const srcStat = lstatSync(src);
      if (destStat && !overwrite) {
        // cpSync's force:false does not skip existing symlinks. Only descend
        // into real directories; retain all other entries in the warm store.
        return srcStat.isDirectory() && destStat.isDirectory();
      }
      if (destStat && (destStat.isSymbolicLink() || srcStat.isSymbolicLink())) {
        // Replace the entry itself, without copying through an old link or
        // leaving a file/directory in the way of a new link.
        rmSync(dest, { recursive: true, force: true });
      }
      if (srcStat.isSymbolicLink()) {
        const target = path.resolve(path.dirname(src), readlinkSync(src));
        // Store-local links must remain valid after both the snapshot and the
        // store move to another runner. cpSync otherwise makes relative links
        // absolute, retaining the original runner's paths.
        let relocated = target;
        if (isWithin(target, source)) {
          const destinationTarget = path.join(destination, path.relative(source, target));
          relocated = path.relative(path.dirname(dest), destinationTarget) || ".";
        }
        mkdirSync(path.dirname(dest), { recursive: true });
        symlinkSync(
          relocated,
          dest,
          statSync(src, { throwIfNoEntry: false })?.isDirectory() ? "dir" : "file",
        );
        return false;
      }
      return true;
    },
  });
}

/**
 * GitLab restores native caches before setup can ask vp for the package-manager
 * store path. Bridge its project-relative cache to that store without caching
 * credentials or assuming a pnpm/npm/yarn/bun directory layout.
 */
export function restoreCacheSnapshot(
  metadata: CacheMetadata,
  cacheRoot: string,
  warn: (message: string) => void = console.warn,
  restore = true,
): { hit: boolean; save: () => void } {
  if (!metadata.ready || !metadata.cachePath || !metadata.lockFile || !metadata.lockType) {
    return { hit: false, save: () => {} };
  }
  const store = metadata.cachePath;
  if (
    isWithin(path.resolve(store), path.resolve(cacheRoot)) ||
    isWithin(path.resolve(cacheRoot), path.resolve(store))
  ) {
    warn("setup-vp: package-manager cache overlaps the snapshot directory; skipping cache.");
    return { hit: false, save: () => {} };
  }
  const directory = path.join(cacheRoot, process.platform, process.arch, metadata.lockType);
  const packages = path.join(directory, "packages");
  const manifest = path.join(directory, "lock-hash");
  const lockFile = metadata.lockFile;
  function hashLockFile(): string {
    return createHash("sha256").update(readFileSync(lockFile)).digest("hex");
  }
  let hash: string;
  try {
    hash = hashLockFile();
  } catch (error) {
    warn(`setup-vp: could not read cache lock file: ${String(error)}`);
    return { hit: false, save: () => {} };
  }
  let hit = false;
  try {
    if (restore && existsSync(packages)) {
      mkdirSync(store, { recursive: true });
      copyCacheDirectory(packages, store, false);
      hit = readFileSync(manifest, "utf8") === hash;
    }
  } catch (error) {
    warn(`setup-vp: could not restore package-manager cache: ${String(error)}`);
  }
  return {
    hit,
    save: () => {
      try {
        if (!existsSync(store)) return;
        const savedHash = hashLockFile();
        mkdirSync(directory, { recursive: true });
        copyCacheDirectory(store, packages, true);
        writeFileSync(manifest, savedHash, "utf8");
      } catch (error) {
        warn(`setup-vp: could not save package-manager cache: ${String(error)}`);
      }
    },
  };
}
