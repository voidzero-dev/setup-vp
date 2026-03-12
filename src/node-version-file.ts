import { info } from "@actions/core";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { resolveWorkspacePath } from "./utils.js";

/**
 * Resolve a Node.js version from a version file.
 *
 * Supports: .nvmrc, .node-version, .tool-versions, package.json
 */
export function resolveNodeVersionFile(filePath: string): string {
  const fullPath = resolveWorkspacePath(filePath);

  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    throw new Error(`node-version-file not found: ${fullPath}`);
  }

  const filename = basename(fullPath);

  let version: string | undefined;

  if (filename === ".tool-versions") {
    version = parseToolVersions(content);
  } else if (filename === "package.json") {
    version = parsePackageJson(content);
  } else {
    // .nvmrc, .node-version, or any other plain text file
    version = parsePlainVersionFile(content);
  }

  if (!version) {
    throw new Error(`No Node.js version found in ${filePath}`);
  }

  // Strip leading 'v' prefix (e.g., "v20.11.0" -> "20.11.0")
  version = version.replace(/^v/i, "");

  info(`Resolved Node.js version '${version}' from ${filePath}`);
  return version;
}

/**
 * Parse a plain text version file (.nvmrc, .node-version, etc).
 * Returns the first non-empty, non-comment line, normalized for vp CLI.
 *
 * nvm aliases are translated: "node" / "stable" → "latest"
 * Inline comments (after #) are stripped.
 */
function parsePlainVersionFile(content: string): string | undefined {
  for (const line of content.split("\n")) {
    // Strip inline comments
    const stripped = line.includes("#") ? line.slice(0, line.indexOf("#")) : line;
    const trimmed = stripped.trim();
    if (!trimmed) continue;

    return normalizeNvmAlias(trimmed);
  }
  return undefined;
}

function normalizeNvmAlias(version: string): string {
  const lower = version.toLowerCase();
  if (lower === "node" || lower === "stable") return "latest";
  return version;
}

/**
 * Parse .tool-versions (asdf format).
 * Looks for 'nodejs' or 'node' entries.
 * Skips non-version specs (system, ref:*, path:*) and picks the first
 * installable version when multiple fallback versions are listed.
 */
function parseToolVersions(content: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [tool, ...versions] = trimmed.split(/\s+/);
    if (tool !== "nodejs" && tool !== "node") continue;

    // asdf allows multiple fallback versions; pick the first installable one
    for (const v of versions) {
      if (isAsdfInstallableVersion(v)) return v;
    }
  }
  return undefined;
}

function isAsdfInstallableVersion(version: string): boolean {
  return (
    !!version && version !== "system" && !version.startsWith("ref:") && !version.startsWith("path:")
  );
}

/**
 * Parse package.json for Node.js version.
 * Priority (matching actions/setup-node):
 *   1. devEngines.runtime (name: "node")
 *   2. engines.node
 */
function parsePackageJson(content: string): string | undefined {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Failed to parse package.json: invalid JSON");
  }

  // Check devEngines.runtime first
  const devEngines = pkg.devEngines as Record<string, unknown> | undefined;
  if (devEngines?.runtime) {
    const version = findNodeRuntime(devEngines.runtime);
    if (version) return version;
  }

  // Fall back to engines.node
  const engines = pkg.engines as Record<string, unknown> | undefined;
  if (engines?.node && typeof engines.node === "string") {
    return engines.node;
  }

  return undefined;
}

interface RuntimeEntry {
  name?: string;
  version?: string;
}

function findNodeRuntime(runtime: unknown): string | undefined {
  const entries = Array.isArray(runtime) ? runtime : [runtime];
  for (const entry of entries as RuntimeEntry[]) {
    if (entry?.name === "node" && typeof entry.version === "string") {
      return entry.version;
    }
  }
  return undefined;
}
