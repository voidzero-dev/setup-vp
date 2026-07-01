import { info, debug, warning } from "@actions/core";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { DISPLAY_NAME } from "./types.js";
import type { LockFileInfo } from "./types.js";
import { detectLockFile } from "./utils.js";

const PACKAGE_NAME = "vite-plus";
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
  const lock = detectLockFile(cacheDependencyPath, projectDir);
  if (!lock) return undefined;

  if (lock.filename === "bun.lockb") {
    warning(
      `Cannot read ${lock.filename} (a binary lockfile) to resolve the ${DISPLAY_NAME} version; ` +
        `falling back to "latest". Use the text bun.lock, or set the \`version\` input.`,
    );
    return undefined;
  }

  const version = parseVitePlusVersionFromLockfile(lock);
  if (version) {
    info(`Resolved ${DISPLAY_NAME} version '${version}' from ${lock.filename}`);
    return version;
  }

  debug(`No ${DISPLAY_NAME} version found in ${lock.path}`);
  return undefined;
}

/**
 * Extract the resolved `vite-plus` version from a specific lockfile. Returns
 * undefined for an unreadable file, an unsupported/binary format, or a lockfile
 * that does not pin vite-plus.
 */
export function parseVitePlusVersionFromLockfile(lock: LockFileInfo): string | undefined {
  let content: string;
  try {
    content = readFileSync(lock.path, "utf-8");
  } catch {
    return undefined;
  }

  let version: string | undefined;
  switch (lock.filename) {
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      version = fromNpmLock(content);
      break;
    case "pnpm-lock.yaml":
      version = fromPnpmLock(content);
      break;
    case "yarn.lock":
      version = fromYarnLock(content);
      break;
    case "bun.lock":
      version = fromBunTextLock(content);
      break;
    default:
      // bun.lockb (binary) or any unknown filename.
      return undefined;
  }

  return version && VERSION_START_RE.test(version) ? version : undefined;
}

// npm / npm-shrinkwrap: lockfileVersion 2/3 store the top-level install under
// `packages["node_modules/vite-plus"]`; v1 uses `dependencies["vite-plus"]`.
function fromNpmLock(content: string): string | undefined {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const packages = json.packages as Record<string, { version?: unknown }> | undefined;
  const top = packages?.["node_modules/vite-plus"]?.version;
  if (typeof top === "string") return top;

  const deps = json.dependencies as Record<string, { version?: unknown }> | undefined;
  const v1 = deps?.[PACKAGE_NAME]?.version;
  return typeof v1 === "string" ? v1 : undefined;
}

// pnpm: prefer an importer's direct dependency (exact resolved version, possibly
// with a `(peer)` suffix); fall back to scanning the `packages` keys.
function fromPnpmLock(content: string): string | undefined {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return undefined;
  }
  if (!doc || typeof doc !== "object") return undefined;

  const root = doc as Record<string, unknown>;
  const importers = root.importers;
  const containers =
    importers && typeof importers === "object"
      ? Object.values(importers as Record<string, unknown>)
      : [root]; // old single-package lockfiles keep deps at the top level

  for (const container of containers) {
    const version = pnpmImporterVersion(container);
    if (version) return version;
  }

  const match = content.match(/(?:^|[\s/'"])vite-plus@(\d+\.\d+\.\d+[^\s():'"]*)/m);
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
// the resolved version is on an indented `version "x"` / `version: x` line.
function fromYarnLock(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s/.test(lines[i])) continue; // skip indented (in-block) lines
    if (!/(?:^|[",\s])vite-plus@/.test(lines[i])) continue; // not a vite-plus entry header
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
      const m = lines[j].match(/^\s+version:?\s+"?(\d+\.\d+\.\d+[^"\s]*)"?/);
      if (m) return m[1];
    }
  }
  return undefined;
}

// bun.lock (text/JSONC): the `packages` map stores the resolved id as
// `"vite-plus@0.2.1"`; the workspace specifier is `"vite-plus": "^0.2.0"` (no @).
function fromBunTextLock(content: string): string | undefined {
  const m = content.match(/"vite-plus@(\d+\.\d+\.\d+[^"]*)"/);
  return m?.[1];
}
