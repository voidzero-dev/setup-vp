import { debug } from "@actions/core";
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { pkgPrNewCommitSha } from "./ci/install-script-urls.js";
import { supportsScopedEnv } from "./ci/node-manager.js";
import { isWindows } from "./ci/platform.js";
import { parseInstalledVpVersion } from "./ci/version.js";
import { getVitePlusBinDirs, parseVitePlusDirs, supportsVitePlusDirs } from "./ci/vp-dirs.js";
import type { VitePlusBinDirs, VitePlusDirs } from "./ci/vp-dirs.js";

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COMMON_SHIMS = ["vp", "node", "npm", "npx", "vpx", "vpr"];
const PACKAGE_MANAGER_SHIMS = ["pnpm", "pnpx", "yarn", "yarnpkg", "bun", "bunx"];

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
}

interface ManagementConfig {
  shimMode?: string;
  nodeShimMode?: string;
  packageManagerShimModes?: Record<string, string>;
}

// Only recognize the active, complete installation. Installation, repair, and
// version switching remain the official installer's responsibility.
export function findReusableVitePlus(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): VitePlusBinDirs | undefined {
  if (
    !EXACT_VERSION_RE.test(version) ||
    pkgPrNewCommitSha(version) ||
    !supportsVitePlusDirs(version) ||
    env.VP_PR_VERSION ||
    env.VP_LOCAL_TGZ ||
    env.VP_LOCAL_BINARY ||
    env.VP_SKIP_DEPS_INSTALL ||
    (env.VP_NODE_MANAGER && env.VP_NODE_MANAGER !== "yes") ||
    !hasValidDirOverrides(env)
  ) {
    return undefined;
  }

  const binaryName = isWindows(platform) ? "vp.exe" : "vp";

  for (const dataDir of candidateDataDirs(env, platform)) {
    const binary = join(dataDir, "current", "bin", binaryName);
    if (!existsSync(binary)) continue;

    try {
      // Native reinstalls can select a version+force.* directory. Validate the
      // active payload's metadata instead of assuming its directory name.
      const versionDir = realpathSync(join(dataDir, "current"));
      if (dirname(versionDir) !== realpathSync(dataDir)) continue;
      if (!hasDependencies(versionDir, version)) continue;

      // Query the payload, not a PATH command or a Windows trampoline that
      // could select a different installation through its sidecar file.
      const options: ExecFileSyncOptionsWithStringEncoding = {
        cwd: tmpdir(),
        env,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      };
      const output = execFileSync(binary, [], { ...options, env: { ...env, VP_DUMP_DIRS: "1" } });
      const dirs = parseVitePlusDirs(output);
      const layout = /^layout\t(single-root|split)\r?$/m.exec(output)?.[1];
      if (!dirs || !Object.values(dirs).every(isAbsolute)) continue;
      if (!layout) continue;
      if (realpathSync(dirs.data) !== realpathSync(dataDir)) continue;
      const versionOutput = execFileSync(binary, ["--version"], options);
      if (parseInstalledVpVersion(versionOutput) !== version) continue;
      if (!hasManagedEnvironment(dirs.config, platform)) continue;
      if (!hasValidShims(dirs, binary, platform, layout, versionOutput)) continue;

      return getVitePlusBinDirs(dirs);
    } catch (error) {
      // Missing files, invalid metadata, failed probes, and unsupported layouts
      // must not turn an optional optimization into an installation failure.
      debug(`Cannot reuse Vite+ at ${dataDir}: ${String(error)}`);
    }
  }
  return undefined;
}

function hasValidDirOverrides(env: NodeJS.ProcessEnv): boolean {
  if (env.VP_HOME && !isAbsolute(env.VP_HOME)) return false;
  const overrides = [env.VP_BIN_DIR, env.VP_DATA_DIR, env.VP_CACHE_DIR].filter(
    (dir): dir is string => !!dir,
  );
  return overrides.length === 0 || (overrides.length === 3 && overrides.every(isAbsolute));
}

function candidateDataDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (env.VP_HOME) return [env.VP_HOME];
  const home = (isWindows(platform) ? env.USERPROFILE : env.HOME) || homedir();
  // These are discovery hints only. VP_DUMP_DIRS above decides whether the
  // candidate is the installation selected by the current environment.
  const candidates = [join(home, ".vite-plus"), env.VP_DATA_DIR];
  if (isWindows(platform)) {
    candidates.push(join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "vite-plus", "data"));
  } else {
    const xdgData = env.XDG_DATA_HOME;
    candidates.push(
      join(xdgData && isAbsolute(xdgData) ? xdgData : join(home, ".local", "share"), "vite-plus"),
    );
  }
  return [...new Set(candidates.filter((dir): dir is string => !!dir && isAbsolute(dir)))];
}

function hasDependencies(versionDir: string, version: string): boolean {
  const wrapper = JSON.parse(readFileSync(join(versionDir, "package.json"), "utf8")) as PackageJson;
  if (
    wrapper.name !== "vp-global" ||
    wrapper.version !== version ||
    wrapper.dependencies?.["vite-plus"] !== version
  ) {
    return false;
  }
  const packageFile = realpathSync(join(versionDir, "node_modules", "vite-plus", "package.json"));
  if (!isInside(versionDir, packageFile)) return false;
  const pkg = JSON.parse(readFileSync(packageFile, "utf8")) as PackageJson;
  if (pkg.name !== "vite-plus" || pkg.version !== version || !pkg.dependencies) return false;
  const packageRequire = createRequire(packageFile);
  if (!statSync(join(dirname(packageFile), "dist", "bin.js")).isFile()) return false;

  // Follow pnpm's dependency links without executing JS or relying on packages
  // exporting package.json. Do not accept dependencies from outside this install.
  return Object.keys(pkg.dependencies).every((name) =>
    packageRequire.resolve.paths(name)?.some((modulesDir) => {
      const dependencyFile = join(modulesDir, name, "package.json");
      return existsSync(dependencyFile) && isInside(versionDir, realpathSync(dependencyFile));
    }),
  );
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function hasManagedEnvironment(configDir: string, platform: NodeJS.Platform): boolean {
  const configFile = join(configDir, "config.json");
  const config = existsSync(configFile)
    ? (JSON.parse(readFileSync(configFile, "utf8")) as ManagementConfig)
    : {};
  // runMain applies requested opt-outs after installation. Reuse must preserve
  // the installer's enabled defaults, including the scoped modes from 0.3.1.
  const modes = [
    config.shimMode,
    config.nodeShimMode,
    ...Object.values(config.packageManagerShimModes ?? {}),
  ];
  if (modes.some((mode) => mode !== undefined && mode !== "managed")) return false;
  const envFile = join(configDir, isWindows(platform) ? "env.ps1" : "env");
  return statSync(envFile).isFile();
}

function hasValidShims(
  dirs: VitePlusDirs,
  binary: string,
  platform: NodeJS.Platform,
  layout: string,
  versionOutput: string,
): boolean {
  // 0.3.1 introduced scoped package-manager modes and their own shims,
  // replacing Corepack. Requiring the old shim rejects complete installations.
  const tools = [
    ...COMMON_SHIMS,
    ...(supportsScopedEnv(versionOutput) ? PACKAGE_MANAGER_SHIMS : ["corepack"]),
  ];
  if (isWindows(platform)) {
    const trampoline = readFileSync(join(dirname(binary), "vp-shim.exe"));
    if (!statSync(join(dirs.bin, "vp-use.cmd")).isFile()) return false;
    return tools.every((tool) => {
      const shim = readFileSync(join(dirs.bin, `${tool}.exe`));
      const [header, ...lines] = readFileSync(join(dirs.bin, `${tool}.shim`), "utf8")
        .trim()
        .split(/\r?\n/);
      const fields = new Map(
        lines.map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
      );
      return (
        shim.equals(trampoline) &&
        header === "vite-plus-shim-v1" &&
        fields.get("layout") === layout &&
        fields.get("data") === dirs.data &&
        fields.get("cache") === dirs.cache
      );
    });
  }
  const payload = realpathSync(binary);
  return tools.every((tool) => {
    const shim = join(dirs.bin, tool);
    accessSync(shim, constants.X_OK);
    return realpathSync(shim) === payload;
  });
}
