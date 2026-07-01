import { info } from "@actions/core";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { DISPLAY_NAME } from "./types.js";
import { getWorkspaceDir, resolvePath } from "./utils.js";

// The published package name for Vite+ on the npm registry.
const PACKAGE_NAME = "vite-plus";
const CATALOG_PREFIX = "catalog:";

// package.json fields checked for the vite-plus spec, in priority order.
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

// YAML files that can hold a `catalog:` protocol definition. pnpm uses
// pnpm-workspace.yaml; yarn (>= 4.10) uses .yarnrc.yml. Both share the same
// top-level `catalog:` / `catalogs:` shape. bun keeps catalogs in the root
// package.json instead (handled separately during the upward walk).
const YAML_CATALOG_SOURCES = ["pnpm-workspace.yaml", "pnpm-workspace.yml", ".yarnrc.yml"];

interface CatalogContainer {
  catalog?: Record<string, unknown>;
  catalogs?: Record<string, Record<string, unknown> | undefined>;
}

/**
 * Resolve the Vite+ version to install from a checked-out project file, so CI
 * can keep a single source of truth for the version instead of duplicating it
 * in workflow YAML.
 *
 * Supports:
 *  - package.json: reads the `vite-plus` entry from dependencies /
 *    devDependencies / optionalDependencies / peerDependencies. When the entry
 *    is `catalog:` / `catalog:<name>`, it is resolved through the nearest
 *    catalog source (searching upward from the manifest directory):
 *      - pnpm-workspace.yaml (pnpm)
 *      - .yarnrc.yml (yarn)
 *      - a root package.json `catalog`/`catalogs` (bun, top-level or under
 *        `workspaces`)
 *    A package.json that declares its own default catalog but does not list
 *    vite-plus as a dependency (e.g. a bun workspace root) resolves from that
 *    catalog directly.
 *  - pnpm-workspace.yaml / .yarnrc.yml: reads the `vite-plus` entry directly
 *    from the default catalog.
 *
 * The resolved value should be an exact version or dist-tag; the install script
 * fetches it straight from the npm registry, which does not resolve semver
 * ranges.
 */
export function resolveVitePlusVersionFile(filePath: string, baseDir?: string): string {
  const fullPath = resolvePath(filePath, baseDir || getWorkspaceDir());
  const filename = basename(fullPath);

  let version: string | undefined;
  if (YAML_CATALOG_SOURCES.includes(filename)) {
    version = asVersion(
      catalogEntryFromYaml(fullPath, "default"),
      `in default catalog of ${fullPath}`,
    );
    if (version === undefined) {
      throw new Error(`${PACKAGE_NAME} not found in default catalog of ${fullPath}`);
    }
  } else if (filename === "package.json") {
    version = resolveFromPackageJson(fullPath);
  } else {
    throw new Error(
      `Unsupported version-file: ${filePath} (expected package.json, ${YAML_CATALOG_SOURCES.join(", ")})`,
    );
  }

  if (!version) {
    throw new Error(`No ${PACKAGE_NAME} version found in ${filePath}`);
  }

  // Strip a leading 'v' prefix from a version (e.g. "v0.2.0" -> "0.2.0"), but
  // only before a digit so v-prefixed dist-tags like "vnext" are preserved.
  version = version.trim().replace(/^v(?=\d)/i, "");

  info(`Resolved ${DISPLAY_NAME} version '${version}' from ${filePath}`);
  return version;
}

function readFile(fullPath: string, label: string): string {
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    throw new Error(`${label} not found: ${fullPath}`);
  }
}

function resolveFromPackageJson(pkgPath: string): string | undefined {
  const content = readFile(pkgPath, "version-file");

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Failed to parse package.json: invalid JSON");
  }

  const spec = findDepSpec(pkg);
  if (!spec) {
    // A directly-targeted package.json may itself declare the default catalog
    // (e.g. a bun workspace root) without listing vite-plus as a dependency.
    return asVersion(packageJsonCatalogEntry(pkg, "default"), `in default catalog of ${pkgPath}`);
  }

  if (spec.startsWith(CATALOG_PREFIX)) {
    return resolveCatalogSpec(spec, dirname(pkgPath));
  }

  if (spec.startsWith("workspace:")) {
    throw new Error(
      `Cannot resolve "${spec}" for ${PACKAGE_NAME}: the workspace protocol has no published version`,
    );
  }

  return spec;
}

