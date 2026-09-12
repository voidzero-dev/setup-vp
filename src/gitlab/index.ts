import path from "node:path";
import { pathToFileURL } from "node:url";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createVersionResolver } from "../ci/version-file.js";
import { createNodeVersionResolver } from "../ci/node-version-file.js";
import { resolutionContext } from "../ci/resolution.js";
import { installVitePlus } from "../ci/install-viteplus.js";
import { prepareCacheMetadata } from "../ci/cache.js";
import type { CacheMetadata } from "../ci/cache.js";
import { restoreCacheSnapshot } from "../ci/cache-snapshot.js";
import { parseInstalledVpVersion } from "../ci/version.js";
import { packageManagerArgs, parsePackageManager } from "../ci/package-manager.js";
import { getCommandOutput } from "../ci/process.js";
import { nodeManagerOffArgs, parseNodeManager } from "../ci/node-manager.js";
import type { RuntimeEnv } from "../ci/types.js";
import { configureAuth } from "./auth.js";
import { setupSfw } from "./install-sfw.js";
import { parseRunInstall, runInstall } from "./run-install.js";
import { exportShellEnv, run } from "./shell.js";
import { resolveProjectDir } from "./utils.js";

function fail(message: string): never {
  console.error(`setup-vp: ${message}`);
  process.exit(1);
}

// Switch to the image's Node.js after installation, preserving package-manager management.
export function applyEnvironmentModes(
  env: RuntimeEnv = process.env,
  runFn: typeof run = run,
): void {
  const nodeManager = parseNodeManager(env.SETUP_VP_NODE_MANAGER);
  const packageManager = parsePackageManager(env.SETUP_VP_PACKAGE_MANAGER);
  const versionOutput =
    nodeManager === false || packageManager !== undefined
      ? getCommandOutput("vp", ["--version"]) || ""
      : "";
  const packageManagerCommands = packageManagerArgs(packageManager, versionOutput);
  if (nodeManager === false) {
    runFn("vp", nodeManagerOffArgs(versionOutput));
  }
  for (const args of packageManagerCommands) {
    runFn("vp", args);
  }
}

export async function main(phase = "setup"): Promise<void> {
  const env = process.env;
  const workspaceRoot = env.CI_PROJECT_DIR || process.cwd();
  if (phase === "save-cache") {
    const metadata = JSON.parse(
      readFileSync(path.join(workspaceRoot, ".setup-vp-cache-state.json"), "utf8"),
    ) as CacheMetadata;
    // Do not restore the pre-install snapshot over files populated by job scripts.
    restoreCacheSnapshot(
      metadata,
      path.join(workspaceRoot, ".setup-vp-cache"),
      console.warn,
      false,
    ).save();
    return;
  }
  if (phase !== "setup") throw new Error(`Invalid GitLab phase: ${phase}`);
  const projectDir = resolveProjectDir(env);
  // An opt-out or failed setup must not reuse state from a previous shell-runner job.
  rmSync(path.join(workspaceRoot, ".setup-vp-cache-state.json"), { force: true });
  const context = resolutionContext(env.CI_PROJECT_DIR || process.cwd());
  const nodeManager = parseNodeManager(env.SETUP_VP_NODE_MANAGER);
  // Validate configuration before invoking the installer.
  parsePackageManager(env.SETUP_VP_PACKAGE_MANAGER);
  const runInstallEntries = parseRunInstall(env.SETUP_VP_RUN_INSTALL ?? "true");
  if (nodeManager === false && (env.SETUP_VP_NODE_VERSION || env.SETUP_VP_NODE_VERSION_FILE)) {
    throw new Error("node-version and node-version-file cannot be used with node-manager: false");
  }
  const nodeVersion =
    env.SETUP_VP_NODE_VERSION ||
    (env.SETUP_VP_NODE_VERSION_FILE
      ? createNodeVersionResolver(context).resolveNodeVersionFile(
          env.SETUP_VP_NODE_VERSION_FILE,
          projectDir,
        )
      : undefined);
  const version = createVersionResolver(context).resolveVitePlusVersion(
    {
      version: env.SETUP_VP_VERSION,
      versionFile: env.SETUP_VP_VERSION_FILE,
      cacheDependencyPath: env.SETUP_VP_CACHE_DEPENDENCY_PATH,
    },
    projectDir,
  );

  await installVitePlus(version, { env, prependPath: () => exportShellEnv("PATH", env.PATH) });

  applyEnvironmentModes();
  if (nodeVersion) run("vp", ["env", "use", nodeVersion], { cwd: projectDir });

  configureAuth(env.SETUP_VP_REGISTRY_URL || "", env.SETUP_VP_SCOPE || "", env, projectDir);

  const cacheRoot = path.join(context.getWorkspaceDir(), ".setup-vp-cache");
  env.SETUP_VP_SFW_CACHE_DIR = path.join(cacheRoot, "sfw");
  const cacheEnabled = env.SETUP_VP_CACHE?.toLowerCase() === "true";
  const metadata = cacheEnabled
    ? prepareCacheMetadata({
        projectDir,
        cacheDependencyPath: env.SETUP_VP_CACHE_DEPENDENCY_PATH,
        logWarning: console.warn,
      })
    : { ready: false };
  const cache = restoreCacheSnapshot(metadata, cacheRoot);
  if (metadata.ready && env.SETUP_VP_CACHE_SAVE?.toLowerCase() !== "false") {
    writeFileSync(
      path.join(workspaceRoot, ".setup-vp-cache-state.json"),
      JSON.stringify(metadata),
      { mode: 0o600 },
    );
    copyFileSync(process.argv[1]!, path.join(workspaceRoot, ".setup-vp-runtime.mjs"));
  }

  const installCommand = await setupSfw(runInstallEntries);
  await runInstall(runInstallEntries, projectDir, installCommand);
  if (env.SETUP_VP_CACHE_SAVE?.toLowerCase() !== "false") cache.save();

  const output = getCommandOutput("vp", ["--version"], { cwd: projectDir }) || "";
  console.log(output);
  const outputs = {
    SETUP_VP_INSTALLED_VERSION: parseInstalledVpVersion(output),
    SETUP_VP_CACHE_HIT: String(cache.hit),
  };
  for (const [name, value] of Object.entries(outputs)) {
    env[name] = value;
    exportShellEnv(name, value);
  }
  // Only non-secret outputs belong in a GitLab dotenv artifact.
  writeFileSync(
    path.join(context.getWorkspaceDir(), ".setup-vp-outputs.env"),
    Object.entries(outputs)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(""),
    { mode: 0o600 },
  );
}

export function isEntrypoint(argvPath = process.argv[1], moduleUrl = import.meta.url): boolean {
  return Boolean(argvPath && moduleUrl === pathToFileURL(path.resolve(argvPath)).href);
}

if (isEntrypoint()) {
  try {
    await main(process.argv[2]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
