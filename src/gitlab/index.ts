import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseNodeManager } from "../ci/node-manager.js";
import type { RuntimeEnv } from "../ci/types.js";
import { configureAuth } from "./auth.js";
import { setupSfw } from "./install-sfw.js";
import { parseRunInstall, runInstall } from "./run-install.js";
import { run } from "./shell.js";
import { resolveProjectDir } from "./utils.js";

function fail(message: string): never {
  console.error(`setup-vp: ${message}`);
  process.exit(1);
}

// bootstrap.sh already exported VP_NODE_MANAGER=no for the install script,
// which only skips shim creation; vp commands would still resolve their
// internal JS runtime to managed Node, so also flip the config to
// system-first.
export function applyNodeManagerMode(env: RuntimeEnv = process.env, runFn: typeof run = run): void {
  if (parseNodeManager(env.SETUP_VP_NODE_MANAGER) === false) {
    runFn("vp", ["env", "off"]);
  }
}

export async function main(): Promise<void> {
  const projectDir = resolveProjectDir(process.env);

  applyNodeManagerMode();

  configureAuth(process.env.SETUP_VP_REGISTRY_URL || "", process.env.SETUP_VP_SCOPE || "");

  const runInstallEntries = parseRunInstall(process.env.SETUP_VP_RUN_INSTALL || "true");

  const installCommand = await setupSfw(runInstallEntries);
  runInstall(runInstallEntries, projectDir, installCommand);

  run("vp", ["--version"]);
}

export function isEntrypoint(argvPath = process.argv[1], moduleUrl = import.meta.url): boolean {
  return Boolean(argvPath && moduleUrl === pathToFileURL(path.resolve(argvPath)).href);
}

if (isEntrypoint()) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