function findDepSpec(pkg: Record<string, unknown>): string | undefined {
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (deps && typeof deps === "object") {
      const spec = (deps as Record<string, unknown>)[PACKAGE_NAME];
      if (typeof spec === "string" && spec.trim()) {
        return spec.trim();
      }
    }
  }
  return undefined;
}

/**
 * Resolve a `catalog:` / `catalog:<name>` spec by walking up from the manifest
 * directory, checking each package manager's catalog source in turn (pnpm/yarn
 * YAML files, then a bun-style package.json catalog). Returns the first match.
 */
function resolveCatalogSpec(spec: string, startDir: string): string {
  const catalogName = spec.slice(CATALOG_PREFIX.length).trim() || "default";

  let dir = startDir;
  for (;;) {
    for (const name of YAML_CATALOG_SOURCES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        const version = asVersion(
          tryCatalogEntryFromYaml(candidate, catalogName),
          `in ${name} at ${dir}`,
        );
        if (version !== undefined) return version;
      }
    }

    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const version = asVersion(
        tryCatalogEntryFromPackageJson(pkgPath, catalogName),
        `in package.json at ${dir}`,
      );
      if (version !== undefined) return version;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Could not resolve "${spec}" for ${PACKAGE_NAME}: no matching catalog entry found in ` +
      `pnpm-workspace.yaml, .yarnrc.yml, or a package.json catalog (searched up from ${startDir})`,
  );
}

/**
 * Look up the vite-plus entry for a catalog within a parsed config object.
 * `catalog` is the default catalog; `catalogs` holds named catalogs (with
 * `default` as an alternate spelling of the default catalog).
 */
function catalogEntry(container: unknown, catalogName: string): unknown {
  if (!container || typeof container !== "object") return undefined;
  const c = container as CatalogContainer;
  if (catalogName === "default") {
    return c.catalog?.[PACKAGE_NAME] ?? c.catalogs?.default?.[PACKAGE_NAME];
  }
  return c.catalogs?.[catalogName]?.[PACKAGE_NAME];
}

function catalogEntryFromYaml(path: string, catalogName: string): unknown {
  const content = readFile(path, basename(path));
  let config: unknown;
  try {
    config = parseYaml(content);
  } catch {
    throw new Error(`Failed to parse ${basename(path)}: invalid YAML`);
  }
  return catalogEntry(config, catalogName);
}

// Lenient variants used during the upward walk: an unparseable or unrelated
// ancestor file should be skipped, not abort resolution.
function tryCatalogEntryFromYaml(path: string, catalogName: string): unknown {
  try {
    return catalogEntryFromYaml(path, catalogName);
  } catch {
    return undefined;
  }
}

function tryCatalogEntryFromPackageJson(path: string, catalogName: string): unknown {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
  return packageJsonCatalogEntry(pkg, catalogName);
}

// bun accepts catalogs at the top level of package.json or nested under
// `workspaces`; check both.
function packageJsonCatalogEntry(pkg: unknown, catalogName: string): unknown {
  return (
    catalogEntry(pkg, catalogName) ??
    catalogEntry((pkg as { workspaces?: unknown } | null)?.workspaces, catalogName)
  );
}

// Coerce a raw catalog entry to a version string, or undefined when absent.
// Entries are normally quoted version strings; YAML can also parse an unquoted
// numeric-looking version as a number. Anything else (e.g. a nested object) is
// malformed config and throws.
function asVersion(entry: unknown, where: string): string | undefined {
  if (entry == null) return undefined;
  if (typeof entry === "string") return entry;
  if (typeof entry === "number") return String(entry);
  throw new Error(`Invalid ${PACKAGE_NAME} entry ${where}`);
}
