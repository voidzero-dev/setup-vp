import { info, debug } from "@actions/core";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { DISPLAY_NAME, PACKAGE_NAME, LockFileType } from "./types.js";
import type { LockFileInfo } from "./types.js";
import { detectLockFile, getWorkspaceDir, isWithin } from "./utils.js";

// Lockfiles always record fully-resolved versions, so a valid result starts with
// major.minor.patch; use this to sanity-check extracted values.
const VERSION_START_RE = /^\d+\.\d+\.\d+/;

/**
 * Resolve the exact `vite-plus` version from the project's lockfile, as a
 * best-effort fallback for auto-detection when package.json only has a range
 * (e.g. `^0.2.0`) that can't be resolved to a single installable version.
 *
 * Never throws: an unreadable/unsupported lockfile (including the binary
 * bun.lockb) or a lockfile without a `vite-plus` entry returns undefined so the
 * caller can fall back to "latest".
 */
export function tryResolveVitePlusVersionFromLockfile(
  projectDir: string,
  cacheDependencyPath?: string,
): string | undefined {
  // Detect silently: on the cache path `restoreCache` logs the authoritative
  // "Auto-detected lock file" line, and a successful resolve reports its own
  // "Resolved ... from <lockfile>" below.
  const detected = detectLockfileForProject(projectDir, cacheDependencyPath);
  if (!detected) return undefined;

  // detectLockFile prioritizes the binary bun.lockb, but a readable text
  // bun.lock may sit beside it (transitional repos have both) — prefer that.
  const lock = detected.filename.endsWith(".lockb") ? textBunLockBeside(detected) : detected;
  if (!lock) {
    // Only the binary bun.lockb is present; it can't be read. This is a
    // best-effort auto-detect (the user opted into nothing), so stay at debug
    // like the package.json auto-detect sibling rather than warning every run.
    debug(
      `Cannot read ${detected.filename} (binary) to resolve the ${DISPLAY_NAME} version; using "latest". ` +
        `Use the text bun.lock, or set the \`version\` input.`,
    );
    return undefined;
  }

  // Path from the lockfile's directory to the project, so npm/pnpm can pick the
  // selected workspace package's entry rather than the first one seen.
  const subPath = workspaceSubPath(dirname(lock.path), projectDir);
  const version = parseVitePlusVersionFromLockfile(lock, subPath);
  if (version) {
    info(`Resolved ${DISPLAY_NAME} version '${version}' from ${lock.filename}`);
    return version;
  }

  debug(`No ${DISPLAY_NAME} version found in ${lock.path}`);
  return undefined;
}

// Locate the project's lockfile. An explicit cache-dependency-path is used
// as-is; otherwise auto-detect from the project directory upward to the
// workspace root, since in a monorepo the lockfile usually lives at the repo
// root rather than inside a working-directory subpackage.
function detectLockfileForProject(
  projectDir: string,
  cacheDependencyPath?: string,
): LockFileInfo | undefined {
  if (cacheDependencyPath) {
    return detectLockFile(cacheDependencyPath, projectDir, true);
  }
  const boundary = getWorkspaceDir();
  let dir = projectDir;
  for (;;) {
    const lock = detectLockFile(undefined, dir, true);
    if (lock) return lock;
    const parent = dirname(dir);
    if (dir === boundary || parent === dir || !isWithin(parent, boundary)) break;
    dir = parent;
  }
  return undefined;
}

// A readable text bun.lock in the same directory as a bun.lockb, or undefined.
function textBunLockBeside(lock: LockFileInfo): LockFileInfo | undefined {
  const textPath = join(dirname(lock.path), "bun.lock");
  return existsSync(textPath)
    ? { type: LockFileType.Bun, path: textPath, filename: "bun.lock" }
    : undefined;
}

// POSIX-style path from the lockfile's directory to the project ("" at the
// root, or when the project is outside the lockfile's tree). pnpm importer keys
// and npm workspace lock paths are relative to the lockfile and slash-separated.
function workspaceSubPath(lockDir: string, projectDir: string): string {
  if (!isWithin(projectDir, lockDir)) return ""; // project outside the lockfile's tree
  const rel = relative(lockDir, projectDir);
  return rel ? rel.split(sep).join("/") : "";
}

/**
 * Extract the resolved `vite-plus` version from a specific lockfile. Returns
 * undefined for an unreadable file, an unsupported/binary format, or a lockfile
 * that does not pin vite-plus.
 */
export function parseVitePlusVersionFromLockfile(
  lock: LockFileInfo,
  subPath = "",
): string | undefined {
  // bun ships two lockfiles under the same LockFileType; only the text one is
  // readable, so screen out the binary variant before dispatching on type.
  if (lock.filename.endsWith(".lockb")) return undefined;

  let content: string;
  try {
    content = readFileSync(lock.path, "utf-8");
  } catch {
    return undefined;
  }

  // Dispatch on the package-manager type (honoring detectLockFile's inference for
  // non-standard filenames) rather than re-enumerating filenames.
  let version: string | undefined;
  switch (lock.type) {
    case LockFileType.Npm:
      version = fromNpmLock(content, subPath);
      break;
    case LockFileType.Pnpm:
      version = fromPnpmLock(content, subPath);
      break;
    case LockFileType.Yarn:
      version = fromYarnLock(content);
      break;
    case LockFileType.Bun:
      version = fromBunTextLock(content);
      break;
    default:
      return undefined;
  }

  return version && VERSION_START_RE.test(version) ? version : undefined;
}

