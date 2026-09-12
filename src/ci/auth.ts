import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProjectNpmrc } from "./npmrc.js";
import type { ExportVariable, RuntimeEnv } from "./types.js";

const NODE_AUTH_TOKEN_REF = "${NODE_AUTH_TOKEN}";

function readNpmrc(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export function isReservedAuthVariable(name: string): boolean {
  if (["GITHUB_TOKEN", "CI_JOB_TOKEN", "SYSTEM_ACCESSTOKEN"].includes(name)) return false;
  return (
    /^(?:PATH|HOME|USERPROFILE|TMPDIR|CI)$/i.test(name) ||
    /^(?:SETUP_VP_|RUNNER_|GITHUB_|CI_|SYSTEM_|AGENT_|BUILD_|RELEASE_)/i.test(name)
  );
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
  const existingConfig = () => {
    const homeDir = targetEnv.HOME || targetEnv.USERPROFILE;
    const file =
      targetEnv.NPM_CONFIG_USERCONFIG ||
      targetEnv.PNPM_CONFIG_USERCONFIG ||
      (homeDir && path.join(homeDir, ".npmrc"));
    return file ? readNpmrc(file) : "";
  };
  if (!registryUrlInput) {
    if (!projectDir) return;
    const { registriesNeedingAuth, envVarRefs } = analyzeProjectNpmrc(
      readNpmrc(path.join(projectDir, ".npmrc")),
    );
    let npmrc: string | undefined;
    if (targetEnv.NODE_AUTH_TOKEN && registriesNeedingAuth.length > 0) {
      const authKeys = new Set(
        registriesNeedingAuth.map((url) =>
          (url.replace(/^\w+:/, "") + ":_authtoken").toLowerCase(),
        ),
      );
      const lines = existingConfig()
        .split(/\r?\n/)
        .filter((line) => !authKeys.has(line.split("=")[0]!.trim().toLowerCase()));
      lines.push(
        ...registriesNeedingAuth.map(
          (url) => url.replace(/^\w+:/, "") + ":_authToken=" + NODE_AUTH_TOKEN_REF,
        ),
      );
      npmrc = writeUserConfig(lines.join("\n") + "\n", targetEnv, exportVariable);
      envVarRefs.add("NODE_AUTH_TOKEN");
    }
    for (const name of envVarRefs) {
      if (!isReservedAuthVariable(name) && targetEnv[name]) exportVariable?.(name, targetEnv[name]);
    }
    return npmrc;
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

  const authUrl = registryUrl.replace(/^\w+:/, "").toLowerCase();
  const replacedKeys = new Set([`${scopePrefix}registry`, `${authUrl}:_authtoken`]);
  const lines = existingConfig()
    .split(/\r?\n/)
    .filter((line) => !replacedKeys.has(line.split("=")[0]!.trim().toLowerCase()));
  lines.push(
    `${authUrl}:_authToken=${NODE_AUTH_TOKEN_REF}`,
    `${scopePrefix}registry=${registryUrl}`,
  );
  const npmrc = writeUserConfig(lines.filter(Boolean).join("\n") + "\n", targetEnv, exportVariable);
  targetEnv.NODE_AUTH_TOKEN = targetEnv.NODE_AUTH_TOKEN || "XXXXX-XXXXX-XXXXX-XXXXX";

  exportVariable?.("NODE_AUTH_TOKEN", targetEnv.NODE_AUTH_TOKEN);

  return npmrc;
}
