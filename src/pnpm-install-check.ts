import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml, parseAllDocuments } from "yaml";

interface ModulesManifest {
  included?: Record<string, unknown>;
  skipped?: unknown;
  storeDir?: unknown;
  virtualStoreDir?: unknown;
}

interface Lockfile {
  importers?: unknown;
  packages?: Record<string, unknown> | null;
  snapshots?: Record<string, unknown> | null;
}

const INCLUDED_DEPENDENCY_TYPES = ["dependencies", "devDependencies", "optionalDependencies"];

// pnpm 11+ lockfiles can start with a document that locks pnpm itself, which also has
// importers. The project's lockfile is the last document.
function readProjectLockfile(path: string): Lockfile | undefined {
  let projectLockfile: Lockfile | undefined;
  for (const document of parseAllDocuments(readFileSync(path, "utf8"))) {
    if (!("toJS" in document)) continue;
    const lockfile = document.toJS() as Lockfile | null;
    if (lockfile?.importers) projectLockfile = lockfile;
  }
  return projectLockfile;
}

function lockedPackages(lockfile: Lockfile): string[] {
  return Object.keys(lockfile.snapshots ?? lockfile.packages ?? {});
}

/**
 * `pnpm store prune` keeps only the packages that installs on this runner reference.
 * Explain why pruning `storePath` could drop packages the lock file still needs, or
 * return undefined when node_modules holds a complete install of the lock file.
 */
export function findIncompletePnpmInstall(
  lockFilePath: string,
  storePath: string,
): string | undefined {
  const nodeModulesDir = join(dirname(lockFilePath), "node_modules");

  let manifest: ModulesManifest;
  try {
    manifest = parseYaml(readFileSync(join(nodeModulesDir, ".modules.yaml"), "utf8"));
  } catch {
    return "node_modules has no pnpm install";
  }

  if (typeof manifest?.storeDir !== "string" || resolve(manifest.storeDir) !== resolve(storePath)) {
    return "node_modules was installed from another store";
  }

  const excluded = INCLUDED_DEPENDENCY_TYPES.filter((type) => manifest.included?.[type] !== true);
  if (excluded.length) return `the install skipped ${excluded.join(", ")}`;

  let wanted: Lockfile | undefined;
  let current: Lockfile | undefined;
  try {
    wanted = readProjectLockfile(lockFilePath);
    const virtualStoreDir =
      typeof manifest.virtualStoreDir === "string" ? manifest.virtualStoreDir : ".pnpm";
    current = readProjectLockfile(resolve(nodeModulesDir, virtualStoreDir, "lock.yaml"));
  } catch {
    return "the lock file or the installed lock file could not be read";
  }
  if (!wanted || !current) return "the lock file or the installed lock file could not be read";

  // Optional packages for other platforms are skipped and never downloaded.
  const installed = new Set([
    ...lockedPackages(current),
    ...(Array.isArray(manifest.skipped) ? manifest.skipped : []),
  ]);
  const missing = lockedPackages(wanted).filter((key) => !installed.has(key));
  if (missing.length) {
    return `${missing.length} locked package(s) are not installed, such as ${missing[0]}`;
  }

  return undefined;
}
