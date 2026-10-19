import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { valid } from "semver";
import type { ToolchainCachePlan } from "./toolchain-cache.js";

const BIN_NAMES = {
  npm: ["npm", "npx"],
  pnpm: ["pnpm", "pnpx"],
  yarn: ["yarn", "yarnpkg"],
  bun: ["bun", "bunx"],
} as const;
type PackageManagerName = keyof typeof BIN_NAMES;
const JS_ENTRY: Record<PackageManagerName, string | undefined> = {
  npm: "npm-cli.js",
  pnpm: "pnpm.cjs",
  yarn: "yarn.js",
  bun: undefined,
};

export interface PackageManagerCachePlan {
  key: string;
  name: PackageManagerName;
  version: string;
  path: string;
  node: string;
}

// Hash configuration without putting registry credentials in cache keys or archives.
function configurationHash(projectDir: string, env: NodeJS.ProcessEnv): string {
  const paths = new Set<string>();
  for (let dir = projectDir; ; dir = dirname(dir)) {
    paths.add(join(dir, ".npmrc"));
    if (dirname(dir) === dir) break;
  }
  paths.add(env.NPM_CONFIG_USERCONFIG || env.npm_config_userconfig || join(homedir(), ".npmrc"));
  const hash = createHash("sha256");
  hash.update(env.NPM_CONFIG_REGISTRY || env.npm_config_registry || "");
  for (const path of paths) hash.update(JSON.stringify(readConfiguration(path)));
  return hash.digest("hex").slice(0, 24);
}

function readConfiguration(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return "";
  }
}

export function createPackageManagerCachePlan(
  toolchain: ToolchainCachePlan,
  output: string,
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PackageManagerCachePlan | undefined {
  const { package_manager: manager } = JSON.parse(output);
  if (
    !manager ||
    manager.mode !== "managed" ||
    !Object.hasOwn(BIN_NAMES, manager.name) ||
    typeof manager.version !== "string" ||
    valid(manager.version) !== manager.version
  )
    return;
  const name = manager.name as PackageManagerName;
  const version = manager.version as string;
  const path = join(toolchain.data, "package_manager", name, version);
  const bin = manager.bin_paths?.[name];
  const expected = join(path, name, "bin", name);
  // Vite+ reports .cmd until a native Windows manager is installed. Accept both
  // forms, but never cache system managers, bundled npm, or an unknown layout.
  const candidates = platform === "win32" ? [`${expected}.cmd`, `${expected}.exe`] : [expected];
  if (typeof bin !== "string" || !candidates.includes(bin)) return;
  return {
    key: `${toolchain.key}-pm-${name}-${version}-${configurationHash(projectDir, env)}`,
    name,
    version,
    path,
    node: join(toolchain.runtime, platform === "win32" ? "node.exe" : "bin/node"),
  };
}

function containedFile(root: string, file: string): boolean {
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return false;
  const location = relative(root, realpathSync(file));
  return location !== ".." && !location.startsWith(`..${sep}`) && !isAbsolute(location);
}

function packageManagerCommand(
  plan: PackageManagerCachePlan,
  root: string,
  platform: NodeJS.Platform,
): [string, string[]] | undefined {
  const bin = join(plan.path, plan.name, "bin");
  const windows = platform === "win32";
  for (const name of BIN_NAMES[plan.name]) {
    const candidates = windows ? [`${name}.exe`, `${name}.cmd`] : [name];
    if (!candidates.some((file) => containedFile(root, join(bin, file)))) return;
  }
  const native = join(bin, `${plan.name}.native${windows ? ".exe" : ""}`);
  if (containedFile(root, native)) return [native, ["--version"]];
  const entry = JS_ENTRY[plan.name];
  if (!entry) return;
  const script = join(bin, entry);
  if (containedFile(root, script)) return [plan.node, [script, "--version"]];
  return;
}

export function validatePackageManager(
  plan: PackageManagerCachePlan,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!lstatSync(plan.path, { throwIfNoEntry: false })?.isDirectory()) return false;
  const command = packageManagerCommand(plan, realpathSync(plan.path), platform);
  if (!command) return false;
  // Probe the actual cached executable or JS entry point, never a global shim
  // that could download a replacement and turn a corrupt archive into a hit.
  const output = execFileSync(command[0], command[1], {
    cwd: tmpdir(),
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.trim() === plan.version;
}
