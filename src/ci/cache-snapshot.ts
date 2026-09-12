import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CacheMetadata } from "./cache.js";
import { isWithin } from "./project.js";

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
  let hash: string;
  try {
    hash = createHash("sha256").update(readFileSync(metadata.lockFile)).digest("hex");
  } catch (error) {
    warn(`setup-vp: could not read cache lock file: ${String(error)}`);
    return { hit: false, save: () => {} };
  }
  let hit = false;
  try {
    if (restore && existsSync(packages)) {
      mkdirSync(store, { recursive: true });
      cpSync(packages, store, { recursive: true, force: false, errorOnExist: false });
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
        mkdirSync(directory, { recursive: true });
        cpSync(store, packages, { recursive: true });
        writeFileSync(manifest, hash, "utf8");
      } catch (error) {
        warn(`setup-vp: could not save package-manager cache: ${String(error)}`);
      }
    },
  };
}
