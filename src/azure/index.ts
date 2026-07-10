import path from "node:path";
import { pathToFileURL } from "node:url";
import { configureAuth } from "../ci/auth.js";
import { prepareCacheMetadata } from "../ci/cache.js";
import { setupSfw } from "../ci/install-sfw.js";
import { getCommandOutput } from "../ci/process.js";
import { parseRunInstall, runInstall } from "../ci/run-install.js";
import { parseInstalledVpVersion } from "../ci/version.js";
import { logInfo, logWarning, prependPath, setVariable } from "./commands.js";
import { installVitePlus } from "./install-viteplus.js";
import { parseAzureInputs, resolveProjectDirFromInputs } from "./inputs.js";

export type AzurePhase = "prepare" | "finalize";

export interface AzurePorts {
  installVitePlus: typeof installVitePlus;
  prepareCacheMetadata: typeof prepareCacheMetadata;
  configureAuth: typeof configureAuth;
  setupSfw: typeof setupSfw;
  parseRunInstall: typeof parseRunInstall;
  runInstall: typeof runInstall;
  getCommandOutput: typeof getCommandOutput;
  parseInstalledVpVersion: typeof parseInstalledVpVersion;
  prependPath: typeof prependPath;
  setVariable: typeof setVariable;
  logWarning: typeof logWarning;
  logInfo: typeof logInfo;
}

const defaultPorts: AzurePorts = {
  installVitePlus,
  prepareCacheMetadata,
  configureAuth,
  setupSfw,
  parseRunInstall,
  runInstall,
  getCommandOutput,
  parseInstalledVpVersion,
  prependPath,
  setVariable,
  logWarning,
  logInfo,
};

function fail(message: string): never {
  console.error(`setup-vp: ${message}`);
  process.exit(1);
}

export async function runPrepare(
  env: NodeJS.ProcessEnv = process.env,
  ports: AzurePorts = defaultPorts,
): Promise<void> {
  const inputs = parseAzureInputs(env);
  const projectDir = resolveProjectDirFromInputs(inputs);

  ports.setVariable("SETUP_VP_CACHE_HIT", "false", { isOutput: true });
  ports.setVariable("SETUP_VP_CACHE_READY", "false", { isOutput: true });

  await ports.installVitePlus(inputs.version, {
    env,
    prependPath: (binDir) => ports.prependPath(binDir),
    logWarningFn: ports.logWarning,
  });

  const runtimePath = path.resolve(process.argv[1] || "");
  ports.setVariable("SETUP_VP_RUNTIME_PATH", runtimePath, { isOutput: true });

  if (!inputs.cache) return;

  const metadata = ports.prepareCacheMetadata({
    projectDir,
    cacheDependencyPath: inputs.cacheDependencyPath || undefined,
    logWarning: ports.logWarning,
  });

  if (!metadata.ready) {
    ports.setVariable("SETUP_VP_CACHE_READY", "false", { isOutput: true });
    return;
  }

  ports.setVariable("SETUP_VP_CACHE_READY", "true", { isOutput: true });
  if (metadata.cachePath) {
    ports.setVariable("SETUP_VP_CACHE_PATH", metadata.cachePath, { isOutput: true });
  }
  if (metadata.lockFile) {
    ports.setVariable("SETUP_VP_LOCK_FILE", metadata.lockFile, { isOutput: true });
  }
  if (metadata.lockType) {
    ports.setVariable("SETUP_VP_LOCK_TYPE", metadata.lockType, { isOutput: true });
  }
}

export async function runFinalize(
  env: NodeJS.ProcessEnv = process.env,
  ports: AzurePorts = defaultPorts,
): Promise<void> {
  const inputs = parseAzureInputs(env);
  const projectDir = resolveProjectDirFromInputs(inputs);

  ports.configureAuth(inputs.registryUrl, inputs.scope, env, (name, value) => {
    if (name === "NODE_AUTH_TOKEN") return;
    if (value !== undefined) ports.setVariable(name, value, { isOutput: true });
  });

  const runInstallEntries = ports.parseRunInstall(inputs.runInstall);
  const installCommand = await ports.setupSfw(runInstallEntries, {
    env,
    sfwEnabled: inputs.sfw,
    exportVariable: (name, value) => {
      if (value !== undefined) ports.setVariable(name, value, { isOutput: true });
    },
  });
  if (runInstallEntries.length > 0) {
    ports.runInstall(runInstallEntries, projectDir, installCommand, env);
  }

  const versionOutput = ports.getCommandOutput("vp", ["--version"]) || "";
  ports.logInfo(versionOutput);
  const installedVersion = ports.parseInstalledVpVersion(versionOutput);
  ports.setVariable("SETUP_VP_INSTALLED_VERSION", installedVersion, { isOutput: true });
}

export async function main(phase: AzurePhase): Promise<void> {
  if (phase === "prepare") {
    await runPrepare();
    return;
  }
  if (phase === "finalize") {
    await runFinalize();
    return;
  }
  fail(`invalid phase "${String(phase)}"; expected "prepare" or "finalize"`);
}

export function isEntrypoint(argvPath = process.argv[1], moduleUrl = import.meta.url): boolean {
  return Boolean(argvPath && moduleUrl === pathToFileURL(path.resolve(argvPath)).href);
}

if (isEntrypoint()) {
  const phase = process.argv[2];
  if (!phase) fail('missing phase argument; expected "prepare" or "finalize"');
  try {
    await main(phase as AzurePhase);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