// npm / npm-shrinkwrap: lockfileVersion 2/3 store installs under `packages`,
// keyed by node_modules path. Prefer the selected workspace package's own
// (non-hoisted) entry, then the hoisted top-level one; v1 uses `dependencies`.
function fromNpmLock(content: string, subPath: string): string | undefined {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const packages = json.packages as Record<string, Record<string, unknown>> | undefined;
  if (subPath) {
    const scoped = packages?.[`${subPath}/node_modules/${PACKAGE_NAME}`]?.version;
    if (typeof scoped === "string") return scoped;
    // Not installed under the package itself: the hoisted root entry only
    // belongs to this package if it is a lockfile member that declares
    // vite-plus. Otherwise (a nested project absent from this lockfile) the root
    // version is unrelated, so fall back rather than install it.
    if (!npmPackageDeclaresVitePlus(packages?.[subPath])) return undefined;
  }
  const top = packages?.[`node_modules/${PACKAGE_NAME}`]?.version;
  if (typeof top === "string") return top;

  const deps = json.dependencies as Record<string, { version?: unknown }> | undefined;
  const v1 = deps?.[PACKAGE_NAME]?.version;
  return typeof v1 === "string" ? v1 : undefined;
}

// Does an npm lockfile package node (packages["<subPath>"]) declare vite-plus in
// its dependencies / devDependencies? Confirms the hoisted root install belongs
// to this package.
function npmPackageDeclaresVitePlus(node: Record<string, unknown> | undefined): boolean {
  if (!node) return false;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = node[field];
    if (deps && typeof deps === "object" && PACKAGE_NAME in (deps as Record<string, unknown>)) {
      return true;
    }
  }
  return false;
}

// pnpm: prefer the importer for the selected project (its exact resolved
// version, possibly with a `(peer)` suffix); fall back to scanning the
// `packages` keys for lockfiles without a matching importer.
function fromPnpmLock(content: string, subPath: string): string | undefined {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return undefined;
  }
  if (!doc || typeof doc !== "object") return undefined;

  const root = doc as Record<string, unknown>;
  const importers = root.importers as Record<string, unknown> | undefined;
  if (importers && typeof importers === "object") {
    // Trust only the importer for the selected project (pnpm uses "." for the
    // workspace root). If it is absent or does not list vite-plus, fall back
    // (undefined) rather than leaking another importer's or package's version.
    const key = subPath || ".";
    return key in importers ? pnpmImporterVersion(importers[key]) : undefined;
  }

  // No importer data (old single-package lockfile): read top-level deps, then a
  // last-resort scan of the packages section. Anchor to the start of a package
  // key (indent, optional leading `/` for v6) so a scoped look-alike such as
  // `@acme/vite-plus@9.9.9` — where `/vite-plus@` appears mid-key — is not
  // matched.
  const rootVersion = pnpmImporterVersion(root);
  if (rootVersion) return rootVersion;
  const match = content.match(/^\s*\/?vite-plus@(\d+\.\d+\.\d+[^\s():'"]*)/m);
  return match?.[1];
}

function pnpmImporterVersion(importer: unknown): string | undefined {
  if (!importer || typeof importer !== "object") return undefined;
  const imp = importer as Record<string, unknown>;
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const deps = imp[field];
    if (deps && typeof deps === "object") {
      const dep = (deps as Record<string, unknown>)[PACKAGE_NAME];
      const raw =
        typeof dep === "string" ? dep : (dep as { version?: unknown } | undefined)?.version;
      if (typeof raw === "string") {
        const clean = raw.replace(/\(.*$/, "").trim(); // strip pnpm peer suffix
        if (VERSION_START_RE.test(clean)) return clean;
      }
    }
  }
  return undefined;
}

// yarn (classic + berry): entry headers are unindented and contain `vite-plus@`;
// the resolved version is on an indented `version "x"` / `version: x` line. yarn
// lockfiles don't map workspaces to resolutions, so if more than one distinct
// vite-plus version is present the selection is ambiguous — return undefined and
// let the caller fall back rather than guess another workspace's version.
function fromYarnLock(content: string): string | undefined {
  const versions = new Set<string>();
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s/.test(lines[i])) continue; // skip indented (in-block) lines
    if (!/(?:^|[",\s])vite-plus@/.test(lines[i])) continue; // not a vite-plus entry header
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
      const m = lines[j].match(/^\s+version:?\s+"?(\d+\.\d+\.\d+[^"\s]*)"?/);
      if (m) {
        versions.add(m[1]);
        break;
      }
    }
  }
  return singleVersion(versions);
}

// bun.lock (text/JSONC): the `packages` map stores the resolved id as
// `"vite-plus@0.2.1"`; the workspace specifier is `"vite-plus": "^0.2.0"` (no @).
// Like yarn, a shared lockfile with more than one distinct version is ambiguous.
function fromBunTextLock(content: string): string | undefined {
  const versions = new Set<string>();
  const re = /"vite-plus@(\d+\.\d+\.\d+[^"]*)"/g;
  for (let m = re.exec(content); m !== null; m = re.exec(content)) {
    versions.add(m[1]);
  }
  return singleVersion(versions);
}

// The sole version in the set, or undefined when empty or ambiguous (>1).
function singleVersion(versions: Set<string>): string | undefined {
  return versions.size === 1 ? [...versions][0] : undefined;
}
