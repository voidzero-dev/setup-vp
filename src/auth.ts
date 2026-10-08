import { readFileSync, writeFileSync } from "node:fs";
import { EOL } from "node:os";
import { join, resolve } from "node:path";
import { debug, exportVariable, info } from "@actions/core";
import { analyzeProjectNpmrc } from "./ci/npmrc.js";

// Literal written into `.npmrc`; pnpm/npm expand it against the env at install time.
const NODE_AUTH_TOKEN_REF = "${NODE_AUTH_TOKEN}";

function getRunnerNpmrcPath(): string {
  return resolve(process.env.RUNNER_TEMP || process.cwd(), ".npmrc");
}

function stripProtocol(url: string): string {
  return url.replace(/^\w+:/, "");
}

function buildAuthLine(registryUrl: string): string {
  return `${stripProtocol(registryUrl)}:_authToken=${NODE_AUTH_TOKEN_REF}`;
}

function readNpmrc(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Configure npm registry authentication by writing a .npmrc file.
 * Ported from actions/setup-node's authutil.ts.
 */
export function configAuthentication(registryUrl: string, scope?: string): void {
  let url: URL;
  try {
    url = new URL(registryUrl);
  } catch {
    throw new Error(`Invalid registry-url: "${registryUrl}". Must be a valid URL.`);
  }

  const normalizedUrl = url.href.endsWith("/") ? url.href : url.href + "/";
  writeRegistryToFile(normalizedUrl, getRunnerNpmrcPath(), scope);
}

function writeRegistryToFile(registryUrl: string, fileLocation: string, scope?: string): void {
  // Auto-detect scope for GitHub Packages registry using exact host match
  if (!scope) {
    const url = new URL(registryUrl);
    if (url.hostname === "npm.pkg.github.com") {
      scope = process.env.GITHUB_REPOSITORY_OWNER;
    }
  }

  let scopePrefix = "";
  if (scope) {
    scopePrefix = (scope.startsWith("@") ? scope : "@" + scope).toLowerCase() + ":";
  }

  debug(`Setting auth in ${fileLocation}`);

  const authPrefix = stripProtocol(registryUrl).toLowerCase();

  const lines: string[] = [];
  const existing = readNpmrc(fileLocation);
  if (existing !== undefined) {
    for (const line of existing.split(/\r?\n/)) {
      const lower = line.toLowerCase();
      if (lower.startsWith(`${scopePrefix}registry`)) continue;
      if (lower.startsWith(authPrefix) && lower.includes("_authtoken")) continue;
      lines.push(line);
    }
  }

  lines.push(buildAuthLine(registryUrl), `${scopePrefix}registry=${registryUrl}`);

  writeFileSync(fileLocation, lines.join(EOL));

  exportVariable("NPM_CONFIG_USERCONFIG", fileLocation);
  exportVariable("PNPM_CONFIG_USERCONFIG", fileLocation); // For pnpm 11+

  // Export placeholder if NODE_AUTH_TOKEN is not set so npm doesn't error
  exportVariable("NODE_AUTH_TOKEN", process.env.NODE_AUTH_TOKEN || "XXXXX-XXXXX-XXXXX-XXXXX");
}

// GitHub-Actions-managed namespaces: re-exporting any of these via GITHUB_ENV
// could clobber runner-provided values for subsequent steps. Block the whole
// prefix by default; allow only vars that are legitimately passed as auth tokens.
const RUNTIME_ENV_ALLOWLIST = new Set(["GITHUB_TOKEN"]);
const ALWAYS_RESERVED = new Set(["PATH", "HOME", "USERPROFILE", "TMPDIR", "CI"]);

function isReservedEnvVar(name: string): boolean {
  if (ALWAYS_RESERVED.has(name)) return true;
  if (name.startsWith("RUNNER_")) return true;
  if (name.startsWith("GITHUB_")) return !RUNTIME_ENV_ALLOWLIST.has(name);
  return false;
}

/**
 * Re-export environment references already present in the project's `.npmrc`
 * so they remain visible to package-manager subprocesses and subsequent steps.
 *
 * Do not add auth for repository-controlled registry URLs. Generating token
 * entries requires an explicit `registry-url` input via configAuthentication.
 */
export function propagateProjectNpmrcAuth(projectDir: string): void {
  const npmrcPath = join(projectDir, ".npmrc");
  const content = readNpmrc(npmrcPath);
  if (content === undefined) return;

  const { envVarRefs } = analyzeProjectNpmrc(content);

  const propagatable = [...envVarRefs].filter(
    (name) => !isReservedEnvVar(name) && !!process.env[name],
  );

  if (propagatable.length === 0) {
    debug(`Project .npmrc at ${npmrcPath}: no auth env vars to propagate`);
    return;
  }

  info(
    `Detected project .npmrc at ${npmrcPath}. Propagating auth env vars: ${propagatable.join(", ")}`,
  );
  for (const name of propagatable) {
    exportVariable(name, process.env[name]!);
  }
}
