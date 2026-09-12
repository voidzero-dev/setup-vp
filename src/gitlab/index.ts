import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCommandOutput } from "../ci/process.js";
import { nodeManagerOffArgs, parseNodeManager } from "../ci/node-manager.js";
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

// Switch to the image's Node.js after installation, preserving package-manager management.
export function applyNodeManagerMode(env: RuntimeEnv = process.env, runFn: typeof run = run): void {
  if (parseNodeManager(env.SETUP_VP_NODE_MANAGER) === false) {
    runFn("vp", nodeManagerOffArgs(getCommandOutput("vp", ["--version"]) || ""));
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
