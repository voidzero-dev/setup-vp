import { info, debug, warning } from "@actions/core";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { DISPLAY_NAME, PACKAGE_NAME } from "./types.js";
import type { Inputs } from "./types.js";
import { getWorkspaceDir, isWithin, resolvePath } from "./utils.js";
import { tryResolveVitePlusVersionFromLockfile } from "./lockfile-version.js";

const CATALOG_PREFIX = "catalog:";

// package.json fields checked for the vite-plus spec, in priority order.
// devDependencies is first: vite-plus is a dev toolchain, so that is its
// canonical home (it only differs from dependencies if a project lists it in
// both). Only fields that record the version a project installs are considered:
// peerDependencies is a compatibility range (not an installed version) and
// optionalDependencies is not where a build toolchain belongs.
const DEP_FIELDS = ["devDependencies", "dependencies"] as const;

// YAML files that can hold a `catalog:` protocol definition. pnpm reads only
// pnpm-workspace.yaml (there is no `.yml` variant); yarn (>= 4.10) uses
// .yarnrc.yml. Both share the same top-level `catalog:` / `catalogs:` shape. bun
// keeps catalogs in the root package.json instead (handled during the walk).
const YAML_CATALOG_SOURCES = ["pnpm-workspace.yaml", ".yarnrc.yml"];

interface CatalogContainer {
  catalog?: Record<string, unknown>;
  catalogs?: Record<string, Record<string, unknown> | undefined>;
}

/**
 * Resolve the Vite+ version to install, applying the full precedence:
 *   1. explicit `version`
 *   2. explicit `version-file` (warns and falls back to "latest" if
 *      unresolvable; does not continue to auto-detect / lockfile)
 *   3. auto-detect from the project's package.json (exact pin / catalog)
 *   4. auto-detect the exact version from the lockfile (resolves a package.json
 *      range like `^0.2.0` to what is actually locked)
 *   5. "latest"
 */
export function resolveVitePlusVersion(inputs: Inputs, projectDir: string): string {
  if (inputs.version) return inputs.version;

  if (inputs.versionFile) {
    return tryResolveVitePlusVersionFile(inputs.versionFile, projectDir) ?? "latest";
  }

  return (
    tryResolveVitePlusVersionFromProject(projectDir) ??
    // Consult the lockfile only when the project declares a direct vite-plus
    // dependency the lockfile can legitimately resolve to a published version,
    // so a transitive/other-workspace entry or a non-registry spec isn't
    // mistaken for this project's pin.
    (shouldConsultLockfile(projectDir)
      ? tryResolveVitePlusVersionFromLockfile(projectDir, inputs.cacheDependencyPath)
      : undefined) ??
    "latest"
  );
}

/**
 * Gate for the lockfile fallback: the project's package.json must declare a
 * direct vite-plus dependency whose spec the lockfile can resolve to a published
 * npm version — a semver range or a `catalog:` reference. Non-registry specs
 * (file:/git:/workspace:/link:/npm: aliases, owner/repo shorthands) would expose
 * a lockfile "version" that doesn't correspond to the npm package, so they are
 * excluded (the run falls back to "latest").
 */
function shouldConsultLockfile(projectDir: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    const spec = findDepSpec(pkg);
    return spec !== undefined && isLockfileResolvableSpec(spec);
  } catch {
    return false;
  }
}

function isLockfileResolvableSpec(spec: string): boolean {
  if (spec.startsWith(CATALOG_PREFIX)) return true;
  // Exclude non-registry protocols/aliases (contain ':' or '@') and repo/path
  // shorthands (the '/' and '\\' in the class are intentional); only plain
  // semver ranges qualify.
  return !/[:/@\\]/.test(spec);
}

