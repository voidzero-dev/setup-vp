import { info } from "@actions/core";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { getWorkspaceDir, resolvePath } from "./utils.js";

const PACKAGE_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const WORKSPACE_FILES = ["pnpm-workspace.yaml", "pnpm-workspace.yml"] as const;

export function resolveVitePlusVersionFile(filePath: string, baseDir?: string): string {
  const fullPath = resolvePath(filePath, baseDir || getWorkspaceDir());
  const content = readVersionFile(fullPath);
  const filename = basename(fullPath);

  if (filename !== "package.json") {
    throw new Error(`Unsupported version-file: ${filePath}. Only package.json is supported.`);
  }

  const spec = readVitePlusPackageSpec(content);
  if (!spec) {
    throw new Error(`No vite-plus dependency found in ${filePath}`);
  }

  const version = spec.startsWith("catalog:")
    ? resolvePnpmCatalogVersion(spec, dirname(fullPath))
    : spec;

  info(`Resolved Vite+ version '${version}' from ${filePath}`);
  return version;
}

function readVersionFile(fullPath: string): string {
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    throw new Error(`version-file not found: ${fullPath}`);
  }
}

function readVitePlusPackageSpec(content: string): string | undefined {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("Failed to parse package.json: invalid JSON");
  }

  for (const sectionName of PACKAGE_SECTIONS) {
    const section = pkg[sectionName];
    if (!isRecord(section)) continue;

    const spec = section["vite-plus"];
    if (typeof spec === "string" && spec.trim()) {
      return spec.trim();
    }
  }

  return undefined;
}

function resolvePnpmCatalogVersion(spec: string, packageDir: string): string {
  const catalogName = spec.slice("catalog:".length) || "default";
  const workspaceFile = findPnpmWorkspaceFile(packageDir);
  if (!workspaceFile) {
    throw new Error(
      `Unable to resolve ${spec}: pnpm-workspace.yaml was not found from ${packageDir}`,
    );
  }

  const workspace = parsePnpmWorkspace(workspaceFile);
  const catalog = getCatalog(workspace, catalogName);
  const version = catalog?.["vite-plus"];
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(`Unable to resolve ${spec}: vite-plus was not found in ${workspaceFile}`);
  }

  return version.trim();
}

function findPnpmWorkspaceFile(startDir: string): string | undefined {
  const stopDir = getWorkspaceDir();
  let current = startDir;

  while (true) {
    for (const filename of WORKSPACE_FILES) {
      const candidate = join(current, filename);
      if (existsSync(candidate)) return candidate;
    }

    const parent = dirname(current);
    if (current === parent || current === stopDir) return undefined;
    current = parent;
  }
}

function parsePnpmWorkspace(filePath: string): Record<string, unknown> {
  const workspace = parseYaml(readFileSync(filePath, "utf-8"));
  if (!isRecord(workspace)) {
    throw new Error(`Failed to parse ${filePath}: expected a YAML object`);
  }
  return workspace;
}

function getCatalog(
  workspace: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined {
  if (name === "default") {
    const catalog = workspace.catalog;
    return isRecord(catalog) ? catalog : undefined;
  }

  const catalogs = workspace.catalogs;
  if (!isRecord(catalogs)) return undefined;

  const catalog = catalogs[name];
  return isRecord(catalog) ? catalog : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
