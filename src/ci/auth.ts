import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProjectNpmrc, readNpmrc } from "./npmrc.js";
import type { ExportVariable, RuntimeEnv } from "./types.js";

const NODE_AUTH_TOKEN_REF = "${NODE_AUTH_TOKEN}";

const LINE_BREAK_RE = /\r?\n/;
const RESERVED_ENV_NAME_RE = /^(?:PATH|HOME|USERPROFILE|TMPDIR|CI)$/i;
const RESERVED_ENV_PREFIX_RE = /^(?:SETUP_VP_|RUNNER_|GITHUB_|CI_|SYSTEM_|AGENT_|BUILD_|RELEASE_)/i;
const URL_PROTOCOL_RE = /^\w+:/;

function readUserConfigLines(env: RuntimeEnv, replacedKeys: Set<string>): string[] {
  const homeDir = env.HOME || env.USERPROFILE;
  const file =
    env.NPM_CONFIG_USERCONFIG ||
    env.PNPM_CONFIG_USERCONFIG ||
    (homeDir && path.join(homeDir, ".npmrc"));
  const contents = file ? readNpmrc(file) : "";
  return contents
    .split(LINE_BREAK_RE)
    .filter((line) => !replacedKeys.has(line.split("=")[0]!.trim().toLowerCase()));
}

export function isReservedAuthVariable(name: string): boolean {
  if (["GITHUB_TOKEN", "CI_JOB_TOKEN", "SYSTEM_ACCESSTOKEN"].includes(name)) return false;
  return RESERVED_ENV_NAME_RE.test(name) || RESERVED_ENV_PREFIX_RE.test(name);
}

function writeUserConfig(
  contents: string,
  env: RuntimeEnv,
  exportVariable?: ExportVariable,
): string {
  const npmrcDir = mkdtempSync(path.join(tmpdir(), "setup-vp-npmrc-"));
  const npmrc = path.join(npmrcDir, ".npmrc");
  writeFileSync(npmrc, contents, { encoding: "utf8", mode: 0o600 });
  for (const name of ["NPM_CONFIG_USERCONFIG", "PNPM_CONFIG_USERCONFIG"]) {
    env[name] = npmrc;
    exportVariable?.(name, npmrc);
  }
  return npmrc;
}

export function configureAuth(
  registryUrlInput: string,
  scopeInput: string,
  targetEnv: RuntimeEnv,
  exportVariable?: ExportVariable,
  projectDir?: string,
): string | undefined {
  if (!registryUrlInput) {
    if (!projectDir) return;
    // Repository-controlled registry URLs must not implicitly receive NODE_AUTH_TOKEN.
    // Only preserve environment references already present in the project config.
    const { envVarRefs } = analyzeProjectNpmrc(readNpmrc(path.join(projectDir, ".npmrc")));
    for (const name of envVarRefs) {
      if (!isReservedAuthVariable(name) && targetEnv[name]) exportVariable?.(name, targetEnv[name]);
    }
    return;
  }

  let url: URL;
  try {
    url = new URL(registryUrlInput);
  } catch {
    throw new Error(`Invalid registry-url: "${registryUrlInput}". Must be a valid URL.`);
  }

  const registryUrl = url.href.endsWith("/") ? url.href : `${url.href}/`;
  let scopePrefix = "";
  if (scopeInput) {
    const scope = scopeInput.startsWith("@") ? scopeInput : `@${scopeInput}`;
    scopePrefix = `${scope.toLowerCase()}:`;
  }

  const authUrl = registryUrl.replace(URL_PROTOCOL_RE, "").toLowerCase();
  const replacedKeys = new Set([`${scopePrefix}registry`, `${authUrl}:_authtoken`]);
  const lines = readUserConfigLines(targetEnv, replacedKeys);
  lines.push(
    `${authUrl}:_authToken=${NODE_AUTH_TOKEN_REF}`,
    `${scopePrefix}registry=${registryUrl}`,
  );
  const npmrc = writeUserConfig(lines.filter(Boolean).join("\n") + "\n", targetEnv, exportVariable);
  targetEnv.NODE_AUTH_TOKEN = targetEnv.NODE_AUTH_TOKEN || "XXXXX-XXXXX-XXXXX-XXXXX";

  exportVariable?.("NODE_AUTH_TOKEN", targetEnv.NODE_AUTH_TOKEN);

  return npmrc;
}
