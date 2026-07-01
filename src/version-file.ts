import { info, debug } from "@actions/core";
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
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

  // Strip a leading lowercase 'v' prefix from a version (e.g. "v0.2.0" ->
  // "0.2.0"), but only before a digit so v-prefixed dist-tags like "vnext" (or a
  // capitalized "V2beta") are preserved.
  version = version.trim().replace(/^v(?=\d)/, "");
  assertInstallableVersion(version, filePath);

  info(`Resolved ${DISPLAY_NAME} version '${version}' from ${filePath}`);
  return version;
}

/**
 * Best-effort auto-detection of the Vite+ version from the project's
 * package.json, used when neither `version` nor `version-file` is configured.
 *
 * Unlike an explicit `version-file`, this never throws: a missing manifest, no
 * vite-plus entry, or an entry that can't be resolved to an exact version (e.g.
 * a semver range like `^0.2.0`) simply returns undefined so the caller can fall
 * back to "latest".
 */
export function tryResolveVitePlusVersionFromProject(projectDir: string): string | undefined {
  try {
    return resolveVitePlusVersionFile("package.json", projectDir);
  } catch (error) {
    debug(
      `Could not auto-detect ${DISPLAY_NAME} version from package.json in ${projectDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
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

  // Catalogs live at the workspace/repo root, so search from the manifest up to
  // (and including) the workspace root, but never step outside it: a catalog
  // outside the checked-out repo must not leak in (e.g. on self-hosted runners).
  // When the manifest itself is outside the workspace (an absolute
  // working-directory / version-file), only its own directory is searched, since
  // there is no in-repo root to anchor the walk.
  const boundary = getWorkspaceDir();

  let dir = startDir;
  for (;;) {
    for (const name of YAML_CATALOG_SOURCES) {
      const version = tryYamlCatalogVersion(join(dir, name), catalogName, `in ${name} at ${dir}`);
      if (version !== undefined) return version;
    }

    const version = tryPackageJsonCatalogVersion(
      join(dir, "package.json"),
      catalogName,
      `in package.json at ${dir}`,
    );
    if (version !== undefined) return version;

    const parent = dirname(dir);
    // Stop at the workspace root, at the filesystem root, or before ascending
    // out of the workspace (which also breaks immediately when startDir is
    // already outside it, leaving only the manifest's own dir searched).
    if (dir === boundary || parent === dir || !isWithin(parent, boundary)) break;
    dir = parent;
  }

  throw new Error(
    `Could not resolve "${spec}" for ${PACKAGE_NAME}: no matching catalog entry found in ` +
      `pnpm-workspace.yaml, .yarnrc.yml, or a package.json catalog (searched up from ${startDir})`,
  );
}

// Is `child` at or below `parent`? Used to keep the catalog walk from ascending
// out of the workspace root.
function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
    // Parse with the failsafe schema so every scalar stays a string: an unquoted
    // version like `1.10` must not be coerced to the number 1.1 (dropping the
    // trailing zero) before we read it.
    config = parseYaml(content, { schema: "failsafe" });
  } catch {
    throw new Error(`Failed to parse ${basename(path)}: invalid YAML`);
  }
  return catalogEntry(config, catalogName);
}

// Lenient catalog readers used during the upward walk: a missing, unparseable,
// or malformed ancestor source is skipped (returns undefined) so the walk keeps
// climbing rather than aborting.
function tryYamlCatalogVersion(
  path: string,
  catalogName: string,
  where: string,
): string | undefined {
  try {
    return asVersion(catalogEntryFromYaml(path, catalogName), where);
  } catch {
    return undefined;
  }
}

function tryPackageJsonCatalogVersion(
  path: string,
  catalogName: string,
  where: string,
): string | undefined {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return undefined;
  }
  try {
    return asVersion(packageJsonCatalogEntry(pkg, catalogName), where);
  } catch {
    return undefined;
  }
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

// A resolved version must be installable straight off the npm registry: an exact
// version (e.g. "0.2.0") or a dist-tag (e.g. "latest", "next"). Semver ranges
// (`^`, `~`, `>=`, `||`, `*`, spaces) and non-registry aliases (`npm:`, `git:`,
// `file:`, ...) can't be resolved by the install script, so reject them with an
// actionable error instead of forwarding a value that 404s at install time.
const NON_EXACT_VERSION_RE = /[\s^~<>=|*]/;

function assertInstallableVersion(version: string, filePath: string): void {
  if (NON_EXACT_VERSION_RE.test(version) || version.includes(":")) {
    throw new Error(
      `Cannot use "${version}" resolved from ${filePath}: version-file requires an exact version or ` +
        `dist-tag (semver ranges like "^0.2.0" and aliases like "npm:"/"git:" are not supported). ` +
        `Pin an exact version, use a catalog, or set the action's \`version\` input.`,
    );
  }
}
