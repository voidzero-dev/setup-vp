import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportShellEnv } from "./shell.js";
import type { RuntimeEnv } from "./types.js";

const NODE_AUTH_TOKEN_REF = "${NODE_AUTH_TOKEN}";

export function configureAuth(
  registryUrlInput: string,
  scopeInput: string,
  targetEnv: RuntimeEnv = process.env,
): string | undefined {
  if (!registryUrlInput) return;

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
  const npmrcDir = mkdtempSync(path.join(tmpdir(), "setup-vp-npmrc-"));
  const npmrc = path.join(npmrcDir, ".npmrc");
  const contents = `${authUrl}:_authToken=${NODE_AUTH_TOKEN_REF}\n${scopePrefix}registry=${registryUrl}\n`;
  writeFileSync(npmrc, contents, { encoding: "utf8", mode: 0o600 });

  targetEnv.NPM_CONFIG_USERCONFIG = npmrc;
  targetEnv.PNPM_CONFIG_USERCONFIG = npmrc;
  targetEnv.NODE_AUTH_TOKEN = targetEnv.NODE_AUTH_TOKEN || "XXXXX-XXXXX-XXXXX-XXXXX";
  if (targetEnv === process.env) {
    exportShellEnv("NPM_CONFIG_USERCONFIG", targetEnv.NPM_CONFIG_USERCONFIG, targetEnv);
    exportShellEnv("PNPM_CONFIG_USERCONFIG", targetEnv.PNPM_CONFIG_USERCONFIG, targetEnv);
    exportShellEnv("NODE_AUTH_TOKEN", targetEnv.NODE_AUTH_TOKEN, targetEnv);
  }
  return npmrc;
}
