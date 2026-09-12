import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { packageManagerArgs } from "../ci/package-manager.js";
import { createVersionResolver } from "../ci/version-file.js";
import { createNodeVersionResolver } from "../ci/node-version-file.js";
import { resolutionContext } from "../ci/resolution.js";
import { nodeManagerOffArgs } from "../ci/node-manager.js";
import { configureAuth } from "../ci/auth.js";
import { prepareCacheMetadata } from "../ci/cache.js";
import { getSfwAssetName, isMuslLinux, setupSfw, SFW_VERSION } from "../ci/install-sfw.js";
import { getCommandOutput, run } from "../ci/process.js";
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
  runInstall: (...args: Parameters<typeof runInstall>) => void | Promise<void>;
  getCommandOutput: typeof getCommandOutput;
  run: typeof run;
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
  run,
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

  if (inputs.nodeManager === false && (inputs.nodeVersion || inputs.nodeVersionFile)) {
    throw new Error("node-version and node-version-file cannot be used with node-manager: false");
  }
  const context = {
    ...resolutionContext(inputs.workspaceRoot),
    info: ports.logInfo,
    warning: ports.logWarning,
  };
  const version = createVersionResolver(context).resolveVitePlusVersion(inputs, projectDir);
  const nodeVersion =
    inputs.nodeVersion ||
    (inputs.nodeVersionFile
      ? createNodeVersionResolver(context).resolveNodeVersionFile(
          inputs.nodeVersionFile,
          projectDir,
        )
      : undefined);

  ports.setVariable("SETUP_VP_CACHE_HIT", "false");
  ports.setVariable("SETUP_VP_CACHE_READY", "false");
  ports.setVariable("SETUP_VP_SFW_READY", "false");
  // Keep the setup runtime independent of the project's selected Node version.
  ports.setVariable("SETUP_VP_BOOTSTRAP_NODE", process.execPath);

  await ports.installVitePlus(version, {
    env,
    prependPath: (binDir) => ports.prependPath(binDir),
    logWarningFn: ports.logWarning,
  });

  const versionOutput =
    inputs.nodeManager === false || inputs.packageManager !== undefined
      ? ports.getCommandOutput("vp", ["--version"]) || ""
      : "";
  const packageManagerCommands = packageManagerArgs(inputs.packageManager, versionOutput);

  // Switch to the agent's Node.js after installation, preserving package-manager management.
  if (inputs.nodeManager === false) {
    ports.run("vp", nodeManagerOffArgs(versionOutput));
  } else if (nodeVersion) {
    ports.run("vp", ["env", "use", nodeVersion], { cwd: projectDir });
  }

  for (const args of packageManagerCommands) {
    ports.run("vp", args);
  }

  const runtimePath = path.resolve(process.argv[1] || "");
  ports.setVariable("SETUP_VP_RUNTIME_PATH", runtimePath);

  if (inputs.sfw && ports.parseRunInstall(inputs.runInstall).length > 0) {
    try {
      const asset = getSfwAssetName(process.platform, process.arch, isMuslLinux());
      const sfwCache = path.join(env.PIPELINE_WORKSPACE || inputs.workspaceRoot, ".setup-vp-sfw");
      mkdirSync(sfwCache, { recursive: true });
      ports.setVariable("SETUP_VP_SFW_CACHE_DIR", sfwCache);
      ports.setVariable("SETUP_VP_SFW_CACHE_KEY", `${SFW_VERSION}-${asset}`);
      ports.setVariable("SETUP_VP_SFW_READY", "true");
    } catch (error) {
      ports.logWarning(String(error));
    }
  }

  if (!inputs.cache) return;

  const metadata = ports.prepareCacheMetadata({
    projectDir,
    cacheDependencyPath: inputs.cacheDependencyPath || undefined,
    logWarning: ports.logWarning,
  });

  if (!metadata.ready) {
    ports.setVariable("SETUP_VP_CACHE_READY", "false");
    return;
  }

  ports.setVariable("SETUP_VP_CACHE_READY", "true");
  if (metadata.cachePath) {
    ports.setVariable("SETUP_VP_CACHE_PATH", metadata.cachePath);
  }
  if (metadata.lockFile) {
    ports.setVariable("SETUP_VP_LOCK_FILE", metadata.lockFile);
  }
  if (metadata.lockType) {
    ports.setVariable("SETUP_VP_LOCK_TYPE", metadata.lockType);
  }
}

export async function runFinalize(
  env: NodeJS.ProcessEnv = process.env,
  ports: AzurePorts = defaultPorts,
): Promise<void> {
  const inputs = parseAzureInputs(env);
  const projectDir = resolveProjectDirFromInputs(inputs);
  // Azure leaves an undefined macro unexpanded when it is mapped into env.
  if (env.NODE_AUTH_TOKEN === "$(NODE_AUTH_TOKEN)") delete env.NODE_AUTH_TOKEN;

  ports.configureAuth(
    inputs.registryUrl,
    inputs.scope,
    env,
    (name, value) => {
      if (name === "NODE_AUTH_TOKEN") return;
      if (value !== undefined)
        ports.setVariable(name, value, {
          isSecret: name !== "NPM_CONFIG_USERCONFIG" && name !== "PNPM_CONFIG_USERCONFIG",
        });
    },
    projectDir,
  );

  const runInstallEntries = ports.parseRunInstall(inputs.runInstall);
  const installCommand = await ports.setupSfw(runInstallEntries, {
    env,
    sfwEnabled: inputs.sfw,
    exportVariable: (name, value) => {
      if (value === undefined) return;
      if (name === "PATH") ports.prependPath(value.split(path.delimiter)[0]!);
      else ports.setVariable(name, value);
    },
  });
  if (runInstallEntries.length > 0) {
    await ports.runInstall(runInstallEntries, projectDir, installCommand, env);
  }

  const versionOutput = ports.getCommandOutput("vp", ["--version"], { cwd: projectDir }) || "";
  ports.logInfo(versionOutput);
  const installedVersion = ports.parseInstalledVpVersion(versionOutput);
  ports.setVariable("SETUP_VP_INSTALLED_VERSION", installedVersion);
  ports.setVariable("version", installedVersion, { isOutput: true });
  ports.setVariable("cacheHit", String(env.SETUP_VP_CACHE_HIT === "true"), { isOutput: true });
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