/**
 * Resolve the Vite+ version to install from a checked-out project file, so CI
 * can keep a single source of truth for the version instead of duplicating it
 * in workflow YAML.
 *
 * Supports:
 *  - package.json: reads the `vite-plus` entry from dependencies /
 *    devDependencies. When the entry is `catalog:` / `catalog:<name>`, it is
 *    resolved through the nearest catalog source (searching upward from the
 *    manifest directory):
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

  // Trim first so a whitespace-only entry (e.g. a malformed catalog value) is
  // reported as "not found" rather than a confusing `Cannot use ""` later.
  version = version?.trim();
  if (!version) {
    throw new Error(`No ${PACKAGE_NAME} version found in ${filePath}`);
  }

  // Strip a leading lowercase 'v' prefix from a version (e.g. "v0.2.0" ->
  // "0.2.0"), but only before a digit so v-prefixed dist-tags like "vnext" (or a
  // capitalized "V2beta") are preserved.
  version = version.replace(/^v(?=\d)/, "");
  assertInstallableVersion(version, filePath);

  info(`Resolved ${DISPLAY_NAME} version '${version}' from ${filePath}`);
  return version;
}

/**
 * Resolve an explicit `version-file` without failing the run: any error (missing
 * file, no vite-plus entry, unresolvable spec, invalid JSON/YAML) is logged as a
 * warning and returns undefined so the caller can fall back to "latest".
 *
 * A warning (not debug) because the user explicitly configured version-file, so a
 * fallback to "latest" is worth surfacing.
 */
export function tryResolveVitePlusVersionFile(
  filePath: string,
  baseDir?: string,
): string | undefined {
  try {
    return resolveVitePlusVersionFile(filePath, baseDir);
  } catch (error) {
    warning(
      `Could not resolve the ${DISPLAY_NAME} version from version-file "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }. Falling back to "latest".`,
    );
    return undefined;
  }
}

/**
 * Best-effort auto-detection of the Vite+ version from the project's
 * package.json, used when neither `version` nor `version-file` is configured.
 *
 * Unlike an explicit `version-file`, this logs at debug (the common "no pin"
 * case shouldn't warn on every run): a missing manifest, no vite-plus entry, or
 * an entry that can't be resolved to an exact version (e.g. a semver range like
 * `^0.2.0`) simply returns undefined so the caller can fall back to "latest".
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
      const version = tryYamlCatalogVersion(join(dir, name), catalogName);
      if (version !== undefined) return version;
    }

    const version = tryPackageJsonCatalogVersion(join(dir, "package.json"), catalogName);
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
// climbing rather than aborting. The `where` detail on asVersion is dropped here
// because these callers swallow the error anyway.
function tryYamlCatalogVersion(path: string, catalogName: string): string | undefined {
  try {
    return asVersion(catalogEntryFromYaml(path, catalogName));
  } catch {
    return undefined;
  }
}

function tryPackageJsonCatalogVersion(path: string, catalogName: string): string | undefined {
  try {
    const pkg: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return asVersion(packageJsonCatalogEntry(pkg, catalogName));
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
function asVersion(entry: unknown, where?: string): string | undefined {
  if (entry == null) return undefined;
  if (typeof entry === "string") return entry;
  if (typeof entry === "number") return String(entry);
  throw new Error(`Invalid ${PACKAGE_NAME} entry${where ? ` ${where}` : ""}`);
}

// A resolved version must be installable straight off the npm registry: an exact
// version (`major.minor.patch`, optionally with `-prerelease` / `+build`) or a
// dist-tag (a name starting with a letter, e.g. "latest", "next", "vnext").
// Everything else can't be resolved by the install script and must be rejected
// with an actionable error rather than forwarded to a 404: operator ranges
// (`^0.2.0`, `>=0.2.0`, `*`, `||`), marker-less ranges npm still treats as
// ranges (partial `0.2` / `1`, x-ranges `0.2.x`), and non-registry aliases
// (`npm:`, `git:`, `file:`, which fail the letter-led tag shape on `:` / `@`).
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;
const DIST_TAG_RE = /^[A-Za-z][0-9A-Za-z._-]*$/;

function assertInstallableVersion(version: string, filePath: string): void {
  if (EXACT_VERSION_RE.test(version) || DIST_TAG_RE.test(version)) return;
  throw new Error(
    `Cannot use "${version}" resolved from ${filePath}: version-file requires an exact version or ` +
      `dist-tag (semver ranges like "^0.2.0" or "0.2" and aliases like "npm:"/"git:" are not supported). ` +
      `Pin an exact version, use a catalog, or set the action's \`version\` input.`,
  );
}
