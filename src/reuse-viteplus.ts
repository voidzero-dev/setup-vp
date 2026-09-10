import { debug } from "@actions/core";
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { pkgPrNewCommitSha } from "./ci/install-script-urls.js";
import { parseInstalledVpVersion } from "./ci/version.js";
import { parseVitePlusDirs, supportsVitePlusDirs } from "./ci/vp-dirs.js";
import type { VitePlusDirs } from "./ci/vp-dirs.js";

const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const NODE_SHIMS = ["node", "npm", "npx", "corepack", "vpx", "vpr"];

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
}

// Only recognize the active, complete installation. Installation, repair, and
// version switching remain the official installer's responsibility.
export function findReusableVitePlus(
  version: string,
  nodeManager: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (
    !EXACT_VERSION_RE.test(version) ||
    pkgPrNewCommitSha(version) ||
    !supportsVitePlusDirs(version) ||
    env.VP_PR_VERSION ||
    env.VP_LOCAL_TGZ ||
    env.VP_LOCAL_BINARY ||
    env.VP_SKIP_DEPS_INSTALL ||
    !validDirOverrides(env)
  ) {
    return undefined;
  }

  const manager = nodeManager === undefined ? env.VP_NODE_MANAGER : nodeManager ? "yes" : "no";
  if (manager && manager !== "yes" && manager !== "no") return undefined;
  const managed = manager !== "no";
  const binaryName = platform === "win32" ? "vp.exe" : "vp";

  for (const dataDir of candidateDataDirs(env, platform)) {
    const binary = join(dataDir, "current", "bin", binaryName);
    if (!existsSync(binary)) continue;

    try {
      const versionDir = realpathSync(join(dataDir, version));
      if (realpathSync(join(dataDir, "current")) !== versionDir) continue;
      if (!hasDependencies(versionDir, version)) continue;

      // Query the payload, not a PATH command or a Windows trampoline that
      // could select a different installation through its sidecar file.
      const options = {
        cwd: tmpdir(),
        env,
        encoding: "utf8" as const,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"],
      };
      const output = execFileSync(binary, [], { ...options, env: { ...env, VP_DUMP_DIRS: "1" } });
      const dirs = parseVitePlusDirs(output);
      const layout = /^layout\t(single-root|split)\r?$/m.exec(output)?.[1];
      if (!dirs || !Object.values(dirs).every(isAbsolute)) continue;
      if (!layout) continue;
      if (realpathSync(dirs.data) !== realpathSync(dataDir)) continue;
      if (!hasShimsAndConfig(dirs, binary, managed, platform, layout)) continue;
      if (parseInstalledVpVersion(execFileSync(binary, ["--version"], options)) !== version) {
        continue;
      }

      return dirs.bin;
    } catch (error) {
      // Missing files, invalid metadata, failed probes, and unsupported layouts
      // must not turn an optional optimization into an installation failure.
      debug(`Cannot reuse Vite+ at ${dataDir}: ${String(error)}`);
    }
  }
  return undefined;
}

function validDirOverrides(env: NodeJS.ProcessEnv): boolean {
  if (env.VP_HOME && !isAbsolute(env.VP_HOME)) return false;
  const split = [env.VP_BIN_DIR, env.VP_DATA_DIR, env.VP_CACHE_DIR].filter(Boolean);
  return split.length === 0 || (split.length === 3 && split.every((dir) => isAbsolute(dir!)));
}

function candidateDataDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  if (env.VP_HOME) return [env.VP_HOME];
  const home = (platform === "win32" ? env.USERPROFILE : env.HOME) || homedir();
  // These are discovery hints only. VP_DUMP_DIRS above decides whether the
  // candidate is the installation selected by the current environment.
  const candidates = [join(home, ".vite-plus"), env.VP_DATA_DIR];
  if (platform === "win32") {
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
  const require = createRequire(packageFile);
  if (!statSync(join(packageFile, "..", "dist", "bin.js")).isFile()) return false;

  // Follow pnpm's dependency links without executing JS or relying on packages
  // exporting package.json. Do not accept dependencies from outside this install.
  return Object.keys(pkg.dependencies).every((name) =>
    require.resolve.paths(name)?.some((modulesDir) => {
      const dependency = join(modulesDir, name, "package.json");
      return existsSync(dependency) && isInside(versionDir, realpathSync(dependency));
    }),
  );
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function hasShimsAndConfig(
  dirs: VitePlusDirs,
  binary: string,
  managed: boolean,
  platform: NodeJS.Platform,
  layout: string,
): boolean {
  const configFile = join(dirs.config, "config.json");
  const config = existsSync(configFile)
    ? (JSON.parse(readFileSync(configFile, "utf8")) as { shimMode?: string })
    : {};
  const mode = config.shimMode ?? "managed";
  if (mode !== (managed ? "managed" : "system_first")) return false;
  if (!statSync(join(dirs.config, platform === "win32" ? "env.ps1" : "env")).isFile()) return false;

  const tools = managed ? ["vp", ...NODE_SHIMS] : ["vp"];
  if (platform === "win32") {
    const trampoline = readFileSync(join(binary, "..", "vp-shim.exe"));
    if (managed && !statSync(join(dirs.bin, "vp-use.cmd")).isFile()) return false;
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
