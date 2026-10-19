import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { valid } from "semver";
import { isMuslLinux } from "./install-sfw.js";
import { pkgPrNewCommitSha } from "./install-script-urls.js";
import { isWindows } from "./platform.js";
import { resolveProjectNodeVersion } from "./project-node-version.js";
import { parseInstalledVpVersion } from "./version.js";
import { hasVitePlusDependencies, hasVitePlusNativeBinding } from "./viteplus-payload.js";
import { parseVitePlusDirs, supportsVitePlusDirs } from "./vp-dirs.js";

const EXACT_NODE = /^v?\d+\.\d+\.\d+$/;
const PREVIEW = /^0\.0\.0-commit\.[a-f0-9]{40}$/;
const LOCAL_OVERRIDES = [
  "VP_LOCAL_TGZ",
  "VP_LOCAL_BINARY",
  "VP_SKIP_DEPS_INSTALL",
  "VITE_PLUS_HOME",
];

export interface ToolchainCachePlan {
  key: string;
  version: string;
  nodeVersion: string;
  data: string;
  payload: string;
  runtime: string;
  paths: string[];
}

// These are discovery hints only. A restored binary must confirm the data root
// through VP_DUMP_DIRS before the installer can use the restored files.
function dataDirectory(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (env.VP_HOME) return isAbsolute(env.VP_HOME) ? env.VP_HOME : undefined;
  const overrides = [env.VP_BIN_DIR, env.VP_DATA_DIR, env.VP_CACHE_DIR];
  if (overrides.some(Boolean)) {
    return overrides.every((value) => value && isAbsolute(value)) ? env.VP_DATA_DIR : undefined;
  }
  return defaultDataDirectory(env, platform);
}

function defaultDataDirectory(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  const home = (isWindows(platform) ? env.USERPROFILE : env.HOME) || homedir();
  const legacy = join(home, ".vite-plus");
  if (lstatSync(join(legacy, "current"), { throwIfNoEntry: false })) return legacy;
  if (isWindows(platform))
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "vite-plus", "data");
  const dataHome =
    env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : join(home, ".local", "share");
  return join(dataHome, "vite-plus");
}

function defaultLibc(platform: NodeJS.Platform): string {
  if (platform !== "linux") return "native";
  return isMuslLinux() ? "musl" : "glibc";
}

export function createToolchainCachePlan(
  options: { version: string; nodeVersion?: string; nodeManager?: boolean; projectDir: string },
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
  libc = defaultLibc(platform),
): ToolchainCachePlan | undefined {
  const { version } = options;
  if (!cacheableVersion(version, env) || options.nodeManager === false) return;
  const nodeVersion = exactNodeVersion(
    options.nodeVersion || resolveProjectNodeVersion(options.projectDir),
  );
  if (!nodeVersion) return;
  const data = dataDirectory(env, platform);
  if (!data || !isAbsolute(data)) return;
  const identity = JSON.stringify([
    data,
    env.NPM_CONFIG_REGISTRY || env.npm_config_registry || "https://registry.npmjs.org",
    env.VP_NODE_DIST_MIRROR || "",
  ]);
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  const payload = join(data, version);
  const runtime = join(data, "js_runtime", "node", nodeVersion);
  return {
    key: `setup-vp-toolchain-v2-${platform}-${arch}-${libc}-${version}-node-${nodeVersion}-${suffix}`,
    version,
    nodeVersion,
    data,
    payload,
    runtime,
    paths: [payload, runtime],
  };
}

function cacheableVersion(version: string, env: NodeJS.ProcessEnv): boolean {
  const preview = pkgPrNewCommitSha(version);
  if (valid(version) !== version || !supportsVitePlusDirs(version)) return false;
  if (preview && !PREVIEW.test(version)) return false;
  if (env.VP_PR_VERSION && env.VP_PR_VERSION !== preview) return false;
  return !LOCAL_OVERRIDES.some((name) => env[name]);
}

function exactNodeVersion(selector?: string): string | undefined {
  // Do not freeze mutable selectors (including the default LTS) in an immutable cache.
  if (!selector || !EXACT_NODE.test(selector)) return;
  const version = selector.startsWith("v") ? selector.slice(1) : selector;
  return valid(version) || undefined;
}

export function canRestoreToolchain(plan: ToolchainCachePlan): boolean {
  // Never extract over files that were already present on a persistent runner.
  return plan.paths.every((path) => !lstatSync(path, { throwIfNoEntry: false }));
}

export function validateToolchain(
  plan: ToolchainCachePlan,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const binary = join(plan.payload, "bin", isWindows(platform) ? "vp.exe" : "vp");
  const node = isWindows(platform)
    ? join(plan.runtime, "node.exe")
    : join(plan.runtime, "bin", "node");
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: tmpdir(),
    env,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  };
  if (!lstatSync(plan.payload).isDirectory() || !lstatSync(plan.runtime).isDirectory())
    return false;
  // Without this marker, even a version probe can start a first-run installation.
  if (
    !statSync(join(plan.payload, "bin", ".vp-setup-complete"), { throwIfNoEntry: false })?.isFile()
  )
    return false;
  const payload = realpathSync(plan.payload);
  if (!hasVitePlusDependencies(payload, plan.version)) return false;
  if (
    execFileSync(binary, ["--help"], {
      ...options,
      env: { ...env, VP_SELF_SETUP_SUPPORT_CHECK: "1" },
    }).trim() !== "vite-plus-self-setup-v1"
  )
    return false;
  const dirs = parseVitePlusDirs(
    execFileSync(binary, [], { ...options, env: { ...env, VP_DUMP_DIRS: "1" } }),
  );
  if (!dirs || realpathSync(dirs.data) !== realpathSync(plan.data)) return false;
  if (parseInstalledVpVersion(execFileSync(binary, ["--version"], options)) !== plan.version)
    return false;
  if (isWindows(platform) && !statSync(join(plan.payload, "bin", "vp-shim.exe")).isFile())
    return false;
  if (execFileSync(node, ["--version"], options).trim() !== `v${plan.nodeVersion}`) return false;
  return hasVitePlusNativeBinding(
    payload,
    options,
    pkgPrNewCommitSha(plan.version) ? plan.version : undefined,
  );
}

export function discardRestoredToolchain(plan: ToolchainCachePlan): void {
  // Call only after canRestoreToolchain: these exact version directories were absent.
  for (const path of plan.paths) rmSync(path, { recursive: true, force: true });
}
